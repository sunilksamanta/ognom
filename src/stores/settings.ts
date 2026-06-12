import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsState {
  pageSize: number;
  /** Unlocks the raw shell tab and other power-user options. */
  advancedMode: boolean;
  shellHistory: string[];
  setPageSize: (n: number) => void;
  setAdvancedMode: (on: boolean) => void;
  pushShellHistory: (entry: string) => void;
  clearShellHistory: () => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      pageSize: 25,
      advancedMode: false,
      shellHistory: [],
      setPageSize: (n) => set({ pageSize: n }),
      setAdvancedMode: (on) => set({ advancedMode: on }),
      pushShellHistory: (entry) =>
        set((s) => {
          const trimmed = entry.trim();
          if (!trimmed) return s;
          const rest = s.shellHistory.filter((h) => h !== trimmed);
          return { shellHistory: [trimmed, ...rest].slice(0, 50) };
        }),
      clearShellHistory: () => set({ shellHistory: [] }),
    }),
    { name: "ognom-settings" }
  )
);
