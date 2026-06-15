import { create } from "zustand";
import { persist } from "zustand/middleware";

/** "normal" → fast, minimal reasoning · "deep" → reasoning enabled. */
export type AiMode = "normal" | "deep";

/** The single OpenAI model Studio uses (reasoning is toggled per mode). */
export const DEFAULT_MODEL = "gpt-5.4-nano";

export const AI_MODE_META: Record<
  AiMode,
  { label: string; short: string; reasoning: boolean; hint: string; desc: string }
> = {
  normal: {
    label: "Normal mode",
    short: "Normal",
    reasoning: false,
    hint: "fast · minimal reasoning",
    desc: "Fast answers with minimal reasoning. Best for quick lookups, simple counts, and straightforward queries.",
  },
  deep: {
    label: "Deep Think mode",
    short: "Deep Think",
    reasoning: true,
    hint: "reasoning enabled",
    desc: "Reasons step-by-step before answering — slower, but better at complex joins, multi-stage aggregations, and ambiguous questions.",
  },
};

interface StudioState {
  /** Terminator mode — replaces the classic workspace with Ognom Studio. */
  terminator: boolean;
  apiKey: string;
  aiMode: AiMode;
  /** Editable OpenAI model id. Deep Think turns reasoning on for THIS model. */
  model: string;
  setTerminator: (on: boolean) => void;
  setApiKey: (key: string) => void;
  setAiMode: (mode: AiMode) => void;
  setModel: (model: string) => void;
}

export const useStudio = create<StudioState>()(
  persist(
    (set) => ({
      terminator: false,
      apiKey: "",
      aiMode: "normal",
      model: DEFAULT_MODEL,
      setTerminator: (on) => set({ terminator: on }),
      setApiKey: (key) => set({ apiKey: key.trim() }),
      setAiMode: (mode) => set({ aiMode: mode }),
      setModel: (model) => set({ model: model.trim() || DEFAULT_MODEL }),
    }),
    {
      name: "ognom-studio",
      version: 2,
      // v1 had separate modelNormal/modelDeep; collapse to a single model.
      migrate: (persisted: unknown, version) => {
        const state = (persisted ?? {}) as Record<string, unknown>;
        if (version < 2) {
          const legacy = state.modelNormal;
          state.model = typeof legacy === "string" && legacy.trim() ? legacy : DEFAULT_MODEL;
          delete state.modelNormal;
          delete state.modelDeep;
        }
        return state as unknown as StudioState;
      },
    }
  )
);

/** Resolve the active model id + reasoning flag for the current mode. */
export function activeAiConfig(s: Pick<StudioState, "aiMode" | "model">) {
  return { model: s.model, reasoning: AI_MODE_META[s.aiMode].reasoning };
}
