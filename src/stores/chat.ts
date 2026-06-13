import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Doc } from "@/lib/api";
import type { VizPlan, TokenUsage } from "@/lib/ai";
import type { ChartType } from "@/components/studio/CanvasChart";

/** Special scope value meaning "every collection in the database" (joins). */
export const WHOLE_DB = "*";

/** How many result rows we keep per turn when persisting to disk. */
const PERSIST_DOC_CAP = 50;
/** How many sessions we retain in history. */
const SESSION_CAP = 30;

export interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  /** user prompt text */
  text?: string;
  /** assistant is still generating */
  pending?: boolean;
  error?: string;
  /** Refused because the request tried to modify data (Studio is read-only). */
  blocked?: boolean;
  plan?: VizPlan;
  /** mongosh rendering of the plan */
  query?: string;
  /** the collection the query actually ran against (primary, for joins) */
  runCollection?: string;
  docs?: Doc[];
  docCount?: number;
  execMs?: number;
  chartType?: ChartType | null;
  summary?: string | null;
  /** Tokens spent generating this turn (planning + summarize). */
  usage?: TokenUsage;
}

export interface ChatSession {
  id: string;
  title: string;
  database: string;
  /** a collection name, or WHOLE_DB for cross-collection mode */
  scope: string;
  createdAt: number;
  updatedAt: number;
  turns: ChatTurn[];
}

let seq = 0;
const newId = (p: string) => `${p}-${Date.now().toString(36)}-${seq++}`;

interface ChatState {
  sessions: ChatSession[];
  activeId: string | null;

  newSession: (database: string, scope: string, title: string) => string;
  setActive: (id: string | null) => void;
  addTurn: (sessionId: string, turn: Omit<ChatTurn, "id">) => string;
  patchTurn: (sessionId: string, turnId: string, patch: Partial<ChatTurn>) => void;
  deleteSession: (id: string) => void;
  clearAll: () => void;
}

const touch = (s: ChatSession): ChatSession => ({ ...s, updatedAt: Date.now() });

export const useChat = create<ChatState>()(
  persist(
    (set) => ({
      sessions: [],
      activeId: null,

      newSession: (database, scope, title) => {
        const id = newId("sess");
        const now = Date.now();
        const session: ChatSession = {
          id,
          title: title.slice(0, 80) || "New chat",
          database,
          scope,
          createdAt: now,
          updatedAt: now,
          turns: [],
        };
        set((st) => ({ sessions: [session, ...st.sessions], activeId: id }));
        return id;
      },

      setActive: (id) => set({ activeId: id }),

      addTurn: (sessionId, turn) => {
        const turnId = newId("turn");
        set((st) => ({
          sessions: st.sessions.map((s) =>
            s.id === sessionId ? touch({ ...s, turns: [...s.turns, { ...turn, id: turnId }] }) : s
          ),
        }));
        return turnId;
      },

      patchTurn: (sessionId, turnId, patch) =>
        set((st) => ({
          sessions: st.sessions.map((s) =>
            s.id === sessionId
              ? touch({
                  ...s,
                  turns: s.turns.map((t) => (t.id === turnId ? { ...t, ...patch } : t)),
                })
              : s
          ),
        })),

      deleteSession: (id) =>
        set((st) => ({
          sessions: st.sessions.filter((s) => s.id !== id),
          activeId: st.activeId === id ? null : st.activeId,
        })),

      clearAll: () => set({ sessions: [], activeId: null }),
    }),
    {
      name: "ognom-chat",
      // Keep storage bounded: most-recent sessions only, and cap result rows
      // saved per turn (the live in-memory copy keeps everything).
      partialize: (state) => ({
        activeId: state.activeId,
        sessions: state.sessions
          .slice()
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, SESSION_CAP)
          .map((s) => ({
            ...s,
            turns: s.turns.map((t) =>
              t.docs ? { ...t, docs: t.docs.slice(0, PERSIST_DOC_CAP) } : t
            ),
          })),
      }),
    }
  )
);
