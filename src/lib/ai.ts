import { api } from "@/lib/api";
import { activeAiConfig, PROVIDER_META, useStudio } from "@/stores/studio";

/** Token usage for one or more AI calls. */
export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

export const ZERO_USAGE: TokenUsage = { input: 0, output: 0, total: 0 };

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return { input: a.input + b.input, output: a.output + b.output, total: a.total + b.total };
}

async function chat(
  system: string,
  user: string,
  jsonMode: boolean
): Promise<{ text: string; usage: TokenUsage }> {
  const state = useStudio.getState();
  const cfg = activeAiConfig(state);
  if (!cfg.model) {
    throw new Error(
      `Set a model for ${PROVIDER_META[cfg.provider].label} in Settings → Prompts & AI`
    );
  }
  const res = await api.aiChat({
    provider: cfg.provider,
    model: cfg.model,
    system,
    user,
    jsonMode,
    reasoning: cfg.reasoning,
    baseUrl: cfg.baseUrl,
  });
  return {
    text: res.content,
    usage: { input: res.inputTokens, output: res.outputTokens, total: res.totalTokens },
  };
}

/** Strip markdown fences if the model wrapped its JSON anyway. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.search(/[[{]/);
  return start >= 0 ? candidate.slice(start) : candidate;
}

// ---------------------------------------------------------------------------
// 1) Prompt → visualization plan
// ---------------------------------------------------------------------------

export interface VizPlan {
  kind: "find" | "aggregate";
  /** Primary collection the query runs against (set in whole-database mode). */
  collection?: string;
  filter?: string;
  sort?: string;
  projection?: string;
  limit?: number;
  stages?: { op: string; body: string }[];
  chart?: {
    type: "bar" | "line" | "pie" | "donut";
    labelField: string;
    valueField: string;
    title?: string;
  } | null;
  explanation: string;
  /** True when a conversation history was supplied but this prompt is a fresh, unrelated topic. */
  unrelatedToConversation?: boolean;
  /** True when the request tries to modify data — Studio is read-only, so it's refused. */
  writeIntent?: boolean;
}

/** Schema of every (sampled) collection in a database: name → field paths. */
export type DbSchema = Record<string, string[]>;

/** One prior turn, threaded back so follow-up prompts have context. */
export interface VizHistoryItem {
  prompt: string;
  query?: string;
}

export interface VizRequest {
  prompt: string;
  database: string;
  /** Single-collection mode: the target collection + its fields. */
  collection?: string;
  fields?: string[];
  /** Whole-database mode: the chosen collections' fields, for $lookup joins. */
  schema?: DbSchema;
  /** Whole-database mode: one real sample document per chosen collection. */
  samples?: Record<string, unknown>;
  history?: VizHistoryItem[];
}

/** mongosh aggregation stages that write data — never allowed from Studio. */
export const WRITE_STAGES = ["$out", "$merge"];

const VIZ_SYSTEM_SINGLE = `You translate natural-language questions into MongoDB queries for a data studio.
Respond with ONLY a JSON object, no prose, shaped as:
{
  "kind": "find" | "aggregate",
  "filter": "{ ... }",            // find only — MongoDB filter as a string
  "sort": "{ ... }",              // optional
  "projection": "{ ... }",        // optional
  "limit": 100,                   // optional, max 500
  "stages": [{ "op": "$match", "body": "{ ... }" }], // aggregate only, op = stage operator
  "chart": { "type": "bar"|"line"|"pie"|"donut", "labelField": "...", "valueField": "...", "title": "..." } | null,
  "explanation": "one short sentence describing what the query does",
  "unrelatedToConversation": false,
  "writeIntent": false
}
Rules:
- READ-ONLY: if the request asks to CHANGE data — insert, add, create, update, edit, set, replace, delete, remove, drop, rename, or anything mutating — do NOT produce a query. Set "writeIntent": true and leave the other query fields empty. (Reading, counting, filtering, and aggregating are always fine.)
- If a "Conversation so far" section is present and this new request is a fresh topic unrelated to it, set "unrelatedToConversation": true; otherwise false. Omit/false when there is no prior conversation.
- Prefer "aggregate" whenever grouping/counting/averaging is involved; project the label into "_id" or a named field and the numeric metric into another field, then set chart.labelField / chart.valueField to those exact output field names.
- Use a chart when the result is categorical/time-series numeric data; null when raw documents fit better.
- All filter/sort/projection/stage bodies are STRINGS containing valid MongoDB JSON (extended syntax like ObjectId(...) and ISODate(...) is allowed).
- Always include a $limit (or "limit") of at most 500.
- This is READ-ONLY. Never emit $out, $merge, or any stage that writes data.`;

const VIZ_SYSTEM_MULTI = `You translate natural-language questions into MongoDB aggregation queries that may span MULTIPLE collections in one database, for a data studio.
You are given the relevant collections, their sampled fields, AND a real sample document for each. STUDY the sample documents first to learn the actual field types and how collections reference each other before writing the pipeline. Decide which collection to run the pipeline on (the primary) and join others with $lookup.
Respond with ONLY a JSON object, no prose, shaped as:
{
  "kind": "aggregate",
  "collection": "primaryCollectionName",   // REQUIRED: the collection .aggregate() runs on
  "stages": [
    { "op": "$lookup", "body": "{ from: \\"otherColl\\", localField: \\"...\\", foreignField: \\"...\\", as: \\"...\\" }" },
    { "op": "$unwind", "body": "\\"$joinedField\\"" },
    { "op": "$group",  "body": "{ ... }" }
  ],
  "chart": { "type": "bar"|"line"|"pie"|"donut", "labelField": "...", "valueField": "...", "title": "..." } | null,
  "explanation": "one short sentence describing the query and which collections it joins",
  "unrelatedToConversation": false,
  "writeIntent": false
}
Rules:
- READ-ONLY: if the request asks to CHANGE data — insert, add, create, update, edit, set, replace, delete, remove, drop, rename, or anything mutating — do NOT produce a query. Set "writeIntent": true and leave the other query fields empty. (Reading, counting, filtering, and aggregating are always fine.)
- If a "Conversation so far" section is present and this new request is a fresh topic unrelated to it, set "unrelatedToConversation": true; otherwise false. Omit/false when there is no prior conversation.
- ALWAYS set "collection" to a real collection name from the provided schema.
- ENTITY MATCHING IS CRITICAL. When the question names an entity (users, customers, orders, products…), join/use the collection whose NAME matches that entity — consider singular/plural and obvious synonyms (user↔users, customer↔customers). NEVER substitute a different collection that merely has similar fields: e.g. if the user says "users", use the "users" collection, NOT "admins", even though both have name/email. Only fall back to another collection if no name match exists at all.
- Choosing the primary collection: it is usually the one storing the events/records being measured (orders, carts, transactions, sales). Join the named entity collection to it by matching a foreign key to its _id (e.g. carts.user → users._id), then group/sort/limit.
- Use $lookup for relationships; the "from" must be a real collection name. Use $unwind after $lookup when you need one row per match.
- JOINS CAN BE MULTI-HOP. Do not collapse a chain into a wrong direct join. If the primary has no field referencing the target entity, follow the chain: e.g. for "orders per city" where orders has a "community" field (not "city"), join orders.community → communities._id, then communities.city → cities._id. Add one $lookup (+ $unwind) per hop. Match the field NAME to the collection it references; never join a "community" field directly to "cities".
- Only reference fields that appear in the provided schema / sample documents for each collection. Pick join keys that the sample documents show actually reference the other collection's _id. A field named like an entity (user, userId, community) references the collection named after it (users, communities) — join its _id.
- Prefer grouping/counting/averaging with a chart when the question is analytical; project the label and numeric metric into named output fields and set chart.labelField / chart.valueField to those exact names.
- Stage bodies are STRINGS of valid MongoDB JSON (ObjectId(...), ISODate(...), unquoted keys allowed).
- ALWAYS end with a $limit stage of at most 500.
- This is READ-ONLY. Never emit $out, $merge, or any stage that writes data.`;

function schemaBlock(schema: DbSchema): string {
  return Object.entries(schema)
    .slice(0, 60)
    .map(([name, fields]) => `- ${name}: ${fields.slice(0, 50).join(", ") || "(fields not sampled)"}`)
    .join("\n");
}

const SELECT_SYSTEM = `You pick which MongoDB collections are needed to answer a question. You are given EVERY collection in ONE database with its sampled fields.
Respond with ONLY JSON: { "collections": ["primary", "join1", ...] }.
Rules:
- Return 1 to 6 collection names. Put the PRIMARY first — the collection that stores the records/events being measured (orders, carts, transactions, sales).
- ENTITY MATCHING: map nouns in the question to collections by NAME (singular/plural/synonyms): "users"→users, "customers"→customers, "products"→products. Prefer an exact/closest name match. NEVER pick a look-alike collection over a real name match — e.g. if the question says "users" and a "users" collection exists, pick "users", NOT "admins".
- TRACE REFERENCE CHAINS using the fields. A field named like an entity (user, community, product, customer_id) references the collection named after it. If the primary has no direct field for the asked dimension, follow the chain and INCLUDE every bridge collection: e.g. "orders per city" where orders has a "community" field (not "city") needs orders + communities + cities, because orders→communities and communities→cities.
- Only return names that appear in the provided list. No prose.`;

/** Phase 1 of whole-database mode: pick the relevant collections (with bridges). */
export async function selectCollections(args: {
  prompt: string;
  database: string;
  schema: DbSchema;
}): Promise<{ collections: string[]; usage: TokenUsage }> {
  const user = `Database: ${args.database}\nQuestion: ${args.prompt}\n\nCollections and their fields:\n${schemaBlock(
    args.schema
  )}`;
  const { text, usage } = await chat(SELECT_SYSTEM, user, true);
  const parsed = JSON.parse(extractJson(text)) as { collections?: unknown };
  const valid = new Set(Object.keys(args.schema));
  const picked = Array.isArray(parsed.collections)
    ? parsed.collections.filter((c): c is string => typeof c === "string" && valid.has(c))
    : [];
  return { collections: picked.slice(0, 6), usage };
}

function samplesBlock(samples?: Record<string, unknown>): string {
  if (!samples) return "";
  const blocks = Object.entries(samples)
    .map(([name, doc]) => `${name}:\n${JSON.stringify(doc).slice(0, 1200)}`)
    .join("\n\n");
  return blocks ? `\n\nSample document per collection (study these for types & references):\n${blocks}` : "";
}

function historyBlock(history?: VizHistoryItem[]): string {
  if (!history?.length) return "";
  const lines = history
    .slice(-6)
    .map((h) => `User: ${h.prompt}${h.query ? `\nQuery: ${h.query}` : ""}`)
    .join("\n");
  return `\n\nConversation so far (for follow-up context):\n${lines}`;
}

export async function generateVizPlan(
  req: VizRequest
): Promise<{ plan: VizPlan; usage: TokenUsage }> {
  const multi = Boolean(req.schema);
  const system = multi ? VIZ_SYSTEM_MULTI : VIZ_SYSTEM_SINGLE;
  const context = multi
    ? `Database: ${req.database}\nCollections and their fields:\n${schemaBlock(req.schema!)}${samplesBlock(
        req.samples
      )}`
    : `Database: ${req.database}\nCollection: ${req.collection}\nKnown fields (from sampling): ${
        (req.fields ?? []).slice(0, 80).join(", ") || "(unknown)"
      }`;
  const user = `${context}${historyBlock(req.history)}\n\nRequest: ${req.prompt}`;
  const { text, usage } = await chat(system, user, true);
  const plan = JSON.parse(extractJson(text)) as VizPlan;
  // Models sometimes emit non-string stage bodies (e.g. $limit: 500). The
  // backend expects every body as a string, so coerce them.
  if (plan.stages) {
    plan.stages = plan.stages.map((s) => ({
      op: String(s.op),
      body: typeof s.body === "string" ? s.body : JSON.stringify(s.body),
    }));
  }
  // Read-only: a write/delete request (flagged by the model, or a stray write
  // stage that slipped through) short-circuits — the caller shows a friendly
  // read-only message instead of running anything.
  const hasWriteStage = plan.stages?.some((s) =>
    WRITE_STAGES.some((w) => s.op.trim().toLowerCase() === w.toLowerCase())
  );
  if (plan.writeIntent || hasWriteStage) {
    return { plan: { ...plan, writeIntent: true }, usage };
  }
  if (plan.kind !== "find" && plan.kind !== "aggregate") {
    throw new Error("AI returned an invalid plan — try rephrasing the prompt");
  }
  if (multi && !plan.collection) {
    throw new Error("AI did not pick a collection to run on — try rephrasing the prompt");
  }
  return { plan, usage };
}

/** No-code helper: propose questions a user could ask about this scope. */
export async function suggestPrompts(args: {
  database: string;
  collection?: string;
  fields?: string[];
  schema?: DbSchema;
}): Promise<{ prompts: string[]; usage: TokenUsage }> {
  const multi = Boolean(args.schema);
  const system = multi
    ? `You suggest interesting analytics questions that span MULTIPLE related collections in a MongoDB database (joins, cross-collection rollups).
Respond with ONLY a JSON object: { "prompts": ["...", "...", "...", "..."] }.
Rules: exactly 4 short prompts (max 11 words each), natural-language, as a non-technical user would type. Favour questions that relate two collections (e.g. "orders per customer", "revenue by product category"). Base them strictly on the provided collections and fields.`
    : `You suggest interesting analytics questions for a MongoDB collection.
Respond with ONLY a JSON object: { "prompts": ["...", "...", "...", "..."] }.
Rules: exactly 4 short prompts (max 9 words each), phrased as natural-language requests a non-technical user would type. At least 2 should produce a chart (grouping, counting, averaging, or a time series). Base them strictly on the provided field names.`;
  const user = multi
    ? `Database: ${args.database}\nCollections and their fields:\n${schemaBlock(args.schema!)}`
    : `Database: ${args.database}\nCollection: ${args.collection}\nFields: ${
        (args.fields ?? []).slice(0, 80).join(", ") || "(unknown)"
      }`;
  const { text, usage } = await chat(system, user, true);
  const parsed = JSON.parse(extractJson(text)) as { prompts?: unknown };
  const prompts = Array.isArray(parsed.prompts)
    ? parsed.prompts.filter((p): p is string => typeof p === "string").slice(0, 4)
    : [];
  if (prompts.length === 0) throw new Error("No suggestions returned — try again");
  return { prompts, usage };
}

/** No-code helper: plain-language summary of a result set. */
export async function summarizeResults(
  prompt: string,
  docs: unknown[]
): Promise<{ summary: string; usage: TokenUsage }> {
  const system = `You summarize MongoDB query results for a non-technical reader.
Respond with 2-4 short plain-text sentences: the headline finding first, then notable patterns or outliers. No markdown, no code, no JSON.`;
  const sample = JSON.stringify(docs.slice(0, 40));
  const user = `Original question: ${prompt}\nResult sample (${docs.length} total, first 40 shown):\n${sample.slice(0, 12000)}`;
  const { text, usage } = await chat(system, user, false);
  return { summary: text.trim(), usage };
}

// ---------------------------------------------------------------------------
// 2) Query optimization / fixing
// ---------------------------------------------------------------------------

export interface OptimizeResult {
  query: string | null;
  notes: string;
  usage: TokenUsage;
}

const OPTIMIZE_SYSTEM = `You are a MongoDB query expert inside a database GUI.
The user gives you a mongosh-style statement (db.collection.find(...), .aggregate([...]), etc.), optionally with an error message and schema fields.
Respond with ONLY a JSON object:
{
  "query": "the improved/fixed single-line-or-multiline mongosh statement, or null if no change is needed",
  "notes": "concise markdown-free explanation: what changed and why, index suggestions, pitfalls. Use short lines / dashes."
}
Keep the statement runnable as a single mongosh statement. Never invent fields that aren't plausible from context.`;

export const QUICK_PROMPTS: { id: string; label: string; instruction: string }[] = [
  {
    id: "fix",
    label: "Fix errors",
    instruction: "Fix any syntax or semantic errors in this query so it runs correctly.",
  },
  {
    id: "optimize",
    label: "Optimize query",
    instruction:
      "Optimize this query for performance: reorder/restructure stages, reduce scanned data, and suggest indexes that would help.",
  },
  {
    id: "explain",
    label: "Explain query",
    instruction:
      "Explain step by step what this query does, in plain language. Return query as null.",
  },
  {
    id: "indexes",
    label: "Suggest indexes",
    instruction:
      "Suggest the ideal index(es) for this query with exact createIndex statements in the notes. Return query as null unless the query itself should change.",
  },
  {
    id: "secure",
    label: "Add safety limits",
    instruction:
      "Make this query safe to run on a large production collection: add limits/projections where missing.",
  },
];

// ---------------------------------------------------------------------------
// 3) Explain-plan interpretation
// ---------------------------------------------------------------------------

const EXPLAIN_SYSTEM = `You are a MongoDB performance expert reading an explain plan inside a database GUI.
Respond with plain text (no markdown, no JSON): 3-6 short lines.
Line 1: a one-sentence verdict — is this query healthy or not, and why.
Then: what the plan actually did (index vs scan, docs examined vs returned, sort behavior).
Then: the single most impactful fix, with an exact createIndex statement if an index would help.
Be concrete and terse; never invent fields that aren't in the plan.`;

/** Plain-language reading of an explain plan + the top recommended fix. */
export async function interpretExplain(args: {
  database: string;
  collection: string;
  summary: unknown;
  raw: unknown;
}): Promise<{ notes: string; usage: TokenUsage }> {
  const rawText = JSON.stringify(args.raw);
  const user = [
    `Namespace: ${args.database}.${args.collection}`,
    `Summary: ${JSON.stringify(args.summary)}`,
    `Raw plan (may be truncated):\n${rawText.slice(0, 14000)}`,
  ].join("\n");
  const { text, usage } = await chat(EXPLAIN_SYSTEM, user, false);
  return { notes: text.trim(), usage };
}

export async function optimizeQuery(args: {
  query: string;
  instruction: string;
  database: string;
  collection?: string;
  fields?: string[];
  error?: string | null;
}): Promise<OptimizeResult> {
  const user = [
    `Database: ${args.database}`,
    args.collection ? `Collection: ${args.collection}` : null,
    args.fields?.length ? `Known fields: ${args.fields.slice(0, 80).join(", ")}` : null,
    args.error ? `Last error: ${args.error}` : null,
    `Task: ${args.instruction}`,
    `Query:\n${args.query}`,
  ]
    .filter(Boolean)
    .join("\n");
  const { text, usage } = await chat(OPTIMIZE_SYSTEM, user, true);
  const parsed = JSON.parse(extractJson(text)) as { query?: string | null; notes?: string };
  return { query: parsed.query ?? null, notes: parsed.notes ?? "", usage };
}
