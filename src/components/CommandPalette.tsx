import { useEffect, useMemo, useRef, useState } from "react";
import { Brush, Database, Key, Plus, Rows3, Search, Settings, Terminal } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useExplorer } from "@/stores/explorer";
import { useConnections } from "@/stores/connections";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";
import { formatCount } from "@/lib/bson";
import { cn } from "@/lib/utils";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Item =
  | { kind: "collection"; key: string; database: string; collection: string; label: string; count?: number }
  | { kind: "database"; key: string; database: string; label: string }
  | { kind: "connection"; key: string; id: string; label: string; live: boolean; profile: boolean }
  | { kind: "action"; key: string; label: string; hint?: string; run: () => void; icon: React.ReactNode };

/** Cheap subsequence-ish fuzzy match; returns a score (lower = better) or null. */
function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return t.length;
  const idx = t.indexOf(q);
  if (idx >= 0) return idx * 2 + (t.length - q.length) * 0.01;
  let qi = 0;
  let gaps = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
    else if (qi > 0) gaps++;
  }
  return qi === q.length ? 100 + gaps : null;
}

/** Highlight the query inside a label. */
function Hi({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <b>{text.slice(i, i + q.length)}</b>
      {text.slice(i + q.length)}
    </>
  );
}

/**
 * The palette: one input that spans collections, databases, connections and
 * actions. Enter opens, Cmd+Enter opens a collection in a new tab.
 */
export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const databases = useExplorer((s) => s.databases);
  const collections = useExplorer((s) => s.collections);
  const counts = useExplorer((s) => s.counts);
  const loadCollections = useExplorer((s) => s.loadCollections);
  const openCollection = useExplorer((s) => s.openCollection);
  const openCollectionInNewTab = useExplorer((s) => s.openCollectionInNewTab);
  const openCollectionAs = useExplorer((s) => s.openCollectionAs);
  const selectDatabase = useExplorer((s) => s.selectDatabase);
  const activeTab = useExplorer((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const profiles = useConnections((s) => s.profiles);
  const workspaces = useConnections((s) => s.workspaces);
  const connect = useConnections((s) => s.connect);
  const switchTo = useConnections((s) => s.switchTo);
  const setAdvancedMode = useSettings((s) => s.setAdvancedMode);
  const ui = useUi((s) => s.set);
  const openConnections = useUi((s) => s.openConnections);

  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    for (const db of databases) {
      if (!collections[db.name]) void loadCollections(db.name);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = query.trim();

  const groups = useMemo(() => {
    const colls: Item[] = [];
    for (const db of databases) {
      for (const coll of collections[db.name] ?? []) {
        colls.push({
          kind: "collection",
          key: `c:${db.name}.${coll.name}`,
          database: db.name,
          collection: coll.name,
          label: `${db.name}.${coll.name}`,
          count: counts[`${db.name}.${coll.name}`],
        });
      }
    }
    const dbs: Item[] = databases.map((d) => ({ kind: "database", key: `d:${d.name}`, database: d.name, label: d.name }));
    const conns: Item[] = [
      ...profiles.map((p) => ({
        kind: "connection" as const,
        key: `p:${p.id}`,
        id: p.id,
        label: p.name,
        live: workspaces.some((w) => w.info.profileId === p.id),
        profile: true,
      })),
      ...workspaces
        .filter((w) => !w.info.profileId)
        .map((w) => ({ kind: "connection" as const, key: `w:${w.info.id}`, id: w.info.id, label: w.info.name, live: true, profile: false })),
    ];
    const actions: Item[] = [
      { kind: "action", key: "a:new", label: "New connection", run: () => openConnections("form"), icon: <Plus /> },
      { kind: "action", key: "a:manage", label: "Manage connections", run: () => openConnections("list"), icon: <Database /> },
      { kind: "action", key: "a:theme", label: "Appearance: themes and density", hint: "⌘⇧T cycles", run: () => ui({ appearance: true }), icon: <Brush /> },
      { kind: "action", key: "a:settings", label: "Settings", run: () => ui({ settings: true }), icon: <Settings /> },
      { kind: "action", key: "a:ops", label: "Server operations", run: () => ui({ ops: true }), icon: <Key /> },
      { kind: "action", key: "a:help", label: "Help and shortcuts", run: () => ui({ help: true }), icon: <Key /> },
      ...(activeTab
        ? [
            {
              kind: "action" as const,
              key: "a:shell",
              label: `Shell on ${activeTab.collection}`,
              run: () => {
                setAdvancedMode(true);
                openCollectionAs(activeTab.database, activeTab.collection, "shell");
              },
              icon: <Terminal />,
            },
            {
              kind: "action" as const,
              key: "a:indexes",
              label: `Indexes of ${activeTab.collection}`,
              run: () => openCollectionAs(activeTab.database, activeTab.collection, "indexes"),
              icon: <Key />,
            },
          ]
        : []),
    ];

    const rank = (items: Item[], max: number) =>
      (q
        ? items
            .map((item) => ({ item, score: fuzzyScore(q, item.label) }))
            .filter((x): x is { item: Item; score: number } => x.score !== null)
            .sort((a, b) => a.score - b.score)
            .map((x) => x.item)
        : items
      ).slice(0, max);

    return [
      { title: "Collections", items: rank(colls, q ? 40 : 12) },
      { title: "Databases", items: rank(dbs, q ? 10 : 0) },
      { title: "Connections", items: rank(conns, q ? 10 : 4) },
      { title: "Actions", items: rank(actions, q ? 8 : 4) },
    ].filter((g) => g.items.length > 0);
  }, [databases, collections, counts, profiles, workspaces, q, activeTab, openConnections, ui, setAdvancedMode, openCollectionAs]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => setCursor(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const pick = (item: Item, newTab = false) => {
    onOpenChange(false);
    switch (item.kind) {
      case "collection":
        if (newTab) openCollectionInNewTab(item.database, item.collection);
        else openCollection(item.database, item.collection);
        break;
      case "database":
        void selectDatabase(item.database);
        break;
      case "connection":
        if (item.profile) void connect(item.id);
        else void switchTo(item.id);
        break;
      case "action":
        item.run();
        break;
    }
  };

  let index = -1;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="ov" onClick={() => onOpenChange(false)}>
          <DialogPrimitive.Content
            className="palette outline-none"
            onClick={(e) => e.stopPropagation()}
            aria-describedby={undefined}
          >
            <DialogPrimitive.Title className="sr-only">Find anything</DialogPrimitive.Title>
            <div className="pin">
              <Search />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setCursor((c) => Math.min(c + 1, flat.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setCursor((c) => Math.max(c - 1, 0));
                  } else if (e.key === "Enter" && flat[cursor]) {
                    e.preventDefault();
                    pick(flat[cursor], e.metaKey || e.ctrlKey);
                  }
                }}
                placeholder="Jump to a collection, database, connection or action"
                spellCheck={false}
              />
              <span className="kbd">esc</span>
            </div>
            <div ref={listRef} className="plist">
              {flat.length === 0 && (
                <p className="px-3 py-8 text-center text-[12.5px] text-text-3">Nothing matches</p>
              )}
              {groups.map((g) => (
                <div key={g.title}>
                  <div className="pgh">{g.title}</div>
                  {g.items.map((item) => {
                    index += 1;
                    const i = index;
                    return (
                      <button
                        key={item.key}
                        data-index={i}
                        onClick={(e) => pick(item, e.metaKey || e.ctrlKey)}
                        onMouseMove={() => setCursor(i)}
                        className={cn("prow", i === cursor && "on")}
                      >
                        {item.kind === "collection" && <Rows3 />}
                        {item.kind === "database" && <Database />}
                        {item.kind === "connection" && (
                          <i className={cn("dot", !item.live && "off")} style={{ margin: "0 3px" }} />
                        )}
                        {item.kind === "action" && item.icon}
                        <span className="n">
                          {item.kind === "collection" ? (
                            <>
                              <span className="text-text-3">{item.database}.</span>
                              <Hi text={item.collection} q={q} />
                            </>
                          ) : (
                            <Hi text={item.label} q={q} />
                          )}
                        </span>
                        <span className="r">
                          {item.kind === "collection" && item.count !== undefined && `${formatCount(item.count)} docs`}
                          {item.kind === "connection" && (item.live ? <span className="pill ok">live</span> : "connect")}
                          {item.kind === "database" && "switch database"}
                          {item.kind === "action" && item.hint}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="pfoot">
              <span>↑↓ navigate</span>
              <span>⏎ open</span>
              <span>⌘⏎ open in new tab</span>
              <span className="ml-auto">collections · databases · connections · actions</span>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
