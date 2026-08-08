import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Saved Studio insights: pinned prompts with their database + scope. Running
 * one restores the scope and re-asks the AI — the query regenerates against
 * current data, so an insight stays useful as the schema evolves.
 */

export interface Insight {
  id: string;
  prompt: string;
  database: string;
  /** collection name, or WHOLE_DB ("*") */
  scope: string;
  createdAt: number;
}

interface InsightsState {
  insights: Insight[];
  addInsight: (i: Omit<Insight, "id" | "createdAt">) => void;
  removeInsight: (id: string) => void;
  /** True when this prompt+scope is already pinned. */
  has: (prompt: string, database: string, scope: string) => boolean;
}

const MAX_INSIGHTS = 50;

export const useInsights = create<InsightsState>()(
  persist(
    (set, get) => ({
      insights: [],
      addInsight: (i) =>
        set((s) => {
          if (get().has(i.prompt, i.database, i.scope)) return s;
          return {
            insights: [
              { ...i, id: crypto.randomUUID(), createdAt: Date.now() },
              ...s.insights,
            ].slice(0, MAX_INSIGHTS),
          };
        }),
      removeInsight: (id) =>
        set((s) => ({ insights: s.insights.filter((i) => i.id !== id) })),
      has: (prompt, database, scope) =>
        get().insights.some(
          (i) => i.prompt === prompt && i.database === database && i.scope === scope
        ),
    }),
    { name: "ognom-insights", version: 1 }
  )
);
