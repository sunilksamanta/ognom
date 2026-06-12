import { api } from "@/lib/api";
import { activeAiConfig, useStudio } from "@/stores/studio";

async function chat(system: string, user: string, jsonMode: boolean): Promise<string> {
  const state = useStudio.getState();
  const cfg = activeAiConfig(state);
  return api.aiChat({
    apiKey: state.apiKey,
    model: cfg.model,
    system,
    user,
    jsonMode,
    reasoning: cfg.reasoning,
  });
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
}

const VIZ_SYSTEM = `You translate natural-language questions into MongoDB queries for a data studio.
Respond with ONLY a JSON object, no prose, shaped as:
{
  "kind": "find" | "aggregate",
  "filter": "{ ... }",            // find only — MongoDB filter as a string
  "sort": "{ ... }",              // optional
  "projection": "{ ... }",        // optional
  "limit": 100,                   // optional, max 500
  "stages": [{ "op": "$match", "body": "{ ... }" }], // aggregate only, op = stage operator
  "chart": { "type": "bar"|"line"|"pie"|"donut", "labelField": "...", "valueField": "...", "title": "..." } | null,
  "explanation": "one short sentence describing what the query does"
}
Rules:
- Prefer "aggregate" whenever grouping/counting/averaging is involved; project the label into "_id" or a named field and the numeric metric into another field, then set chart.labelField / chart.valueField to those exact output field names.
- Use a chart when the result is categorical/time-series numeric data; null when raw documents fit better.
- All filter/sort/projection/stage bodies are STRINGS containing valid MongoDB JSON (extended syntax like ObjectId(...) and ISODate(...) is allowed).
- Always include a $limit (or "limit") of at most 500.`;

export async function generateVizPlan(
  prompt: string,
  database: string,
  collection: string,
  fields: string[]
): Promise<VizPlan> {
  const user = `Database: ${database}\nCollection: ${collection}\nKnown fields (from sampling): ${fields.slice(0, 80).join(", ") || "(unknown)"}\n\nRequest: ${prompt}`;
  const text = await chat(VIZ_SYSTEM, user, true);
  const plan = JSON.parse(extractJson(text)) as VizPlan;
  if (plan.kind !== "find" && plan.kind !== "aggregate") {
    throw new Error("AI returned an invalid plan — try rephrasing the prompt");
  }
  return plan;
}

/** No-code helper: propose questions a user could ask about this collection. */
export async function suggestPrompts(
  database: string,
  collection: string,
  fields: string[]
): Promise<string[]> {
  const system = `You suggest interesting analytics questions for a MongoDB collection.
Respond with ONLY a JSON object: { "prompts": ["...", "...", "...", "..."] }.
Rules: exactly 4 short prompts (max 9 words each), phrased as natural-language requests a non-technical user would type. At least 2 should produce a chart (grouping, counting, averaging, or a time series). Base them strictly on the provided field names.`;
  const user = `Database: ${database}\nCollection: ${collection}\nFields: ${fields.slice(0, 80).join(", ") || "(unknown)"}`;
  const text = await chat(system, user, true);
  const parsed = JSON.parse(extractJson(text)) as { prompts?: unknown };
  const prompts = Array.isArray(parsed.prompts)
    ? parsed.prompts.filter((p): p is string => typeof p === "string").slice(0, 4)
    : [];
  if (prompts.length === 0) throw new Error("No suggestions returned — try again");
  return prompts;
}

/** No-code helper: plain-language summary of a result set. */
export async function summarizeResults(prompt: string, docs: unknown[]): Promise<string> {
  const system = `You summarize MongoDB query results for a non-technical reader.
Respond with 2-4 short plain-text sentences: the headline finding first, then notable patterns or outliers. No markdown, no code, no JSON.`;
  const sample = JSON.stringify(docs.slice(0, 40));
  const user = `Original question: ${prompt}\nResult sample (${docs.length} total, first 40 shown):\n${sample.slice(0, 12000)}`;
  return (await chat(system, user, false)).trim();
}

// ---------------------------------------------------------------------------
// 2) Query optimization / fixing
// ---------------------------------------------------------------------------

export interface OptimizeResult {
  query: string | null;
  notes: string;
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
  const text = await chat(OPTIMIZE_SYSTEM, user, true);
  const parsed = JSON.parse(extractJson(text)) as OptimizeResult;
  return { query: parsed.query ?? null, notes: parsed.notes ?? "" };
}
