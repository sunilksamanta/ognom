import { create } from "zustand";
import { toast } from "sonner";
import {
  api,
  errMsg,
  type CollInfo,
  type DbInfo,
  type Doc,
  type ShellOutcome,
  type StageInput,
} from "@/lib/api";
import { useSettings } from "@/stores/settings";

export type ViewMode = "json" | "table";
export type TabMode = "documents" | "aggregate" | "shell";

export interface DocsState {
  filter: string;
  sort: string;
  projection: string;
  limit: number;
  page: number; // 0-based
  docs: Doc[];
  loading: boolean;
  error: string | null;
  execMs: number | null;
  count: number | null;
  countExact: boolean;
  view: ViewMode;
  /** Bumped on every successful run so dialogs can refresh. */
  ranAt: number;
}

export interface Stage {
  id: string;
  op: string;
  body: string;
  enabled: boolean;
  collapsed: boolean;
}

export interface AggState {
  stages: Stage[];
  allowDiskUse: boolean;
  docs: Doc[] | null;
  loading: boolean;
  error: string | null;
  execMs: number | null;
  appliedDefaultLimit: boolean;
  /** Stage index the preview ran to (null = full pipeline). */
  ranToStage: number | null;
  view: ViewMode;
}

export interface ShellState {
  text: string;
  outcome: ShellOutcome | null;
  loading: boolean;
  error: string | null;
  view: ViewMode;
}

export interface Tab {
  id: string;
  database: string;
  collection: string;
  mode: TabMode;
  docs: DocsState;
  agg: AggState;
  shell: ShellState;
}

let nextId = 1;
const newId = (prefix: string) => `${prefix}-${nextId++}`;

export const newStage = (op = "$match", body = "{\n  \n}"): Stage => ({
  id: newId("stage"),
  op,
  body,
  enabled: true,
  collapsed: false,
});

const freshDocs = (limit: number): DocsState => ({
  filter: "",
  // Newest-first by default (ObjectId _ids embed creation time); user can edit.
  sort: "{ _id: -1 }",
  projection: "",
  limit,
  page: 0,
  docs: [],
  loading: false,
  error: null,
  execMs: null,
  count: null,
  countExact: false,
  view: "json",
  ranAt: 0,
});

const freshAgg = (): AggState => ({
  stages: [newStage()],
  allowDiskUse: false,
  docs: null,
  loading: false,
  error: null,
  execMs: null,
  appliedDefaultLimit: false,
  ranToStage: null,
  view: "json",
});

const freshShell = (collection: string): ShellState => ({
  text: `db.${/^[A-Za-z_][\w]*$/.test(collection) ? collection : `getCollection("${collection}")`}.find({})\n`,
  outcome: null,
  loading: false,
  error: null,
  view: "json",
});

/** The per-workspace slice of explorer state — cached when switching away from
 *  a workspace and restored when switching back. */
export interface ExplorerSnapshot {
  databases: DbInfo[];
  collections: Record<string, CollInfo[]>;
  expanded: Record<string, boolean>;
  sidebarFilter: string;
  tabs: Tab[];
  activeTabId: string | null;
}

interface ExplorerState {
  databases: DbInfo[];
  loadingDbs: boolean;
  collections: Record<string, CollInfo[]>;
  expanded: Record<string, boolean>;
  sidebarFilter: string;

  tabs: Tab[];
  activeTabId: string | null;

  reset: () => void;
  /** Capture the current workspace's slice for caching. */
  snapshot: () => ExplorerSnapshot;
  /** Replace state with a cached slice, or reset to empty when `null`. */
  hydrate: (snap: ExplorerSnapshot | null) => void;
  loadDatabases: () => Promise<void>;
  toggleDatabase: (name: string) => Promise<void>;
  loadCollections: (db: string) => Promise<CollInfo[]>;
  setSidebarFilter: (v: string) => void;

  openCollection: (database: string, collection: string) => void;
  /** Always open a fresh tab, even if the collection is already open. */
  openCollectionInNewTab: (database: string, collection: string) => void;
  openShellWithQuery: (database: string, collection: string, query: string) => void;
  closeTab: (id: string) => void;
  /** Close every tab pointing at a collection (e.g. after it is dropped). */
  closeTabsForCollection: (database: string, collection: string) => void;
  /** Re-run the find for any open document tabs of a collection (e.g. after clear). */
  refreshTabsForCollection: (database: string, collection: string) => void;
  setActiveTab: (id: string) => void;
  setTabMode: (id: string, mode: TabMode) => void;

  patchDocs: (id: string, patch: Partial<DocsState>) => void;
  patchAgg: (id: string, patch: Partial<AggState>) => void;
  patchShell: (id: string, patch: Partial<ShellState>) => void;

  runFind: (id: string, opts?: { resetPage?: boolean }) => Promise<void>;
  refreshActiveDocs: () => Promise<void>;
  runAggregate: (id: string, uptoStage?: number) => Promise<void>;
  runShell: (id: string) => Promise<void>;
}

export const useExplorer = create<ExplorerState>((set, get) => {
  const patchTab = (id: string, fn: (tab: Tab) => Tab) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? fn(t) : t)) }));

  const tab = (id: string) => get().tabs.find((t) => t.id === id);

  const makeTab = (database: string, collection: string): Tab => ({
    id: newId("tab"),
    database,
    collection,
    mode: "documents",
    docs: freshDocs(useSettings.getState().pageSize),
    agg: freshAgg(),
    shell: freshShell(collection),
  });

  return {
    databases: [],
    loadingDbs: false,
    collections: {},
    expanded: {},
    sidebarFilter: "",
    tabs: [],
    activeTabId: null,

    reset: () =>
      set({
        databases: [],
        loadingDbs: false,
        collections: {},
        expanded: {},
        sidebarFilter: "",
        tabs: [],
        activeTabId: null,
      }),

    snapshot: () => {
      const s = get();
      return {
        databases: s.databases,
        collections: s.collections,
        expanded: s.expanded,
        sidebarFilter: s.sidebarFilter,
        tabs: s.tabs,
        activeTabId: s.activeTabId,
      };
    },

    hydrate: (snap) => {
      if (!snap) {
        get().reset();
        return;
      }
      set({
        databases: snap.databases,
        loadingDbs: false,
        collections: snap.collections,
        expanded: snap.expanded,
        sidebarFilter: snap.sidebarFilter,
        tabs: snap.tabs,
        activeTabId: snap.activeTabId,
      });
    },

    loadDatabases: async () => {
      set({ loadingDbs: true });
      try {
        set({ databases: await api.listDatabases() });
      } catch (e) {
        toast.error(errMsg(e));
      } finally {
        set({ loadingDbs: false });
      }
    },

    loadCollections: async (db) => {
      try {
        const colls = await api.listCollections(db);
        set((s) => ({ collections: { ...s.collections, [db]: colls } }));
        return colls;
      } catch (e) {
        toast.error(errMsg(e));
        return [];
      }
    },

    toggleDatabase: async (name) => {
      const isOpen = get().expanded[name];
      set((s) => ({ expanded: { ...s.expanded, [name]: !isOpen } }));
      if (!isOpen && !get().collections[name]) {
        await get().loadCollections(name);
      }
    },

    setSidebarFilter: (v) => set({ sidebarFilter: v }),

    openCollection: (database, collection) => {
      const existing = get().tabs.find(
        (t) => t.database === database && t.collection === collection
      );
      if (existing) {
        set({ activeTabId: existing.id });
        return;
      }
      const tab = makeTab(database, collection);
      set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
      void get().runFind(tab.id);
    },

    openCollectionInNewTab: (database, collection) => {
      const tab = makeTab(database, collection);
      set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
      void get().runFind(tab.id);
    },

    // Hand-off from Studio: open (or focus) a collection straight into Shell
    // mode with the query pre-filled, ready to optimize.
    openShellWithQuery: (database, collection, query) => {
      const existing = get().tabs.find(
        (t) => t.database === database && t.collection === collection
      );
      if (existing) {
        patchTab(existing.id, (t) => ({
          ...t,
          mode: "shell",
          shell: { ...t.shell, text: query, outcome: null, error: null },
        }));
        set({ activeTabId: existing.id });
        return;
      }
      const id = newId("tab");
      const tab: Tab = {
        id,
        database,
        collection,
        mode: "shell",
        docs: freshDocs(useSettings.getState().pageSize),
        agg: freshAgg(),
        shell: { ...freshShell(collection), text: query },
      };
      set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }));
    },

    closeTab: (id) => {
      set((s) => {
        const idx = s.tabs.findIndex((t) => t.id === id);
        const tabs = s.tabs.filter((t) => t.id !== id);
        let activeTabId = s.activeTabId;
        if (activeTabId === id) {
          activeTabId = tabs[Math.min(idx, tabs.length - 1)]?.id ?? null;
        }
        return { tabs, activeTabId };
      });
    },

    closeTabsForCollection: (database, collection) => {
      set((s) => {
        const tabs = s.tabs.filter(
          (t) => !(t.database === database && t.collection === collection)
        );
        const activeTabId = tabs.some((t) => t.id === s.activeTabId)
          ? s.activeTabId
          : tabs[tabs.length - 1]?.id ?? null;
        return { tabs, activeTabId };
      });
    },

    refreshTabsForCollection: (database, collection) => {
      get()
        .tabs.filter(
          (t) => t.database === database && t.collection === collection && t.mode === "documents"
        )
        .forEach((t) => void get().runFind(t.id));
    },

    setActiveTab: (id) => set({ activeTabId: id }),
    setTabMode: (id, mode) => patchTab(id, (t) => ({ ...t, mode })),

    patchDocs: (id, patch) => patchTab(id, (t) => ({ ...t, docs: { ...t.docs, ...patch } })),
    patchAgg: (id, patch) => patchTab(id, (t) => ({ ...t, agg: { ...t.agg, ...patch } })),
    patchShell: (id, patch) => patchTab(id, (t) => ({ ...t, shell: { ...t.shell, ...patch } })),

    runFind: async (id, opts) => {
      const t = tab(id);
      if (!t) return;
      const docsState = opts?.resetPage ? { ...t.docs, page: 0 } : t.docs;
      get().patchDocs(id, { loading: true, error: null, page: docsState.page });
      try {
        const page = await api.findDocuments({
          database: t.database,
          collection: t.collection,
          filter: docsState.filter,
          sort: docsState.sort,
          projection: docsState.projection,
          limit: docsState.limit,
          skip: docsState.page * docsState.limit,
        });
        get().patchDocs(id, {
          docs: page.docs,
          execMs: page.execMs,
          loading: false,
          ranAt: Date.now(),
        });
        // Count in the background; don't block results.
        void api
          .countDocuments(t.database, t.collection, docsState.filter)
          .then((c) => get().patchDocs(id, { count: c.count ?? null, countExact: c.exact }))
          .catch(() => get().patchDocs(id, { count: null }));
      } catch (e) {
        get().patchDocs(id, { loading: false, error: errMsg(e) });
      }
    },

    refreshActiveDocs: async () => {
      const id = get().activeTabId;
      if (id) await get().runFind(id);
    },

    runAggregate: async (id, uptoStage) => {
      const t = tab(id);
      if (!t) return;
      const enabled = t.agg.stages
        .map((s, i) => ({ stage: s, index: i }))
        .filter(({ stage, index }) => stage.enabled && (uptoStage === undefined || index <= uptoStage));
      const stages: StageInput[] = enabled.map(({ stage }) => ({ op: stage.op, body: stage.body }));
      if (stages.length === 0) {
        get().patchAgg(id, { error: "Add at least one enabled stage" });
        return;
      }
      get().patchAgg(id, { loading: true, error: null });
      try {
        const page = await api.aggregate(t.database, t.collection, stages, t.agg.allowDiskUse);
        get().patchAgg(id, {
          docs: page.docs,
          execMs: page.execMs,
          appliedDefaultLimit: page.appliedDefaultLimit,
          ranToStage: uptoStage ?? null,
          loading: false,
        });
      } catch (e) {
        get().patchAgg(id, { loading: false, error: errMsg(e) });
      }
    },

    runShell: async (id) => {
      const t = tab(id);
      if (!t || !t.shell.text.trim()) return;
      get().patchShell(id, { loading: true, error: null });
      useSettings.getState().pushShellHistory(t.shell.text);
      try {
        const outcome = await api.runShell(t.database, t.shell.text);
        get().patchShell(id, { outcome, loading: false });
        if (outcome.kind === "useDb" && outcome.useDb) {
          // `use other` rebinds the tab's database context.
          patchTab(id, (tab) => ({ ...tab, database: outcome.useDb! }));
          toast.info(`Shell context switched to "${outcome.useDb}"`);
        }
      } catch (e) {
        get().patchShell(id, { loading: false, error: errMsg(e) });
      }
    },
  };
});
