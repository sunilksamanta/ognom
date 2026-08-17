import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, errMsg } from "@/lib/api";
import { formatCount } from "@/lib/bson";

/**
 * Inferred entity map for a database: collections as nodes on a circle,
 * reference-shaped fields (userId -> users, ...) as labeled edges.
 */

interface RelationsDialogProps {
  open: boolean;
  database: string;
  onOpenChange: (open: boolean) => void;
}

interface Node {
  name: string;
  count: number;
  fields: string[];
}
interface Edge {
  from: string;
  field: string;
  to: string;
}

const W = 880;
const H = 560;
const NODE_W = 132;
const NODE_H = 40;

export function RelationsDialog({ open, database, onOpenChange }: RelationsDialogProps) {
  const [nodes, setNodes] = useState<Node[] | null>(null);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !database) return;
    setNodes(null);
    setEdges([]);
    setError(null);
    api
      .dbRelations(database)
      .then((r) => {
        setNodes(r.nodes);
        setEdges(r.edges);
        setTruncated(r.truncated);
      })
      .catch((e) => setError(errMsg(e)));
  }, [open, database]);

  // Circle layout - related nodes cluster naturally with few collections;
  // with many, hover-highlighting carries the readability.
  const pos = useMemo(() => {
    const map: Record<string, { x: number; y: number }> = {};
    if (!nodes) return map;
    const cx = W / 2;
    const cy = H / 2;
    const r = Math.min(W, H) / 2 - 70;
    nodes.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
      map[n.name] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    });
    return map;
  }, [nodes]);

  const isDim = (name: string) =>
    hover !== null &&
    hover !== name &&
    !edges.some(
      (e) => (e.from === hover && e.to === name) || (e.to === hover && e.from === name)
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[820px]">
        <DialogHeader>
          <DialogTitle>Schema map</DialogTitle>
          <DialogDescription>
            {database} · relations inferred from sampled reference fields (userId -&gt; users, ...) · hover a
            collection to highlight its links
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {error ? (
            <div className="notice dgr mono">{error}</div>
          ) : nodes === null ? (
            <div className="flex h-[420px] items-center justify-center gap-2 text-[12.5px] text-text-3">
              <Loader2 className="spin h-4 w-4 text-text-3" />
              Sampling collections...
            </div>
          ) : nodes.length === 0 ? (
            <p className="flex h-[300px] items-center justify-center text-[12.5px] text-text-3">
              No collections in this database.
            </p>
          ) : (
            <>
              <div className="overflow-auto rounded-[var(--r-sm)] border border-line bg-panel">
                <svg
                  viewBox={`0 0 ${W} ${H}`}
                  className="w-full"
                  style={{ minWidth: 700 }}
                  onMouseLeave={() => setHover(null)}
                >
                  {/* edges under nodes */}
                  {edges.map((e, i) => {
                    const a = pos[e.from];
                    const b = pos[e.to];
                    if (!a || !b) return null;
                    const dim =
                      hover !== null && hover !== e.from && hover !== e.to;
                    const mx = (a.x + b.x) / 2;
                    const my = (a.y + b.y) / 2;
                    // Bow the midpoint toward the center so parallel edges split.
                    const bowX = mx + (W / 2 - mx) * 0.18;
                    const bowY = my + (H / 2 - my) * 0.18;
                    return (
                      <g key={i} opacity={dim ? 0.12 : 1}>
                        <path
                          d={`M ${a.x} ${a.y} Q ${bowX} ${bowY} ${b.x} ${b.y}`}
                          fill="none"
                          stroke="var(--accent)"
                          strokeOpacity={0.45}
                          strokeWidth={1.5}
                        />
                        <circle cx={b.x} cy={b.y} r={3.5} fill="var(--accent)" opacity={0.7} />
                        <text
                          x={bowX}
                          y={bowY - 4}
                          textAnchor="middle"
                          fill="var(--text-3)"
                          fontSize={9.5}
                          fontFamily="var(--mono)"
                        >
                          {e.field}
                        </text>
                      </g>
                    );
                  })}
                  {/* nodes */}
                  {nodes.map((n) => {
                    const p = pos[n.name];
                    if (!p) return null;
                    return (
                      <g
                        key={n.name}
                        opacity={isDim(n.name) ? 0.25 : 1}
                        onMouseEnter={() => setHover(n.name)}
                        style={{ cursor: "default" }}
                      >
                        <rect
                          x={p.x - NODE_W / 2}
                          y={p.y - NODE_H / 2}
                          width={NODE_W}
                          height={NODE_H}
                          rx={8}
                          fill={hover === n.name ? "var(--accent-soft)" : "var(--panel-2)"}
                          stroke={hover === n.name ? "var(--accent)" : "var(--line-2)"}
                          strokeWidth={hover === n.name ? 1.6 : 1}
                        />
                        <text
                          x={p.x}
                          y={p.y - 2}
                          textAnchor="middle"
                          fontSize={12}
                          fontWeight={500}
                          fill="var(--text)"
                          fontFamily="var(--mono)"
                        >
                          {n.name.length > 18 ? `${n.name.slice(0, 17)}...` : n.name}
                        </text>
                        <text
                          x={p.x}
                          y={p.y + 13}
                          textAnchor="middle"
                          fontSize={9.5}
                          fill="var(--text-3)"
                          fontFamily="var(--mono)"
                        >
                          {formatCount(n.count)} docs
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
              <div className="flex items-center justify-between gap-4 font-mono text-[11px] text-text-3">
                <span>
                  {nodes.length} collection{nodes.length === 1 ? "" : "s"} ·{" "}
                  {edges.length} inferred relation{edges.length === 1 ? "" : "s"}
                  {truncated && " · list capped at 30 collections"}
                </span>
                {edges.length === 0 && (
                  <span className="text-right">
                    No reference-shaped fields found - relations are inferred from ObjectId fields
                    named after other collections.
                  </span>
                )}
              </div>
            </>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
