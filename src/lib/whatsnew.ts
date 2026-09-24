/**
 * What's New content, shown once per app version on first launch (tracked in
 * localStorage) and reopenable any time from the About dialog.
 *
 * Release checklist: when shipping a new version, replace/extend SLIDES with
 * that release's highlights. The version gate keys off the app version at
 * runtime, so content just needs to describe the current release.
 */

export interface WhatsNewSlide {
  /** Release the slide belongs to, shown as a mono pill. */
  version: string;
  title: string;
  tagline: string;
  points: string[];
}

const SEEN_KEY = "ognom-whats-new-seen";

export const SLIDES: WhatsNewSlide[] = [
  {
    version: "2.1.0",
    title: "Types, tunnels and a clearer picture",
    tagline: "From collection to code in a click.",
    points: [
      "Export types: turn a collection's schema into TypeScript interfaces or Zod schemas - Node.js (ObjectId, Date) or frontend (strings), extract nested objects into named interfaces, literal unions, copy or save as .ts",
      "SSH tunnels: connect through a bastion with a key file, password or ssh-agent; host keys are checked against known_hosts",
      "Database overview replaces the schema map: sizes, indexes, unindexed and empty collections, inferred references, CSV / JSON export",
      "Editing a saved connection string now shows its host and username; switching to host and credentials keeps the password",
      "Picker footer shows live server latency; document counts load in one go and survive workspace switches",
      "A collection open in several tabs is numbered #1, #2, ... in the picker, header and title bar",
      "Active connection is a solid tile on the rail; fixes for the delete confirmation, clipped dropdown labels and the JSON view's pinned first line",
    ],
  },
  {
    version: "2.0.1",
    title: "Polish after the launch",
    tagline: "The console, sanded down.",
    points: [
      "Query dock: a real editor - multi-line, auto-closing braces and quotes, field and operator completions from the sampled schema, run only by the button",
      "Aggregate and Shell live in the dock next to Find; the view row is Table, Documents, Schema and Indexes",
      "Regex and date literals in queries: /pattern/i, new RegExp(), new Date()",
      "Drawer opens on Fields from the table and on JSON from Documents; insert works again",
      "The active connection is unmistakable on the rail",
      "Clear permission notices when your MongoDB user cannot see operations, the profiler, live stats or server details",
      "Import / Export menu, redesigned About, floral Bloom themes, many small fixes",
    ],
  },
  {
    version: "2.0.0",
    title: "Ognom 2.0",
    tagline: "A new console.",
    points: [
      "Complete redesign on the Ognom design system: 9 themes including follow-OS, 3 densities",
      "Rail with colour-tagged connection tiles, one click to switch workspaces",
      "Picker with pinned collections and saved queries next to the database list",
      "Document drawer with typed field editing, a JSON editor and a diff view",
      "Query dock that shows matched count, timing and the winning plan",
      "Production connections open read-only; edit mode is an explicit switch",
      "Backups offered before destructive deletes, drops and clears",
      "AI features were removed; Ognom is a focused MongoDB client",
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
