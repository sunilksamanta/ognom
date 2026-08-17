import { create } from "zustand";
import { persist } from "zustand/middleware";

export const PICKER_MIN = 200;
export const PICKER_MAX = 420;
export const PICKER_DEFAULT = 252;

export const DRAWER_MIN = 320;
export const DRAWER_MAX = 720;
export const DRAWER_DEFAULT = 404;

export const SHELL_EDITOR_MIN = 90;
export const SHELL_EDITOR_MAX = 700;

interface SettingsState {
  pageSize: number;
  /** Unlocks the raw shell view and other power-user options. */
  advancedMode: boolean;
  /** Offer a backup export before multi-document deletes (default on). */
  offerBackupOnDelete: boolean;
  /** Ask before switching a production workspace into edit mode. */
  confirmProdEdit: boolean;
  shellHistory: string[];
  pickerWidth: number;
  pickerCollapsed: boolean;
  drawerWidth: number;
  /** Height (px) of the Shell view code editor - drag-resizable. */
  shellEditorHeight: number;
  /** Pinned collections, keyed by profile id (or workspace id for ad-hoc). */
  pinned: Record<string, string[]>;
  /** Saved find filters per "profile/db.coll". */
  savedQueries: Record<string, { name: string; filter: string; sort: string; projection: string }[]>;

  setPageSize: (n: number) => void;
  setAdvancedMode: (on: boolean) => void;
  setOfferBackupOnDelete: (on: boolean) => void;
  setConfirmProdEdit: (on: boolean) => void;
  pushShellHistory: (entry: string) => void;
  clearShellHistory: () => void;
  setPickerWidth: (px: number) => void;
  togglePicker: () => void;
  setDrawerWidth: (px: number) => void;
  setShellEditorHeight: (px: number) => void;
  togglePin: (scope: string, key: string) => void;
  isPinned: (scope: string, key: string) => boolean;
  saveQuery: (scope: string, q: { name: string; filter: string; sort: string; projection: string }) => void;
  removeQuery: (scope: string, name: string) => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      pageSize: 25,
      advancedMode: false,
      offerBackupOnDelete: true,
      confirmProdEdit: true,
      shellHistory: [],
      pickerWidth: PICKER_DEFAULT,
      pickerCollapsed: false,
      drawerWidth: DRAWER_DEFAULT,
      shellEditorHeight: 180,
      pinned: {},
      savedQueries: {},
      setPageSize: (n) => set({ pageSize: n }),
      setAdvancedMode: (on) => set({ advancedMode: on }),
      setOfferBackupOnDelete: (on) => set({ offerBackupOnDelete: on }),
      setConfirmProdEdit: (on) => set({ confirmProdEdit: on }),
      pushShellHistory: (entry) =>
        set((s) => {
          const trimmed = entry.trim();
          if (!trimmed) return s;
          const rest = s.shellHistory.filter((h) => h !== trimmed);
          return { shellHistory: [trimmed, ...rest].slice(0, 50) };
        }),
      clearShellHistory: () => set({ shellHistory: [] }),
      setPickerWidth: (px) => set({ pickerWidth: clamp(px, PICKER_MIN, PICKER_MAX) }),
      togglePicker: () => set((s) => ({ pickerCollapsed: !s.pickerCollapsed })),
      setDrawerWidth: (px) => set({ drawerWidth: clamp(px, DRAWER_MIN, DRAWER_MAX) }),
      setShellEditorHeight: (px) =>
        set({ shellEditorHeight: clamp(px, SHELL_EDITOR_MIN, SHELL_EDITOR_MAX) }),
      togglePin: (scope, key) =>
        set((s) => {
          const list = s.pinned[scope] ?? [];
          const next = list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
          return { pinned: { ...s.pinned, [scope]: next } };
        }),
      isPinned: (scope, key) => (get().pinned[scope] ?? []).includes(key),
      saveQuery: (scope, q) =>
        set((s) => {
          const list = (s.savedQueries[scope] ?? []).filter((x) => x.name !== q.name);
          return { savedQueries: { ...s.savedQueries, [scope]: [...list, q] } };
        }),
      removeQuery: (scope, name) =>
        set((s) => ({
          savedQueries: {
            ...s.savedQueries,
            [scope]: (s.savedQueries[scope] ?? []).filter((x) => x.name !== name),
          },
        })),
    }),
    { name: "ognom-settings", version: 2 }
  )
);
