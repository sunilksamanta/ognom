import { create } from "zustand";
import type { ProfileSummary } from "@/lib/api";

/** App-wide overlays, so any surface (rail, status bar, palette, keyboard)
 *  can open them without prop drilling. */
interface UiState {
  palette: boolean;
  /** Connections modal: closed, list, or the form for a new/edited profile. */
  connections: { open: false } | { open: true; view: "list" | "form"; editing: ProfileSummary | null };
  appearance: boolean;
  settings: boolean;
  help: boolean;
  ops: boolean;
  serverInfo: boolean;
  about: boolean;
  whatsNew: boolean;

  setPalette: (open: boolean) => void;
  openConnections: (view?: "list" | "form", editing?: ProfileSummary | null) => void;
  closeConnections: () => void;
  set: (patch: Partial<Pick<UiState, "appearance" | "settings" | "help" | "ops" | "serverInfo" | "about" | "whatsNew">>) => void;
}

export const useUi = create<UiState>((set) => ({
  palette: false,
  connections: { open: false },
  appearance: false,
  settings: false,
  help: false,
  ops: false,
  serverInfo: false,
  about: false,
  whatsNew: false,
  setPalette: (open) => set({ palette: open }),
  openConnections: (view = "list", editing = null) => set({ connections: { open: true, view, editing } }),
  closeConnections: () => set({ connections: { open: false } }),
  set: (patch) => set(patch),
}));
