import { create } from "zustand";
import { persist } from "zustand/middleware";

/** "normal" → gpt-5.4-nano (fast) · "deep" → gpt-5.4-mini with reasoning. */
export type AiMode = "normal" | "deep";

export const AI_MODELS: Record<AiMode, { model: string; label: string; reasoning: boolean }> = {
  normal: { model: "gpt-5.4-nano", label: "Normal mode", reasoning: false },
  deep: { model: "gpt-5.4-mini", label: "Deep Think mode", reasoning: true },
};

interface StudioState {
  /** Terminator mode — replaces the classic workspace with Ognom Studio. */
  terminator: boolean;
  apiKey: string;
  aiMode: AiMode;
  setTerminator: (on: boolean) => void;
  setApiKey: (key: string) => void;
  setAiMode: (mode: AiMode) => void;
}

export const useStudio = create<StudioState>()(
  persist(
    (set) => ({
      terminator: false,
      apiKey: "",
      aiMode: "normal",
      setTerminator: (on) => set({ terminator: on }),
      setApiKey: (key) => set({ apiKey: key.trim() }),
      setAiMode: (mode) => set({ aiMode: mode }),
    }),
    { name: "ognom-studio" }
  )
);
