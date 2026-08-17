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
