import {
  Activity,
  Bot,
  GitCompare,
  Rocket,
  Send,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * What's New content, shown once per app version on first launch (tracked in
 * localStorage) and reopenable any time from the About dialog.
 *
 * Release checklist: when shipping a new version, replace/extend SLIDES with
 * that release's highlights — the version gate keys off the app version at
 * runtime, so content just needs to describe the current release.
 */

export interface WhatsNewSlide {
  icon: LucideIcon;
  title: string;
  tagline: string;
  points: string[];
}

const SEEN_KEY = "ognom-whats-new-seen";

export const SLIDES: WhatsNewSlide[] = [
  {
    icon: Rocket,
    title: "The biggest Ognom update yet",
    tagline: "Move data between servers, diff collections, bring your own AI — all free.",
    points: [
      "Copy collections across connections, diff & sync any two",
      "Five AI providers for Studio, including fully local ones",
      "Server ops panel, profiler, and a schema relations map",
      "Stage profiling, index intelligence, bulk edits, and more",
    ],
  },
  {
    icon: Send,
    title: "Data in, data out — at any size",
    tagline: "Copy, import, and export stream in batches with live progress and cancel.",
    points: [
      "Copy to… any open connection — filter, indexes, progress",
      "Import JSON, NDJSON, CSV, and mongodump BSON",
      "Export to JSON, CSV, NDJSON, or BSON — streamed, not buffered",
      "Bulk update / delete with an affected-document preview",
    ],
  },
  {
    icon: GitCompare,
    title: "Diff & sync collections",
    tagline: "Staging vs production, before vs after — see exactly what differs.",
    points: [
      "Matched by _id: changed, missing, and extra documents",
      "Field-level diff for every changed document",
      "Selectively copy, overwrite, or delete to converge",
      "Works across connections, memory-safe on huge collections",
    ],
  },
  {
    icon: Bot,
    title: "Your AI, your choice",
    tagline: "Terminator mode now speaks OpenAI, Anthropic, Ollama, LM Studio & custom.",
    points: [
      "Run fully local — schema and data never leave your machine",
      "API keys live in the encrypted vault, like your DB passwords",
      "AI queries are hard-blocked from writing, in the backend",
      "Pin Studio prompts as insights and rerun them any time",
    ],
  },
  {
    icon: Zap,
    title: "Pipeline X-ray & index intelligence",
    tagline: "Know why a query is slow — and fix it in one click.",
    points: [
      "Stage stats: doc counts, drop-off % and timing per stage",
      "Unused-index detection right in the Indexes sheet",
      "Collection scan? Explain suggests the index — one click creates it",
      "Ask AI to read any explain plan in plain language",
    ],
  },
  {
    icon: Activity,
    title: "See your server, not just your data",
    tagline: "The new ops panel and schema map, right in the top bar.",
    points: [
      "Live operations with one-click kill for runaway queries",
      "Query profiler: enable, browse, and spot COLLSCANs",
      "Real-time server metrics, refreshed every 2 seconds",
      "Schema map: an inferred entity graph for any database",
    ],
  },
];

/** Version whose What's New the user has already seen (or dismissed). */
export function seenVersion(): string | null {
  return localStorage.getItem(SEEN_KEY);
}

export function markSeen(version: string): void {
  localStorage.setItem(SEEN_KEY, version);
}
