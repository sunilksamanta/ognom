import { create } from "zustand";
import { persist } from "zustand/middleware";

/** "normal" → fast model · "deep" → reasoning model. */
export type AiMode = "normal" | "deep";

export const DEFAULT_MODELS: Record<AiMode, string> = {
  normal: "gpt-5.4-nano",
  deep: "gpt-5.4-mini",
};

export const AI_MODE_META: Record<AiMode, { label: string; reasoning: boolean; hint: string }> = {
  normal: { label: "Normal mode", reasoning: false, hint: "fast" },
  deep: { label: "Deep Think mode", reasoning: true, hint: "reasoning" },
};

interface StudioState {
  /** Terminator mode — replaces the classic workspace with Ognom Studio. */
  terminator: boolean;
  apiKey: string;
  aiMode: AiMode;
  /** Editable model ids per mode (OpenAI). Defaults restorable any time. */
  modelNormal: string;
  modelDeep: string;
  setTerminator: (on: boolean) => void;
  setApiKey: (key: string) => void;
  setAiMode: (mode: AiMode) => void;
  setModel: (mode: AiMode, model: string) => void;
}

export const useStudio = create<StudioState>()(
  persist(
    (set) => ({
      terminator: false,
      apiKey: "",
      aiMode: "normal",
      modelNormal: DEFAULT_MODELS.normal,
      modelDeep: DEFAULT_MODELS.deep,
      setTerminator: (on) => set({ terminator: on }),
      setApiKey: (key) => set({ apiKey: key.trim() }),
      setAiMode: (mode) => set({ aiMode: mode }),
      setModel: (mode, model) =>
        set(
          mode === "normal"
            ? { modelNormal: model.trim() || DEFAULT_MODELS.normal }
            : { modelDeep: model.trim() || DEFAULT_MODELS.deep }
        ),
    }),
    { name: "ognom-studio" }
  )
);

/** Resolve the active model id + reasoning flag for the current mode. */
export function activeAiConfig(s: Pick<StudioState, "aiMode" | "modelNormal" | "modelDeep">) {
  const model = s.aiMode === "normal" ? s.modelNormal : s.modelDeep;
  return { model, reasoning: AI_MODE_META[s.aiMode].reasoning };
}
