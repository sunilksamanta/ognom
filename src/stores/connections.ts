import { create } from "zustand";
import { toast } from "sonner";
import {
  api,
  errMsg,
  type ConnectionInfo,
  type ProfileInput,
  type ProfileSummary,
  type SecurityInfo,
} from "@/lib/api";
import { useExplorer, type ExplorerSnapshot } from "@/stores/explorer";

/** One open connection: its server metadata plus per-workspace UI mode. */
export interface Workspace {
  info: ConnectionInfo; // info.id is the workspace key (pool key on the backend)
  /** Terminator (Ognom Studio) mode is remembered per workspace. */
  terminator: boolean;
}

/** Persisted across restarts so open workspaces auto-reconnect on launch. Only
 *  saved profiles can be restored — ad-hoc connections have no stored secret. */
const SESSION_KEY = "ognom-sessions";
interface SessionShape {
  /** Profile ids of the workspaces that were open, in order. */
  profileIds: string[];
  /** Profile id of the active workspace, if it was a saved profile. */
  activeProfileId: string | null;
}

interface ConnectionsState {
  profiles: ProfileSummary[];
  security: SecurityInfo | null;
  status: "idle" | "connecting" | "connected";

  /** Every open connection. */
  workspaces: Workspace[];
  /** Workspace id of the active one. */
  activeId: string | null;
  /** Active workspace's server info — mirror kept for status bar / dialogs. */
  active: ConnectionInfo | null;
  /** Profile id currently being connected (spinner targeting); `null` for ad-hoc. */
  connectingId: string | null;
  /** True while auto-reconnecting persisted workspaces on launch. */
  restoring: boolean;
  /** Cached explorer slice per inactive workspace (active one lives in useExplorer). */
  explorerCache: Record<string, ExplorerSnapshot>;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  save: (input: ProfileInput) => Promise<ProfileSummary>;
  remove: (id: string) => Promise<void>;
  connect: (id: string) => Promise<boolean>;
  connectAdhoc: (input: ProfileInput) => Promise<boolean>;
  switchTo: (id: string) => Promise<void>;
  disconnectWorkspace: (id: string) => Promise<void>;
  disconnectAll: () => Promise<void>;
  setTerminator: (on: boolean) => void;
  restoreSessions: () => Promise<void>;
  setSecretBackend: (backend: "keychain" | "file") => Promise<void>;
}

/** One-time migration of plaintext connections saved by the old prototype. */
async function migrateLegacyLocalStorage(): Promise<number> {
  const raw = localStorage.getItem("mongoConnections");
  if (!raw) return 0;
  let migrated = 0;
  try {
    const list = JSON.parse(raw) as { name?: string; connectionString?: string }[];
    for (const item of list) {
      if (!item?.connectionString) continue;
      await api.saveConnection({
        name: item.name?.trim() || "Imported connection",
        kind: "uri",
        uri: item.connectionString,
        fields: {
          scheme: "mongodb",
          host: "",
          extraHosts: [],
          directConnection: false,
          tlsEnabled: false,
          tlsInsecure: false,
        },
      });
      migrated++;
    }
    localStorage.removeItem("mongoConnections");
  } catch {
    // Leave the key in place if anything goes wrong.
  }
  return migrated;
}

export const useConnections = create<ConnectionsState>((set, get) => {
  const explorer = () => useExplorer.getState();

  /** Remember which saved-profile workspaces are open + which is active. */
  const persistSessions = () => {
    const { workspaces, activeId } = get();
    const profileIds = workspaces
      .map((w) => w.info.profileId)
      .filter((id): id is string => !!id);
    const activeWs = workspaces.find((w) => w.info.id === activeId);
    const session: SessionShape = {
      profileIds,
      activeProfileId: activeWs?.info.profileId ?? null,
    };
    if (profileIds.length === 0) localStorage.removeItem(SESSION_KEY);
    else localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  };

  /** Snapshot the active workspace's explorer slice into the cache, then
   *  hydrate the explorer with `toId`'s cached slice (or a fresh one). The new
   *  slice must be in place before `activeId` flips so the remounted tree binds
   *  to the right data. */
  const swapExplorer = (toId: string | null): Record<string, ExplorerSnapshot> => {
    const { activeId, explorerCache } = get();
    const cache = { ...explorerCache };
    if (activeId) cache[activeId] = explorer().snapshot();
    explorer().hydrate(toId ? cache[toId] ?? null : null);
    return cache;
  };

  /** Add a freshly-established connection as a new workspace and activate it. */
  const adoptWorkspace = (info: ConnectionInfo) => {
    const cache = swapExplorer(info.id); // info.id is new → hydrates fresh
    set((s) => ({
      workspaces: [...s.workspaces, { info, terminator: false }],
      activeId: info.id,
      active: info,
      status: "connected",
      connectingId: null,
      explorerCache: cache,
    }));
    persistSessions();
  };

  return {
    profiles: [],
    security: null,
    status: "idle",
    workspaces: [],
    activeId: null,
    active: null,
    connectingId: null,
    // Start in the restoring state when a previous session is on disk, so the
    // launch shows a loader instead of flashing the welcome screen first.
    restoring: !!localStorage.getItem(SESSION_KEY),
    explorerCache: {},

    init: async () => {
      try {
        const migrated = await migrateLegacyLocalStorage();
        const [profiles, security] = await Promise.all([
          api.listConnections(),
          api.securityInfo(),
        ]);
        set({ profiles, security });
        if (migrated > 0) {
          toast.success(`Moved ${migrated} saved connection${migrated > 1 ? "s" : ""} into encrypted storage`);
        }
      } catch (e) {
        toast.error(errMsg(e));
      }
      await get().restoreSessions();
    },

    refresh: async () => {
      set({ profiles: await api.listConnections() });
    },

    save: async (input) => {
      const summary = await api.saveConnection(input);
      await get().refresh();
      return summary;
    },

    remove: async (id) => {
      await api.deleteConnection(id);
      await get().refresh();
    },

    connect: async (id) => {
      // Already open? Just switch to it instead of opening a duplicate.
      const existing = get().workspaces.find((w) => w.info.profileId === id);
      if (existing) {
        await get().switchTo(existing.info.id);
        return true;
      }
      set({ status: "connecting", connectingId: id });
      try {
        const info = await api.connect(id);
        adoptWorkspace(info);
        void get().refresh(); // refreshes lastUsedAt ordering
        return true;
      } catch (e) {
        set((s) => ({ status: s.workspaces.length ? "connected" : "idle", connectingId: null }));
        toast.error(errMsg(e));
        return false;
      }
    },

    connectAdhoc: async (input) => {
      set({ status: "connecting", connectingId: null });
      try {
        const info = await api.connectInput(input);
        adoptWorkspace(info);
        return true;
      } catch (e) {
        set((s) => ({ status: s.workspaces.length ? "connected" : "idle", connectingId: null }));
        toast.error(errMsg(e));
        return false;
      }
    },

    switchTo: async (id) => {
      if (id === get().activeId) return;
      const target = get().workspaces.find((w) => w.info.id === id);
      if (!target) return;
      try {
        await api.switchWorkspace(id);
      } catch (e) {
        toast.error(errMsg(e));
        return;
      }
      const cache = swapExplorer(id);
      set({ activeId: id, active: target.info, explorerCache: cache });
      persistSessions();
    },

    disconnectWorkspace: async (id) => {
      try {
        await api.disconnectWorkspace(id);
      } catch (e) {
        toast.error(errMsg(e)); // continue with local cleanup regardless
      }
      const wasActive = get().activeId === id;
      const idx = get().workspaces.findIndex((w) => w.info.id === id);
      const remaining = get().workspaces.filter((w) => w.info.id !== id);
      const cache = { ...get().explorerCache };
      delete cache[id];

      if (!wasActive) {
        set({ workspaces: remaining, explorerCache: cache });
        persistSessions();
        return;
      }

      // The active workspace was closed — fall back to a neighbour.
      const neighbour = remaining[Math.min(idx, remaining.length - 1)] ?? null;
      if (neighbour) {
        try {
          await api.switchWorkspace(neighbour.info.id);
        } catch {
          // Even if the backend switch fails, keep the UI consistent.
        }
        explorer().hydrate(cache[neighbour.info.id] ?? null);
        delete cache[neighbour.info.id];
        set({
          workspaces: remaining,
          activeId: neighbour.info.id,
          active: neighbour.info,
          explorerCache: cache,
        });
      } else {
        explorer().hydrate(null);
        set({ workspaces: [], activeId: null, active: null, status: "idle", explorerCache: {} });
      }
      persistSessions();
    },

    disconnectAll: async () => {
      try {
        await api.disconnect();
      } finally {
        explorer().hydrate(null);
        set({ workspaces: [], activeId: null, active: null, status: "idle", explorerCache: {} });
        localStorage.removeItem(SESSION_KEY);
      }
    },

    setTerminator: (on) =>
      set((s) => ({
        workspaces: s.workspaces.map((w) =>
          w.info.id === s.activeId ? { ...w, terminator: on } : w
        ),
      })),

    restoreSessions: async () => {
      let saved: SessionShape | null = null;
      try {
        const raw = localStorage.getItem(SESSION_KEY);
        saved = raw ? (JSON.parse(raw) as SessionShape) : null;
      } catch {
        saved = null;
      }
      if (!saved?.profileIds?.length) {
        set({ restoring: false });
        return;
      }

      set({ restoring: true });
      const restored: Workspace[] = [];
      for (const profileId of saved.profileIds) {
        try {
          const info = await api.connect(profileId);
          restored.push({ info, terminator: false });
        } catch {
          // Profile deleted or server unreachable — skip it silently.
        }
      }
      if (restored.length === 0) {
        set({ restoring: false });
        return;
      }

      const activeWs =
        restored.find((w) => w.info.profileId === saved!.activeProfileId) ?? restored[0];
      try {
        await api.switchWorkspace(activeWs.info.id);
      } catch {
        // ignore — the last connect already left a valid active on the backend
      }
      explorer().hydrate(null); // active workspace mounts fresh and loads databases
      set({
        workspaces: restored,
        activeId: activeWs.info.id,
        active: activeWs.info,
        status: "connected",
        restoring: false,
      });
      persistSessions();
    },

    setSecretBackend: async (backend) => {
      try {
        const security = await api.setSecretBackend(backend);
        set({ security });
        toast.success(
          backend === "keychain"
            ? "Encryption key moved into the OS keychain"
            : "Encryption key moved to the local key file"
        );
      } catch (e) {
        toast.error(errMsg(e));
        // Re-read actual state so the toggle reflects reality.
        set({ security: await api.securityInfo().catch(() => get().security) });
      }
    },
  };
});
