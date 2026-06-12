import { useEffect, useMemo, useRef, useState } from "react";
import { Database, Search, Table2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useExplorer } from "@/stores/explorer";
import { cn } from "@/lib/utils";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Item {
  key: string;
  database: string;
  collection: string;
}

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

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const { databases, collections, loadCollections, openCollection } = useExplorer();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Load any missing collection lists when the palette opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    for (const db of databases) {
      if (!collections[db.name]) void loadCollections(db.name);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo<Item[]>(() => {
    const all: Item[] = [];
    for (const db of databases) {
      for (const coll of collections[db.name] ?? []) {
        all.push({ key: `${db.name}.${coll.name}`, database: db.name, collection: coll.name });
      }
    }
    if (!query.trim()) return all.slice(0, 50);
    return all
      .map((item) => ({ item, score: fuzzyScore(query.trim(), item.key) }))
      .filter((x): x is { item: Item; score: number } => x.score !== null)
      .sort((a, b) => a.score - b.score)
      .slice(0, 50)
      .map((x) => x.item);
  }, [databases, collections, query]);

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const pick = (item: Item) => {
    openCollection(item.database, item.collection);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[20%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-[520px]">
        <DialogTitle className="sr-only">Go to collection</DialogTitle>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === "Enter" && items[cursor]) {
                e.preventDefault();
                pick(items[cursor]);
              }
            }}
            placeholder="Jump to a collection…"
            className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            esc
          </kbd>
        </div>
        <div ref={listRef} className="max-h-[300px] overflow-y-auto p-1.5">
          {items.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              No matching collections
            </p>
          )}
          {items.map((item, i) => (
            <button
              key={item.key}
              data-index={i}
              onClick={() => pick(item)}
              onMouseMove={() => setCursor(i)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm",
                i === cursor ? "bg-accent text-accent-foreground" : "text-foreground/90"
              )}
            >
              <Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="flex min-w-0 items-baseline gap-1.5">
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Database className="h-3 w-3" />
                  {item.database}
                </span>
                <span className="truncate font-medium">{item.collection}</span>
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
