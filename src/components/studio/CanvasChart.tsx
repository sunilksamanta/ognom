import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";

export type ChartType = "bar" | "line" | "pie" | "donut";

export interface ChartData {
  type: ChartType;
  title?: string;
  labels: string[];
  values: number[];
}

export interface CanvasChartHandle {
  /** PNG snapshot of the current canvas (with an opaque background). */
  toPng: () => string | null;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const ANIM_MS = 800;

/** Read a `--token` HSL triple from the live theme and wrap it in hsl(). */
function cssHsl(token: string, alpha = 1): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return alpha === 1 ? `hsl(${raw})` : `hsl(${raw} / ${alpha})`;
}

/** Palette derived from the primary hue, stepping hue/lightness per series. */
function palette(n: number): string[] {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
  const hue = Number(raw.split(" ")[0]) || 160;
  return Array.from({ length: n }, (_, i) => {
    const h = (hue + i * 137.5) % 360; // golden-angle spacing — adjacent slices never clash
    return `hsl(${h.toFixed(0)} 62% ${i % 2 === 0 ? 52 : 62}%)`;
  });
}

function fmt(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

interface Geometry {
  hit: (x: number, y: number) => number | null; // index under pointer
}

export const CanvasChart = forwardRef<CanvasChartHandle, { data: ChartData }>(
  function CanvasChart({ data }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const hoverRef = useRef<number | null>(null);
    const geomRef = useRef<Geometry | null>(null);
    const animRef = useRef<number>(0);
    const startRef = useRef<number>(0);

    useImperativeHandle(ref, () => ({
      toPng: () => {
        const src = canvasRef.current;
        if (!src) return null;
        // Re-compose on an opaque background so exports look right anywhere.
        const out = document.createElement("canvas");
        out.width = src.width;
        out.height = src.height;
        const ctx = out.getContext("2d")!;
        ctx.fillStyle = cssHsl("--card");
        ctx.fillRect(0, 0, out.width, out.height);
        ctx.drawImage(src, 0, 0);
        return out.toDataURL("image/png");
      },
    }));

    useEffect(() => {
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) return;

      const draw = (progress: number) => {
        const dpr = window.devicePixelRatio || 1;
        const w = wrap.clientWidth;
        const h = wrap.clientHeight;
        if (w === 0 || h === 0) return;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        const ctx = canvas.getContext("2d")!;
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);
        ctx.font = "11px ui-sans-serif, system-ui, sans-serif";

        const fg = cssHsl("--foreground");
        const muted = cssHsl("--muted-foreground");
        const grid = cssHsl("--border", 0.6);
        const colors = palette(data.values.length);
        const hover = hoverRef.current;

        let top = 16;
        if (data.title) {
          ctx.fillStyle = fg;
          ctx.font = "600 13px ui-sans-serif, system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(data.title, w / 2, 20);
          ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
          top = 38;
        }

        const max = Math.max(...data.values, 0) || 1;

        if (data.type === "bar" || data.type === "line") {
          const left = 52;
          const bottom = h - 34;
          const plotW = w - left - 16;
          const plotH = bottom - top;

          // gridlines + y labels
          ctx.textAlign = "right";
          for (let i = 0; i <= 4; i++) {
            const y = bottom - (plotH * i) / 4;
            ctx.strokeStyle = grid;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(left, y);
            ctx.lineTo(left + plotW, y);
            ctx.stroke();
            ctx.fillStyle = muted;
            ctx.fillText(fmt((max * i) / 4), left - 8, y + 4);
          }

          const n = data.values.length;
          const step = plotW / Math.max(1, n);

          // x labels (skip when crowded)
          ctx.textAlign = "center";
          ctx.fillStyle = muted;
          const every = Math.ceil(n / Math.max(1, Math.floor(plotW / 70)));
          data.labels.forEach((label, i) => {
            if (i % every !== 0) return;
            const text = label.length > 12 ? label.slice(0, 11) + "…" : label;
            ctx.fillText(text, left + step * i + step / 2, h - 14);
          });

          if (data.type === "bar") {
            const barW = Math.min(48, step * 0.64);
            data.values.forEach((v, i) => {
              const bh = (v / max) * plotH * progress;
              const x = left + step * i + (step - barW) / 2;
              const y = bottom - bh;
              ctx.fillStyle = hover === i ? cssHsl("--primary") : colors[i % colors.length];
              ctx.beginPath();
              ctx.roundRect(x, y, barW, bh, [4, 4, 0, 0]);
              ctx.fill();
              if (hover === i || n <= 12) {
                ctx.fillStyle = fg;
                ctx.textAlign = "center";
                ctx.fillText(fmt(v), x + barW / 2, y - 6);
              }
            });
            geomRef.current = {
              hit: (px, py) => {
                if (py < top || py > bottom) return null;
                const i = Math.floor((px - left) / step);
                return i >= 0 && i < n ? i : null;
              },
            };
          } else {
            // line — animated left-to-right reveal with gradient fill
            const pts = data.values.map((v, i) => ({
              x: left + step * i + step / 2,
              y: bottom - (v / max) * plotH,
            }));
            const reveal = left + plotW * progress;
            ctx.save();
            ctx.beginPath();
            ctx.rect(left, 0, plotW * progress, h);
            ctx.clip();

            const fillGrad = ctx.createLinearGradient(0, top, 0, bottom);
            fillGrad.addColorStop(0, cssHsl("--primary", 0.28));
            fillGrad.addColorStop(1, cssHsl("--primary", 0.02));
            ctx.beginPath();
            pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
            ctx.lineTo(pts[pts.length - 1].x, bottom);
            ctx.lineTo(pts[0].x, bottom);
            ctx.closePath();
            ctx.fillStyle = fillGrad;
            ctx.fill();

            ctx.beginPath();
            pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
            ctx.strokeStyle = cssHsl("--primary");
            ctx.lineWidth = 2;
            ctx.lineJoin = "round";
            ctx.stroke();
            ctx.restore();

            pts.forEach((p, i) => {
              if (p.x > reveal) return;
              const active = hover === i;
              ctx.beginPath();
              ctx.arc(p.x, p.y, active ? 5 : 3, 0, Math.PI * 2);
              ctx.fillStyle = active ? fg : cssHsl("--primary");
              ctx.fill();
              if (active) {
                ctx.fillStyle = fg;
                ctx.textAlign = "center";
                ctx.fillText(`${data.labels[i]}: ${fmt(data.values[i])}`, p.x, p.y - 12);
              }
            });
            geomRef.current = {
              hit: (px) => {
                const i = Math.round((px - left - step / 2) / step);
                return i >= 0 && i < n ? i : null;
              },
            };
          }
        } else {
          // pie / donut — animated sweep + legend
          const total = data.values.reduce((a, b) => a + b, 0) || 1;
          const legendW = Math.min(190, w * 0.4);
          const cx = (w - legendW) / 2;
          const cy = top + (h - top) / 2;
          const R = Math.min(cx - 24, (h - top) / 2 - 18);
          const r = data.type === "donut" ? R * 0.58 : 0;
          let angle = -Math.PI / 2;
          const sweepTotal = Math.PI * 2 * progress;
          let used = 0;
          const arcs: { from: number; to: number }[] = [];

          data.values.forEach((v, i) => {
            const slice = (v / total) * Math.PI * 2;
            const sweep = Math.max(0, Math.min(slice, sweepTotal - used));
            used += slice;
            const from = angle;
            const to = angle + sweep;
            angle += slice;
            arcs.push({ from, to: from + slice });
            if (sweep <= 0) return;
            const active = hover === i;
            const RR = active ? R + 5 : R;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(from) * r, cy + Math.sin(from) * r);
            ctx.arc(cx, cy, RR, from, to);
            ctx.arc(cx, cy, r, to, from, true);
            ctx.closePath();
            ctx.fillStyle = colors[i % colors.length];
            ctx.fill();
            ctx.strokeStyle = cssHsl("--card");
            ctx.lineWidth = 2;
            ctx.stroke();
          });

          if (data.type === "donut") {
            ctx.fillStyle = fg;
            ctx.textAlign = "center";
            ctx.font = "600 16px ui-sans-serif, system-ui, sans-serif";
            ctx.fillText(fmt(total), cx, cy + 2);
            ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
            ctx.fillStyle = muted;
            ctx.fillText("total", cx, cy + 16);
            ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
          }

          // legend
          const lx = w - legendW + 6;
          let ly = top + 8;
          ctx.textAlign = "left";
          data.labels.slice(0, 14).forEach((label, i) => {
            ctx.fillStyle = colors[i % colors.length];
            ctx.beginPath();
            ctx.roundRect(lx, ly - 7, 9, 9, 2);
            ctx.fill();
            ctx.fillStyle = hover === i ? fg : muted;
            const pct = ((data.values[i] / total) * 100).toFixed(1);
            const text = label.length > 14 ? label.slice(0, 13) + "…" : label;
            ctx.fillText(`${text} · ${pct}%`, lx + 14, ly + 1);
            ly += 18;
          });
          if (data.labels.length > 14) {
            ctx.fillStyle = muted;
            ctx.fillText(`+${data.labels.length - 14} more`, lx + 14, ly + 1);
          }

          geomRef.current = {
            hit: (px, py) => {
              const dx = px - cx;
              const dy = py - cy;
              const dist = Math.hypot(dx, dy);
              if (dist < r || dist > R + 6) return null;
              let a = Math.atan2(dy, dx);
              if (a < -Math.PI / 2) a += Math.PI * 2;
              const idx = arcs.findIndex((s) => a >= s.from && a < s.to);
              return idx >= 0 ? idx : null;
            },
          };
        }
      };

      const tick = (now: number) => {
        const t = Math.min(1, (now - startRef.current) / ANIM_MS);
        draw(easeOutCubic(t));
        if (t < 1) animRef.current = requestAnimationFrame(tick);
      };
      const restart = () => {
        cancelAnimationFrame(animRef.current);
        startRef.current = performance.now();
        animRef.current = requestAnimationFrame(tick);
      };
      restart();

      const ro = new ResizeObserver(() => draw(1));
      ro.observe(wrap);

      const onMove = (e: MouseEvent) => {
        const rect = canvas.getBoundingClientRect();
        const idx = geomRef.current?.hit(e.clientX - rect.left, e.clientY - rect.top) ?? null;
        if (idx !== hoverRef.current) {
          hoverRef.current = idx;
          draw(1);
        }
      };
      const onLeave = () => {
        hoverRef.current = null;
        draw(1);
      };
      canvas.addEventListener("mousemove", onMove);
      canvas.addEventListener("mouseleave", onLeave);
      return () => {
        cancelAnimationFrame(animRef.current);
        ro.disconnect();
        canvas.removeEventListener("mousemove", onMove);
        canvas.removeEventListener("mouseleave", onLeave);
      };
    }, [data]);

    return (
      <div ref={wrapRef} className="h-full w-full">
        <canvas ref={canvasRef} className="cursor-crosshair" />
      </div>
    );
  }
);
