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

interface ConnectionsState {
  profiles: ProfileSummary[];
  security: SecurityInfo | null;
  status: "idle" | "connecting" | "connected";
  active: ConnectionInfo | null;
  /** Profile id currently being connected (spinner targeting). */
  connectingId: string | null;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  save: (input: ProfileInput) => Promise<ProfileSummary>;
  remove: (id: string) => Promise<void>;
  connect: (id: string) => Promise<boolean>;
  connectAdhoc: (input: ProfileInput) => Promise<boolean>;
  disconnect: () => Promise<void>;
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

export const useConnections = create<ConnectionsState>((set, get) => ({
  profiles: [],
  security: null,
  status: "idle",
  active: null,
  connectingId: null,

  init: async () => {
    try {
      const migrated = await migrateLegacyLocalStorage();
      const [profiles, security] = await Promise.all([api.listConnections(), api.securityInfo()]);
      set({ profiles, security });
      if (migrated > 0) {
        toast.success(`Moved ${migrated} saved connection${migrated > 1 ? "s" : ""} into encrypted storage`);
      }
    } catch (e) {
      toast.error(errMsg(e));
    }
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
    set({ status: "connecting", connectingId: id });
    try {
      const info = await api.connect(id);
      set({ status: "connected", active: info, connectingId: null });
      void get().refresh(); // refreshes lastUsedAt ordering
      return true;
    } catch (e) {
      set({ status: get().active ? "connected" : "idle", connectingId: null });
      toast.error(errMsg(e));
      return false;
    }
  },

  connectAdhoc: async (input) => {
    set({ status: "connecting", connectingId: null });
    try {
      const info = await api.connectInput(input);
      set({ status: "connected", active: info });
      return true;
    } catch (e) {
      set({ status: get().active ? "connected" : "idle" });
      toast.error(errMsg(e));
      return false;
    }
  },

  disconnect: async () => {
    try {
      await api.disconnect();
    } finally {
      set({ status: "idle", active: null });
    }
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
}));
