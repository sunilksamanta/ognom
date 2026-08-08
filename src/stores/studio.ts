import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api } from "@/lib/api";

/** "normal" → fast, minimal reasoning · "deep" → reasoning enabled. */
export type AiMode = "normal" | "deep";

export type AiProvider = "openai" | "anthropic" | "ollama" | "lmstudio" | "custom";

export const AI_PROVIDERS: AiProvider[] = ["openai", "anthropic", "ollama", "lmstudio", "custom"];

export const PROVIDER_META: Record<
  AiProvider,
  {
    label: string;
    defaultModel: string;
    /** Undefined → provider has a fixed endpoint (OpenAI / Anthropic). */
    defaultBaseUrl?: string;
    /** Cloud providers require a key; local/custom ones don't. */
    needsKey: boolean;
    keyPlaceholder: string;
    hint: string;
  }
> = {
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-5.4-nano",
    needsKey: true,
    keyPlaceholder: "sk-…",
    hint: "Sent only to api.openai.com from the Ognom backend.",
  },
  anthropic: {
    label: "Anthropic",
    defaultModel: "claude-opus-5",
    needsKey: true,
    keyPlaceholder: "sk-ant-…",
    hint: "Sent only to api.anthropic.com from the Ognom backend.",
  },
  ollama: {
    label: "Ollama (local)",
    defaultModel: "llama3.1",
    defaultBaseUrl: "http://localhost:11434/v1",
    needsKey: false,
    keyPlaceholder: "no key needed",
    hint: "Fully local — your schema and data never leave this machine.",
  },
  lmstudio: {
    label: "LM Studio (local)",
    defaultModel: "",
    defaultBaseUrl: "http://localhost:1234/v1",
    needsKey: false,
    keyPlaceholder: "no key needed",
    hint: "Fully local — use the model id shown in LM Studio's server tab.",
  },
  custom: {
    label: "Custom (OpenAI-compatible)",
    defaultModel: "",
    defaultBaseUrl: "",
    needsKey: false,
    keyPlaceholder: "optional",
    hint: "Any OpenAI-compatible /chat/completions endpoint.",
  },
};

/** Default model for the default provider, kept for legacy imports. */
export const DEFAULT_MODEL = PROVIDER_META.openai.defaultModel;

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

const defaultModels = (): Record<AiProvider, string> => ({
  openai: PROVIDER_META.openai.defaultModel,
  anthropic: PROVIDER_META.anthropic.defaultModel,
  ollama: PROVIDER_META.ollama.defaultModel,
  lmstudio: PROVIDER_META.lmstudio.defaultModel,
  custom: PROVIDER_META.custom.defaultModel,
});

const defaultBaseUrls = (): Record<AiProvider, string> => ({
  openai: "",
  anthropic: "",
  ollama: PROVIDER_META.ollama.defaultBaseUrl ?? "",
  lmstudio: PROVIDER_META.lmstudio.defaultBaseUrl ?? "",
  custom: "",
});

interface StudioState {
  /** Terminator mode — replaces the classic workspace with Ognom Studio. */
  terminator: boolean;
  /** Legacy (v2): plaintext key in localStorage. Migrated into the backend's
   *  encrypted vault on launch, then cleared. Never used for requests. */
  apiKey: string;
  aiMode: AiMode;
  provider: AiProvider;
  /** Per-provider model ids, editable in settings. */
  models: Record<AiProvider, string>;
  /** Per-provider base URLs (local/custom providers only). */
  baseUrls: Record<AiProvider, string>;
  /** Providers that have a key stored in the encrypted vault (backend truth,
   *  refreshed via refreshKeys — the key itself never reaches the webview). */
  keysConfigured: string[];
  setTerminator: (on: boolean) => void;
  setApiKey: (key: string) => void;
  setAiMode: (mode: AiMode) => void;
  setProvider: (provider: AiProvider) => void;
  setModel: (provider: AiProvider, model: string) => void;
  setBaseUrl: (provider: AiProvider, url: string) => void;
  refreshKeys: () => Promise<void>;
  setKeysConfigured: (providers: string[]) => void;
}

export const useStudio = create<StudioState>()(
  persist(
    (set) => ({
      terminator: false,
      apiKey: "",
      aiMode: "normal",
      provider: "openai",
      models: defaultModels(),
      baseUrls: defaultBaseUrls(),
      keysConfigured: [],
      setTerminator: (on) => set({ terminator: on }),
      setApiKey: (key) => set({ apiKey: key.trim() }),
      setAiMode: (mode) => set({ aiMode: mode }),
      setProvider: (provider) => set({ provider }),
      setModel: (provider, model) =>
        set((s) => ({ models: { ...s.models, [provider]: model.trim() } })),
      setBaseUrl: (provider, url) =>
        set((s) => ({ baseUrls: { ...s.baseUrls, [provider]: url.trim() } })),
      refreshKeys: async () => {
        try {
          set({ keysConfigured: await api.aiKeyStatus() });
        } catch {
          // Backend unavailable (e.g. during teardown) — keep the cached list.
        }
      },
      setKeysConfigured: (providers) => set({ keysConfigured: providers }),
    }),
    {
      name: "ognom-studio",
      version: 3,
      migrate: (persisted: unknown, version) => {
        const state = (persisted ?? {}) as Record<string, unknown>;
        if (version < 2) {
          // v1 had separate modelNormal/modelDeep; collapse to a single model.
          const legacy = state.modelNormal;
          state.model = typeof legacy === "string" && legacy.trim() ? legacy : DEFAULT_MODEL;
          delete state.modelNormal;
          delete state.modelDeep;
        }
        if (version < 3) {
          // v2 had a single OpenAI `model`; move it into the per-provider map.
          // The plaintext apiKey stays for App.tsx to push into the vault.
          const models = defaultModels();
          if (typeof state.model === "string" && state.model.trim()) {
            models.openai = state.model.trim();
          }
          state.models = models;
          state.baseUrls = defaultBaseUrls();
          state.provider = "openai";
          state.keysConfigured = [];
          delete state.model;
        }
        return state as unknown as StudioState;
      },
    }
  )
);

/** Resolve the active provider + model + reasoning flag for the current mode. */
export function activeAiConfig(
  s: Pick<StudioState, "aiMode" | "provider" | "models" | "baseUrls">
) {
  return {
    provider: s.provider,
    model: s.models[s.provider] ?? "",
    baseUrl: s.baseUrls[s.provider] || undefined,
    reasoning: AI_MODE_META[s.aiMode].reasoning,
  };
}

/** True when the active provider is usable (has a key when it needs one). */
export function aiReady(s: Pick<StudioState, "provider" | "keysConfigured">): boolean {
  return !PROVIDER_META[s.provider].needsKey || s.keysConfigured.includes(s.provider);
}

/** Provider-aware "not configured" message for toasts. */
export function aiNotReadyMessage(provider: AiProvider): string {
  return `Add your ${PROVIDER_META[provider].label} API key in Settings → Prompts & AI to use Studio AI`;
}
