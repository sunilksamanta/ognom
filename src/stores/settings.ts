import { create } from "zustand";
import { persist } from "zustand/middleware";

export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 480;

interface SettingsState {
  pageSize: number;
  /** Unlocks the raw shell tab and other power-user options. */
  advancedMode: boolean;
  shellHistory: string[];
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  setPageSize: (n: number) => void;
  setAdvancedMode: (on: boolean) => void;
  pushShellHistory: (entry: string) => void;
  clearShellHistory: () => void;
  setSidebarWidth: (px: number) => void;
  toggleSidebar: () => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      pageSize: 25,
      advancedMode: false,
      shellHistory: [],
      sidebarWidth: 256,
      sidebarCollapsed: false,
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
      setSidebarWidth: (px) =>
        set({ sidebarWidth: Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(px))) }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    { name: "ognom-settings" }
  )
);
