/**
 * Bundled Monaco setup: no CDN, works offline, ships with a real `mongodb`
 * language (context-aware db/collection/method tokens) and Ognom themes.
 */
import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    return label === "json" ? new jsonWorker() : new editorWorker();
  },
};

let done = false;

// ---------------------------------------------------------------------------
// Shell completions - IntelliShell-style. The ShellPane keeps this registry
// fresh with the active database's collection names and the current
// collection's sampled field paths; the provider below reads it live.
// ---------------------------------------------------------------------------

let completionCtx: { collections: string[]; fields: string[] } = {
  collections: [],
  fields: [],
};

/** Feed the shell completion provider with live schema context. */
export function setShellCompletions(ctx: { collections?: string[]; fields?: string[] }): void {
  completionCtx = {
    collections: ctx.collections ?? completionCtx.collections,
    fields: ctx.fields ?? completionCtx.fields,
  };
}

const DB_METHODS = [
  "getCollection", "runCommand", "adminCommand", "createCollection",
  "dropDatabase", "stats", "version",
];

const COLLECTION_METHODS = [
  "find", "findOne", "aggregate", "countDocuments", "count",
  "estimatedDocumentCount", "distinct", "insertOne", "insertMany",
  "updateOne", "updateMany", "replaceOne", "deleteOne", "deleteMany",
  "drop", "getIndexes", "createIndex", "dropIndex", "stats",
];

const CURSOR_METHODS = [
  "sort", "limit", "skip", "project", "projection", "hint",
  "count", "size", "allowDiskUse", "toArray", "pretty",
];

const BSON_HELPERS = [
  "ObjectId", "ISODate", "Date", "UUID", "NumberLong", "NumberInt",
  "NumberDecimal", "Timestamp", "BinData",
];

const LITERALS = ["true", "false", "null"];

const MONGO_OPERATORS = [
  // query
  "$eq", "$ne", "$gt", "$gte", "$lt", "$lte", "$in", "$nin", "$exists",
  "$type", "$regex", "$options", "$and", "$or", "$not", "$nor", "$expr",
  "$elemMatch", "$size", "$all", "$mod", "$text", "$where",
  // update
  "$set", "$unset", "$inc", "$mul", "$rename", "$push", "$pull",
  "$addToSet", "$pop", "$currentDate", "$min", "$max",
  // aggregation stages & accumulators
  "$match", "$group", "$sort", "$project", "$limit", "$skip", "$lookup",
  "$unwind", "$addFields", "$count", "$facet", "$bucket", "$sample",
  "$replaceRoot", "$sortByCount", "$unionWith", "$sum", "$avg", "$first",
  "$last", "$cond", "$ifNull", "$concat", "$toLower", "$toUpper",
  "$dateToString", "$year", "$month", "$dayOfMonth",
];

export function ensureMonaco(): void {
  if (done) return;
  done = true;

  loader.config({ monaco });

  monaco.languages.register({ id: "mongodb" });

  // HMR in dev re-runs this module: drop the previous provider so items are
  // never listed twice.
  const g = globalThis as { __ognomCompletion?: { dispose(): void } };
  g.__ognomCompletion?.dispose();
  g.__ognomCompletion = monaco.languages.registerCompletionItemProvider("mongodb", {
    // Only characters that are part of what is being typed - never a brace or
    // comma, so the list appears while typing (or on Ctrl+Space), not on "{".
    triggerCharacters: [".", "$"],
    provideCompletionItems(model, position) {
      // Context comes from everything before the cursor (bounded), not just
      // the current line - filter bodies span lines, and a key typed on line 2
      // of `{\n  na` must still see the `{`.
      const tail = model
        .getValueInRange(new monaco.Range(1, 1, position.lineNumber, position.column))
        .slice(-800);
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn
      );
      const kind = monaco.languages.CompletionItemKind;
      const items: monaco.languages.CompletionItem[] = [];
      // Fields sort before operators before helpers: `sortText` orders the
      // list, and `group` keeps insertion order stable inside a group.
      let group = 0;
      const push = (
        labels: string[],
        itemKind: monaco.languages.CompletionItemKind,
        opts?: { method?: boolean; detail?: string }
      ) => {
        group += 1;
        const seen = new Set<string>();
        labels.forEach((label, i) => {
          if (seen.has(label)) return;
          seen.add(label);
          items.push({
            label,
            kind: itemKind,
            detail: opts?.detail,
            sortText: `${group}-${String(i).padStart(4, "0")}`,
            insertText: opts?.method ? `${label}($0)` : label,
            insertTextRules: opts?.method
              ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
              : undefined,
            range,
          });
        });
      };

      // db.<collection | dbMethod>
      if (/\bdb\.\s*[\w$]*$/.test(tail)) {
        push(completionCtx.collections, kind.Struct, { detail: "collection" });
        push(DB_METHODS, kind.Method, { method: true, detail: "db method" });
        return { suggestions: items };
      }
      // db.collection.<method> (also db.getCollection("x").<method>)
      if (/\bdb\.(?:[\w$]+|getCollection\((?:"[^"]*"|'[^']*')\))\.\s*[\w$]*$/.test(tail)) {
        push(COLLECTION_METHODS, kind.Method, { method: true, detail: "collection method" });
        return { suggestions: items };
      }
      // ).<cursorMethod>
      if (/\)\s*\.\s*[\w$]*$/.test(tail)) {
        push(CURSOR_METHODS, kind.Method, { method: true, detail: "cursor method" });
        return { suggestions: items };
      }
      // $operator anywhere inside a document body
      if (/[$][\w]*$/.test(tail)) {
        push(MONGO_OPERATORS, kind.Operator, { detail: "operator" });
        return { suggestions: items };
      }
      // key position - after { , or [ (whitespace/newlines and an optional
      // opening quote in between) → sampled field paths + operators
      if (/[{,[]\s*["']?[\w.]*$/.test(tail)) {
        push(completionCtx.fields, kind.Field, { detail: "field" });
        push(MONGO_OPERATORS, kind.Operator, { detail: "operator" });
        return { suggestions: items };
      }
      // Value position / anywhere else: BSON helpers and literals, so the
      // widget always has something sensible instead of "No suggestions".
      push(BSON_HELPERS, kind.Constructor, { method: true, detail: "helper" });
      push(LITERALS, kind.Keyword, { detail: "literal" });
      push(completionCtx.fields, kind.Field, { detail: "field" });
      return { suggestions: items };
    },
  });

  monaco.languages.setMonarchTokensProvider("mongodb", {
    defaultToken: "",
    tokenizer: {
      root: [
        [/\/\/.*$/, "comment"],
        [/\/\*/, "comment", "@comment"],
        // `db` only acts as the shell handle when followed by a dot.
        [/\bdb\b(?=\s*\.)/, { token: "keyword.db", next: "@afterDb" }],
        // chained cursor methods: .sort( .limit( ...
        [/\.\s*[A-Za-z_$][\w$]*(?=\s*\()/, "function"],
        [
          /\b(?:ObjectId|ISODate|NumberLong|NumberInt|NumberDecimal|Double|BinData|UUID|Timestamp|DBRef|MinKey|MaxKey|Date)\b(?=\s*\()/,
          "constant.helper",
        ],
        [/\b(?:true|false|null|undefined)\b/, "keyword.literal"],
        [/\b(?:show|use)\b/, "keyword"],
        [/\$[A-Za-z_]\w*/, "operator.mongo"],
        [/[A-Za-z_$][\w$]*(?=\s*:)/, "key"],
        [/"(?:[^"\\]|\\.)*"(?=\s*:)/, "key"],
        [/'(?:[^'\\]|\\.)*'(?=\s*:)/, "key"],
        [/"(?:[^"\\]|\\.)*"/, "string"],
        [/'(?:[^'\\]|\\.)*'/, "string"],
        [/-?\d+\.\d+(?:[eE][-+]?\d+)?/, "number.float"],
        [/-?\d+/, "number"],
        [/[{}()[\]]/, "@brackets"],
        [/[,:;]/, "delimiter"],
      ],
      afterDb: [
        [/\s+/, "white"],
        // first call segment ends the namespace chain: db.users.find(
        [/\.\s*[A-Za-z_$][\w$]*(?=\s*\()/, { token: "function", next: "@pop" }],
        [/\.\s*[A-Za-z_$][\w$]*/, "namespace"],
        [/./, { token: "@rematch", next: "@pop" }],
      ],
      comment: [
        [/[^*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/./, "comment"],
      ],
    },
  });

  monaco.languages.setLanguageConfiguration("mongodb", {
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    surroundingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    comments: { lineComment: "//", blockComment: ["/*", "*/"] },
  });

  applyMonacoTheme();
}

/** Read a theme-kit token from the document root (hex or rgb). */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Any CSS colour to #rrggbb[aa] (Monaco wants hex). */
function toHex(css: string, fallback: string): string {
  if (!css) return fallback;
  if (/^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(css)) return css;
  if (/^#[0-9a-f]{3}$/i.test(css)) return "#" + [...css.slice(1)].map((c) => c + c).join("");
  const m = css.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    const [r, g, b] = parts;
    const a = parts.length > 3 ? parts[3] : 1;
    const h = (n: number) => Math.round(n).toString(16).padStart(2, "0");
    return `#${h(r)}${h(g)}${h(b)}${a < 1 ? h(a * 255) : ""}`;
  }
  return fallback;
}

/**
 * (Re)build the single Ognom Monaco theme from the live theme-kit tokens and
 * activate it. Called on every theme change so editors re-tint with the app.
 */
export function applyMonacoTheme(): void {
  const dark = document.documentElement.classList.contains("dark");
  const c = {
    key: toHex(token("--s-key"), "CBD8D2"),
    str: toHex(token("--s-str"), "7FD8A0"),
    num: toHex(token("--s-num"), "C3A7F1"),
    bool: toHex(token("--s-bool"), "E9B44C"),
    date: toHex(token("--s-date"), "6BC5E8"),
    oid: toHex(token("--s-oid"), "00ED64"),
    punc: toHex(token("--s-punc"), "5A6B64"),
    accent: toHex(token("--accent"), "00ED64"),
    accent2: toHex(token("--accent-2"), "7FE1FF"),
    text: toHex(token("--text"), "EDF2EF"),
    text2: toHex(token("--text-2"), "A2AEA8"),
    text3: toHex(token("--text-3"), "6C7A74"),
    bg: toHex(token("--bg"), "111413"),
    panel2: toHex(token("--panel-2"), "1B201E"),
    raised: toHex(token("--raised"), "20261F"),
    hover: toHex(token("--hover"), "242A27"),
    soft: toHex(token("--accent-soft"), "00ED6420"),
    line: toHex(token("--accent-line"), "00ED6450"),
  };
  const strip = (h: string) => h.replace("#", "").slice(0, 6);
  monaco.editor.defineTheme("ognom", {
    base: dark ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      { token: "keyword.db", foreground: strip(c.accent), fontStyle: "bold" },
      { token: "namespace", foreground: strip(c.text2) },
      { token: "function", foreground: strip(c.date) },
      { token: "constant.helper", foreground: strip(c.oid) },
      { token: "key", foreground: strip(c.key) },
      { token: "string", foreground: strip(c.str) },
      { token: "number", foreground: strip(c.num) },
      { token: "number.float", foreground: strip(c.num) },
      { token: "keyword.literal", foreground: strip(c.bool) },
      { token: "keyword", foreground: strip(c.bool) },
      { token: "operator.mongo", foreground: strip(c.accent2) },
      { token: "comment", foreground: strip(c.text3), fontStyle: "italic" },
      { token: "delimiter", foreground: strip(c.punc) },
      { token: "", foreground: strip(c.text) },
    ],
    colors: {
      "editor.background": "#00000000",
      "editor.foreground": c.text,
      "editor.lineHighlightBackground": "#00000000",
      "editorLineNumber.foreground": c.text3,
      "editorLineNumber.activeForeground": c.text2,
      "editor.selectionBackground": c.soft.length === 9 ? c.soft : c.soft + "33",
      "editor.inactiveSelectionBackground": c.soft.length === 9 ? c.soft : c.soft + "22",
      "editorCursor.foreground": c.accent,
      "editorBracketMatch.border": "#00000000",
      "editorBracketMatch.background": c.soft.length === 9 ? c.soft : c.soft + "33",
      "editorWidget.background": c.raised,
      "editorWidget.border": c.hover,
      "editorSuggestWidget.background": c.raised,
      "editorSuggestWidget.border": c.hover,
      "editorSuggestWidget.selectedBackground": c.hover,
      "editorSuggestWidget.foreground": c.text,
      "editorHoverWidget.background": c.raised,
      "editorHoverWidget.border": c.hover,
      "input.background": c.panel2,
      "input.foreground": c.text,
      "scrollbarSlider.background": c.hover + "aa",
      "scrollbarSlider.hoverBackground": c.hover,
      "scrollbarSlider.activeBackground": c.hover,
      "editorIndentGuide.background1": c.panel2,
      "editorIndentGuide.activeBackground1": c.hover,
      "editorGutter.background": "#00000000",
      "editor.placeholder.foreground": c.text3,
    },
  });
  monaco.editor.setTheme("ognom");
}

export const MONO_FONT =
  '"Geist Mono", ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace';
