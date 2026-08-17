import { useState, type ReactNode } from "react";
import { BookOpen, Boxes, Keyboard, Search, ShieldCheck } from "lucide-react";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const IS_MAC = navigator.platform.toUpperCase().includes("MAC");
const MOD = IS_MAC ? "⌘" : "Ctrl";
const SHIFT = IS_MAC ? "⇧" : "Shift";
const ENTER = IS_MAC ? "⏎" : "Enter";

// ---------------------------------------------------------------------------
// building blocks
// ---------------------------------------------------------------------------

function K({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded-[4px] bg-panel-2 px-1 py-0.5 font-mono text-[0.9em] text-text">{children}</code>;
}

function Block({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-[var(--r-sm)] border border-line bg-panel px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-text">
      {children}
    </pre>
  );
}

function H({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 mt-5 text-[13px] font-semibold text-text first:mt-0">{children}</h3>;
}

function P({ children }: { children: ReactNode }) {
  return <p className="mb-3 text-[12.5px] leading-relaxed text-text-2">{children}</p>;
}

function B({ children }: { children: ReactNode }) {
  return <b className="font-medium text-text">{children}</b>;
}

/** Labelled rows in a `.card` (label + description). */
function Rows({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <div className="card">
      {rows.map(([l, r], i) => (
        <div key={i} className="row !py-[10px]">
          <div className="l">
            <b>{l}</b>
            <span>{r}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// sections
// ---------------------------------------------------------------------------

const SECTIONS = [
  { id: "overview", label: "Overview", icon: BookOpen },
  { id: "connections", label: "Connections", icon: Boxes },
  { id: "querying", label: "Querying", icon: Search },
  { id: "safety", label: "Safety", icon: ShieldCheck },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

function Overview() {
  return (
    <>
      <H>The console</H>
      <P>
        Ognom is one window with five parts. Everything is reachable with the mouse; the shortcuts on the last page
        get you there faster.
      </P>
      <Rows
        rows={[
          [
            "Rail",
            <>
              The thin column on the far left. Colour-tagged tiles for every saved connection (click to connect or
              switch, several can be live at once) and, below, the sections for the current workspace.
            </>,
          ],
          [
            "Picker",
            <>
              Database button, one search box that filters collections and fields, then <B>Open</B> tabs,{" "}
              <B>Pinned</B> collections, <B>Collections</B> and <B>Saved queries</B>. Toggle it with <K>{MOD} B</K>;
              drag its edge to resize.
            </>,
          ],
          [
            "Canvas",
            <>
              The collection tab. A title with a stat strip (documents, size, indexes), then the views:{" "}
              <B>Table</B>, <B>Documents</B>, <B>Schema</B>, <B>Aggregate</B>, <B>Indexes</B> and, in advanced
              mode, <B>Shell</B>. The <B>dock</B> at the bottom is the query transport: filter, sort, projection,
              run, explain, save.
            </>,
          ],
          [
            "Drawer",
            <>
              Slides in from the right when you open or insert a document. Three tabs: <B>Fields</B> (typed inline
              editing that keeps BSON types), <B>JSON</B> (full editor in shell syntax) and <B>Diff</B> against the
              loaded document.
            </>,
          ],
          [
            "Status bar",
            <>
              Connection, database and the <B>write-mode switch</B>. Read-only workspaces show a lock; click it to
              enter edit mode for this session.
            </>,
          ],
        ]}
      />
    </>
  );
}

function Connections() {
  return (
    <>
      <H>Saved profiles</H>
      <P>
        A connection is a saved profile: URI or host, credentials, an optional colour tag that paints its rail tile,
        and a session mode. Connect from the rail; the workspace remembers its open tabs and picker state between
        launches, and reconnects on start.
      </P>
      <H>Session modes</H>
      <div className="opts">
        <div className="opt cursor-default">
          <b>
            <span className="pill ok mr-1.5">rw</span>Read &amp; write
          </b>
          <span>Everything is enabled. The default for local and development servers.</span>
        </div>
        <div className="opt cursor-default">
          <b>
            <span className="pill warn mr-1.5">ro</span>Read-only
          </b>
          <span>Writes are blocked in the backend for the whole session. Browse and query freely.</span>
        </div>
        <div className="opt cursor-default">
          <b>
            <span className="pill dgr mr-1.5">prod</span>Production
          </b>
          <span>Opens read-only every time. Edit mode is an explicit switch in the status bar and asks first.</span>
        </div>
      </div>
      <H>Credentials</H>
      <P>
        Passwords are AES-256-GCM encrypted at rest. The master key lives in your OS keychain, or in a private key
        file next to the app data if you turn the keychain off in Settings. It never leaves the machine, so a copied
        connections file cannot be decrypted elsewhere.
      </P>
      <H>Import and export</H>
      <Rows
        rows={[
          ["Export without secrets", "A portable file with hosts, options and tags only. Safe to share; passwords are re-entered on import."],
          [
            "Encrypted export",
            "Includes credentials, re-encrypted under a passphrase you choose (Argon2id + AES-256). There is no recovery without the passphrase.",
          ],
          ["Import", "Pick a file; encrypted ones ask for the passphrase. Everything comes in as new profiles, existing ones are untouched."],
          ["Copy connection string", "From a tile's menu, with or without the password, ready for mongosh."],
        ]}
      />
    </>
  );
}

function Querying() {
  return (
    <>
      <H>The dock</H>
      <P>
        Type a filter in the dock and press <K>{MOD} {ENTER}</K> (or <K>{ENTER}</K> inside the field). The dock uses
        shell syntax, so unquoted keys, <Code>ObjectId()</Code>, <Code>ISODate()</Code> and every{" "}
        <Code>$operator</Code> work as they do in mongosh. Sort and projection have their own fields; the strip above
        the input shows <B>matched</B> count, <B>timing</B> and the <B>winning plan</B> (a collection scan is
        highlighted).
      </P>
      <Block>{`{ status: "active", createdAt: { $gte: ISODate("2025-01-01") } }
{ _id: ObjectId("66f0c2a1e4b0f5c8d9a1b2c3") }
{ tags: { $in: ["beta", "vip"] }, "profile.age": { $gt: 30 } }`}</Block>
      <Rows
        rows={[
          ["Explain", "Runs the same query with explain and shows the plan tree, stage timings and index usage."],
          ["Saved queries", "Save the current filter, sort and projection under a name; they live in the picker under Saved queries and open with one click."],
          ["Table vs Documents", "Table flattens documents into sortable columns for scanning; Documents shows each one as a tree and is where you edit."],
        ]}
      />
      <H>Aggregate</H>
      <P>
        The pipeline builder holds one editor per stage. Toggle a stage off to skip it, drag to reorder, and use{" "}
        <B>preview</B> to see the output of the pipeline up to that stage. Stage stats show document counts, drop-off
        and timing per stage so you can see where a pipeline gets slow.
      </P>
      <H>Shell (advanced)</H>
      <P>
        Turn on <B>Advanced mode</B> in Settings to add the Shell view. It runs one statement at a time with the full
        extended syntax and method chaining; press <K>{MOD} {ENTER}</K> to run.
      </P>
      <Block>{`db.orders.aggregate([
  { $match: { createdAt: { $gte: ISODate("2025-01-01") } } },
  { $group: { _id: "$status", count: { $sum: 1 } } },
  { $sort: { count: -1 } }
])`}</Block>
    </>
  );
}

function Safety() {
  return (
    <>
      <H>Guard rails</H>
      <P>Ognom assumes the database in front of you matters. Destructive actions are slow on purpose.</P>
      <Rows
        rows={[
          ["Drop and clear", "Dropping a database or collection, or clearing a collection, asks you to type its name and offers an export first."],
          ["Multi-document delete", "Deleting several documents offers a JSON backup before anything is removed (Settings > Safety)."],
          ["Read-only workspaces", "Writes are refused at the API layer, not just hidden in the UI. Read-only and production sessions cannot write until you flip the status bar switch."],
          ["Production edit mode", "Leaving read-only on a production connection asks for confirmation and lasts for the session only."],
        ]}
      />
      <div className="notice acc mt-3">
        <ShieldCheck />
        <span>
          Nothing leaves your machine. There is no account, no telemetry and no cloud; connections, saved queries
          and settings are local files.
        </span>
      </div>
    </>
  );
}

function Shortcuts() {
  const rows: [ReactNode, string][] = [
    [<K>{MOD} K</K>, "Find anything: collections, fields, actions"],
    [<K>{MOD} O</K>, "Open a collection"],
    [<K>{MOD} N</K>, "Insert a document in the current collection"],
    [<K>{MOD} W</K>, "Close the current tab"],
    [<K>{MOD} B</K>, "Toggle the picker"],
    [<K>{MOD} {ENTER}</K>, "Run the current query or pipeline"],
    [<K>{MOD} S</K>, "Save the document in the drawer"],
    [<K>{MOD} ,</K>, "Settings"],
    [<K>{MOD} {SHIFT} T</K>, "Cycle theme"],
    [<K>Esc</K>, "Close the drawer, clear the search, dismiss dialogs"],
  ];
  return (
    <>
      <H>Keyboard</H>
      <div className="card">
        {rows.map(([keys, desc], i) => (
          <div key={i} className="row !py-[9px]">
            <span className="text-[12.5px] text-text-2">{desc}</span>
            <span className="rr">{keys}</span>
          </div>
        ))}
      </div>
      <P>
        <span className="mt-3 block" />
        Right-click a connection tile, a collection or a document for its menu. Middle-click a tab to close it.
      </P>
    </>
  );
}

const RENDER: Record<SectionId, () => ReactNode> = {
  overview: Overview,
  connections: Connections,
  querying: Querying,
  safety: Safety,
  shortcuts: Shortcuts,
};

// ---------------------------------------------------------------------------
// dialog
// ---------------------------------------------------------------------------

export function HelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [active, setActive] = useState<SectionId>("overview");
  const Body = RENDER[active];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[80vh] max-w-[860px]">
        <DialogHeader>
          <DialogTitle>Help</DialogTitle>
          <DialogDescription>how the console fits together · connections · querying · safety · keys</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex-row gap-0 overflow-hidden p-0 pt-0">
          <nav className="no-select flex w-[176px] shrink-0 flex-col gap-[2px] border-r border-line px-2 py-2">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActive(s.id)}
                className={cn("it", active === s.id && "on")}
                aria-current={active === s.id ? "page" : undefined}
              >
                <s.icon />
                <span className="text-[12.5px] font-medium">{s.label}</span>
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
            <Body />
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
