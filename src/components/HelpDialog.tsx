import { useState, type ReactNode } from "react";
import {
  ArrowRightLeft,
  BarChart3,
  BookOpen,
  Boxes,
  Code2,
  Cpu,
  Download,
  Gauge,
  Keyboard,
  Layers,
  Lightbulb,
  Link2,
  ListTree,
  Lock,
  MessagesSquare,
  PanelsTopLeft,
  PlugZap,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  Upload,
  Wrench,
  Zap,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const IS_MAC = navigator.platform.toUpperCase().includes("MAC");
const MOD = IS_MAC ? "⌘" : "Ctrl";

// ---------------------------------------------------------------------------
// little building blocks
// ---------------------------------------------------------------------------

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground">
      {children}
    </code>
  );
}

function Block({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border bg-card px-3 py-2.5 font-mono text-[12px] leading-relaxed text-foreground">
      {children}
    </pre>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
      {children}
    </kbd>
  );
}

function Audience({ who }: { who: "dev" | "po" }) {
  return who === "dev" ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-500">
      <SquareTerminal className="h-3 w-3" /> Developers
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
      <Sparkles className="h-3 w-3" /> Product owners
    </span>
  );
}

function H({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 mt-6 text-sm font-semibold first:mt-0">{children}</h3>;
}

function P({ children }: { children: ReactNode }) {
  return <p className="mb-3 text-[13px] leading-relaxed text-muted-foreground">{children}</p>;
}

function Feature({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Cpu;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3 rounded-lg border bg-card p-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0">
        <p className="text-[13px] font-medium">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

/** A prompt/statement → what it does example. */
function Example({ q, children }: { q: string; children: ReactNode }) {
  return (
    <div className="rounded-md border bg-card p-2.5">
      <p className="font-mono text-[12px] leading-relaxed text-foreground">{q}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// sections
// ---------------------------------------------------------------------------

const SECTIONS = [
  { id: "overview", label: "Overview", icon: BookOpen },
  { id: "connections", label: "Connections", icon: Boxes },
  { id: "studio", label: "Studio (no-code)", icon: Cpu },
  { id: "shell", label: "Shell & Explorer", icon: SquareTerminal },
  { id: "examples", label: "Examples", icon: Lightbulb },
  { id: "ai", label: "AI, cost & safety", icon: ShieldCheck },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

function Overview() {
  return (
    <>
      <H>Two ways to work, one database</H>
      <P>
        Ognom has two modes you can switch between any time from the toggle in the header. Both talk
        to the same connection — pick whichever fits the task.
      </P>
      <div className="grid gap-3 sm:grid-cols-2">
        <Feature icon={PanelsTopLeft} title="Normal — the classic workspace">
          Browse collections, build queries visually, run aggregations, and drop into a raw shell.
          Built for developers who want full control. <Audience who="dev" />
        </Feature>
        <Feature icon={Cpu} title="Terminator — Ognom Studio">
          Ask questions in plain English; Studio writes the MongoDB query, runs it, and charts the
          answer. No query language needed. <Audience who="po" />
        </Feature>
      </div>
      <H>Getting connected</H>
      <P>
        Use the connection name at the top-left to add or switch connections — you can keep several
        open at once and switch between them in a click (see{" "}
        <strong className="text-foreground">Connections</strong>). Once connected, the sidebar lists
        every database and collection — click one to open it in a tab, or press <Kbd>{MOD} K</Kbd> to
        jump straight to a collection by name.
      </P>
      <H>Which mode should I use?</H>
      <P>
        If you write Mongo queries, stay in <strong className="text-foreground">Normal</strong> —
        Documents/Aggregate/Shell give you everything plus an AI assistant. If you just want answers
        and charts from your data, switch to <strong className="text-foreground">Terminator</strong>{" "}
        and chat.
      </P>
    </>
  );
}

function Connections() {
  return (
    <>
      <H>Many connections, one click to switch</H>
      <P>
        The connection name at the top-left is your <strong className="text-foreground">active
        workspace</strong>. Connect to as many servers as you like — when there's room they sit
        side-by-side as pills for one-click switching, and the rest tuck into a switcher you open by
        clicking the name. Each workspace is fully independent.
      </P>
      <div className="grid gap-3 sm:grid-cols-2">
        <Feature icon={ArrowRightLeft} title="Switch instantly">
          Clicking a workspace flips to it with no reconnect — the connection stays live in the
          background, so it's immediate.
        </Feature>
        <Feature icon={Layers} title="Each keeps its place">
          Every workspace remembers its own open tabs, sidebar, and even whether it's in Normal or
          Terminator mode.
        </Feature>
        <Feature icon={RotateCcw} title="Reopens where you left off">
          The workspaces you had open reconnect automatically the next time you launch Ognom.
        </Feature>
        <Feature icon={PlugZap} title="Disconnect just one">
          The plug icon closes the current workspace; the others stay connected. Or close any from
          the switcher with the <Code>✕</Code>.
        </Feature>
      </div>

      <H>Export &amp; import connections</H>
      <P>
        From the connection manager (the chevron next to the name → <em>Manage connections</em>), you
        can move your saved connections between machines — two honest ways:
      </P>
      <div className="grid gap-3 sm:grid-cols-2">
        <Feature icon={Download} title="Without passwords">
          A portable file of just the connection details. Safe to share or store; you re-enter
          passwords on import.
        </Feature>
        <Feature icon={Lock} title="Encrypted backup">
          Includes credentials, re-encrypted under a <strong className="text-foreground">passphrase
          you set</strong> (Argon2id + AES-256). The only safe way to carry passwords across
          machines — there's no recovery if you lose the passphrase.
        </Feature>
        <Feature icon={Upload} title="Import">
          Pick an export file; encrypted ones ask for the passphrase. Everything comes in as new
          connections — your existing ones are untouched.
        </Feature>
        <Feature icon={Link2} title="Copy a connection string">
          Each connection's menu copies its URI — <em>with</em> the password (for pasting into
          mongosh) or <em>without</em>.
        </Feature>
      </div>

      <H>Safe by default</H>
      <P>
        Credentials are <strong className="text-foreground">AES-256-GCM encrypted</strong> at rest;
        the master key lives in a private key file or, with one toggle, your OS keychain — and never
        leaves your machine (so a copied file can't be decrypted elsewhere). Deleting a connection
        asks you to <strong className="text-foreground">type its name</strong> to confirm.
      </P>
    </>
  );
}

function Studio() {
  return (
    <>
      <div className="mb-1 flex items-center gap-2">
        <Audience who="po" />
      </div>
      <H>Chat with your data</H>
      <P>
        Switch the header toggle to <strong className="text-foreground">Terminator</strong>, pick a{" "}
        <strong className="text-foreground">database</strong> and a{" "}
        <strong className="text-foreground">collection</strong>, then just type what you want to
        know. Studio generates the query, runs it safely, and shows a table — plus a chart when the
        answer is numeric.
      </P>
      <div className="grid gap-3 sm:grid-cols-2">
        <Feature icon={MessagesSquare} title="It's a conversation">
          Follow-up prompts keep context: ask “now just the last 30 days”, “make it a pie chart”,
          “only active ones”.
        </Feature>
        <Feature icon={Layers} title="Whole database (joins)">
          Choose “Whole database” instead of one collection and Studio can join across collections —
          “orders per customer”, “revenue by category”.
        </Feature>
        <Feature icon={BarChart3} title="Charts & export">
          Switch between bar / line / pie / donut, export the chart as PNG, or the data as JSON/CSV.
        </Feature>
        <Feature icon={Lightbulb} title="Suggestions & summaries">
          Stuck for ideas? Hit <em>Suggest questions</em>. After results, <em>Summarize</em> gives a
          plain-English readout.
        </Feature>
        <Feature icon={BookOpen} title="History that remembers">
          Every chat is saved. Reopen one from <em>History</em> (or the welcome screen) and it
          restores the database, collection, and full transcript.
        </Feature>
        <Feature icon={Gauge} title="Hand off to a developer">
          On any answer, <em>View query → Optimize in Shell</em> sends the generated query to the
          developer Shell to refine.
        </Feature>
      </div>
      <H>See & trust the query</H>
      <P>
        Every answer has a <em>View query</em> toggle showing the exact MongoDB statement, which
        collection it ran on, and how the chart was built — so nothing is a black box. Studio is{" "}
        <strong className="text-foreground">read-only</strong>: it never edits or deletes data.
      </P>
    </>
  );
}

function Shell() {
  return (
    <>
      <div className="mb-1 flex items-center gap-2">
        <Audience who="dev" />
      </div>
      <H>The collection workspace</H>
      <P>Each collection tab has three modes:</P>
      <div className="grid gap-3 sm:grid-cols-3">
        <Feature icon={PanelsTopLeft} title="Documents">
          Filter, sort, project, paginate. View, edit, duplicate, and delete documents.
        </Feature>
        <Feature icon={ListTree} title="Aggregate">
          A staged pipeline builder with per-stage previews and <Code>allowDiskUse</Code>.
        </Feature>
        <Feature icon={SquareTerminal} title="Shell">
          Real mongosh-style statements. Unlock it via <em>Advanced mode</em> in Settings.
        </Feature>
      </div>
      <H>Shell mode</H>
      <P>
        Run one statement at a time with full extended syntax — <Code>ObjectId(…)</Code>,{" "}
        <Code>ISODate(…)</Code>, unquoted keys, comments, and method chaining. Press{" "}
        <Kbd>{MOD} ↵</Kbd> to run. Drag the handle under the editor to resize it.
      </P>
      <Block>{`db.books.find({ status: "active" })
  .sort({ createdAt: -1 })
  .limit(20)`}</Block>
      <H>Built-in AI assistant</H>
      <P>
        The Shell has one-click AI actions — and when a query errors, a{" "}
        <strong className="text-foreground">Fix with AI</strong> button appears that sends the error
        plus your query for an instant fix.
      </P>
      <div className="grid gap-2 sm:grid-cols-2">
        <Feature icon={Wrench} title="Fix · Optimize · Explain">
          Repair syntax errors, restructure for performance, or get a plain-English walkthrough.
        </Feature>
        <Feature icon={ShieldCheck} title="Indexes & safety">
          Get exact <Code>createIndex</Code> suggestions, or add missing limits/projections.
        </Feature>
      </div>
      <H>Schema & indexes</H>
      <P>
        Every tab has <em>Schema</em> (field types & coverage from sampling) and <em>Indexes</em>{" "}
        (list, create, drop, and collection stats) in the top-right.
      </P>
    </>
  );
}

function Examples() {
  return (
    <>
      <H>
        <span className="inline-flex items-center gap-2">
          Ask Studio in plain English <Audience who="po" />
        </span>
      </H>
      <div className="grid gap-2">
        <Example q="count orders by status as a pie chart">
          Groups every order by its status and charts the totals.
        </Example>
        <Example q="top 10 customers by total spend">
          Sums each customer's orders and returns the biggest spenders.
        </Example>
        <Example q="documents created per day over the last 30 days">
          A time series — great as a line chart.
        </Example>
        <Example q="[Whole database] revenue by product category">
          Joins orders to products and rolls up revenue per category.
        </Example>
        <Example q="[Whole database] users who have never placed an order">
          Finds users with no matching orders.
        </Example>
      </div>

      <H>
        <span className="inline-flex items-center gap-2">
          Shell statements <Audience who="dev" />
        </span>
      </H>
      <div className="space-y-2.5">
        <Block>{`// one document by id
db.users.findOne({ _id: ObjectId("66f0c2…") })`}</Block>
        <Block>{`// filter + sort + limit
db.books.find({ status: "active" }).sort({ createdAt: -1 }).limit(20)`}</Block>
        <Block>{`// group & count
db.orders.aggregate([
  { $match: { createdAt: { $gte: ISODate("2024-01-01") } } },
  { $group: { _id: "$status", count: { $sum: 1 } } },
  { $sort: { count: -1 } }
])`}</Block>
        <Block>{`// cross-collection join
db.orders.aggregate([
  { $lookup: { from: "users", localField: "user", foreignField: "_id", as: "u" } },
  { $unwind: "$u" },
  { $group: { _id: "$u.name", spent: { $sum: "$total" } } }
])`}</Block>
        <Block>{`show dbs        // list databases
use analytics  // switch database`}</Block>
      </div>
    </>
  );
}

function Ai() {
  return (
    <>
      <H>Connecting AI</H>
      <P>
        Studio and the Shell AI assistant use OpenAI. Add your API key in{" "}
        <strong className="text-foreground">Settings → Prompts &amp; AI</strong> (or the key button
        in the Studio header). It's stored locally on your machine and sent only to{" "}
        <Code>api.openai.com</Code> from Ognom's backend — never through the web layer.
      </P>
      <H>Model & reasoning</H>
      <P>
        One editable model powers everything (default <Code>gpt-5.4-nano</Code>). The mode toggle
        controls how hard it thinks:
      </P>
      <div className="grid gap-3 sm:grid-cols-2">
        <Feature icon={Zap} title="Normal mode">
          Fast, minimal reasoning. Great for everyday queries and quick charts.
        </Feature>
        <Feature icon={Cpu} title="Deep Think mode">
          Turns on reasoning on the same model — for tricky multi-collection joins and ambiguous
          questions.
        </Feature>
      </div>
      <H>Token usage & cost</H>
      <P>
        Every AI answer shows the tokens it used (hover for the input/output split), and each chat
        and the whole conversation show running totals. When you switch to an unrelated topic,
        Studio suggests starting a <strong className="text-foreground">new chat</strong> — a fresh
        chat doesn't re-send the previous conversation, so it costs fewer tokens.
      </P>
      <H>Safety guardrails</H>
      <div className="grid gap-2 sm:grid-cols-3">
        <Feature icon={ShieldCheck} title="Read-only">
          AI never runs writes — no <Code>$out</Code>, <Code>$merge</Code>, updates, or deletes from
          prompts.
        </Feature>
        <Feature icon={Gauge} title="Capped results">
          Results are limited to 500 documents so a prompt can't pull your whole collection.
        </Feature>
        <Feature icon={Code2} title="Always visible">
          The generated query is always shown — review it before trusting the answer.
        </Feature>
      </div>
    </>
  );
}

function Shortcuts() {
  const rows: [ReactNode, string][] = [
    [
      <>
        <Kbd>{MOD} K</Kbd>
      </>,
      "Go to collection (command palette)",
    ],
    [
      <>
        <Kbd>{MOD} B</Kbd>
      </>,
      "Toggle the sidebar",
    ],
    [
      <>
        <Kbd>{MOD} ↵</Kbd>
      </>,
      "Run the current Shell / query editor",
    ],
    [
      <>
        <Kbd>↵</Kbd> <span className="text-muted-foreground">/</span> <Kbd>Shift ↵</Kbd>
      </>,
      "Send a Studio chat message / new line",
    ],
  ];
  return (
    <>
      <H>Keyboard shortcuts</H>
      <div className="overflow-hidden rounded-lg border">
        {rows.map(([keys, desc], i) => (
          <div
            key={i}
            className={cn(
              "flex items-center justify-between gap-4 px-4 py-2.5 text-[13px]",
              i % 2 === 0 ? "bg-card" : "bg-background"
            )}
          >
            <span className="text-muted-foreground">{desc}</span>
            <span className="flex shrink-0 items-center gap-1">{keys}</span>
          </div>
        ))}
      </div>
      <P>
        <span className="mt-3 block" />
        Tip: middle-click a tab to close it, and right-click documents for quick actions.
      </P>
    </>
  );
}

const RENDER: Record<SectionId, () => ReactNode> = {
  overview: Overview,
  connections: Connections,
  studio: Studio,
  shell: Shell,
  examples: Examples,
  ai: Ai,
  shortcuts: Shortcuts,
};

// ---------------------------------------------------------------------------
// dialog
// ---------------------------------------------------------------------------

export function HelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [active, setActive] = useState<SectionId>("overview");
  const Body = RENDER[active];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] w-full max-w-4xl flex-col gap-0 overflow-hidden p-0">
        <div className="no-select flex items-center gap-2.5 border-b px-5 py-3.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
            <BookOpen className="h-4 w-4 text-primary" />
          </div>
          <div>
            <DialogTitle className="text-base">Ognom Help</DialogTitle>
            <p className="text-xs text-muted-foreground">
              Everything you need — for developers and product owners.
            </p>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* nav */}
          <nav className="no-select w-48 shrink-0 space-y-0.5 border-r p-2">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setActive(s.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] font-medium transition-colors",
                  active === s.id
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <s.icon className="h-4 w-4 shrink-0" />
                {s.label}
              </button>
            ))}
          </nav>

          {/* content */}
          <ScrollArea className="min-h-0 flex-1">
            <div className="px-6 py-5">
              <Body />
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
