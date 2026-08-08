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
// Shell completions — IntelliShell-style. The ShellPane keeps this registry
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

  monaco.languages.registerCompletionItemProvider("mongodb", {
    triggerCharacters: [".", "$", '"', "'", "{", ","],
    provideCompletionItems(model, position) {
      // Context comes from everything before the cursor (bounded), not just
      // the current line — filter bodies span lines, and a key typed on line 2
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
      const push = (
        labels: string[],
        itemKind: monaco.languages.CompletionItemKind,
        opts?: { method?: boolean; detail?: string }
      ) => {
        for (const label of labels) {
          items.push({
            label,
            kind: itemKind,
            detail: opts?.detail,
            insertText: opts?.method ? `${label}($0)` : label,
            insertTextRules: opts?.method
              ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
              : undefined,
            range,
          });
        }
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
      // key position — after { , or [ (whitespace/newlines and an optional
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
        // chained cursor methods: .sort( .limit( …
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

  const sharedRules = (c: Record<string, string>): monaco.editor.ITokenThemeRule[] => [
    { token: "keyword.db", foreground: c.db, fontStyle: "bold" },
    { token: "namespace", foreground: c.namespace },
    { token: "function", foreground: c.func },
    { token: "constant.helper", foreground: c.db },
    { token: "key", foreground: c.key },
    { token: "string", foreground: c.string },
    { token: "number", foreground: c.number },
    { token: "number.float", foreground: c.number },
    { token: "keyword.literal", foreground: c.literal },
    { token: "keyword", foreground: c.literal },
    { token: "operator.mongo", foreground: c.operator },
    { token: "comment", foreground: c.comment, fontStyle: "italic" },
    { token: "delimiter", foreground: c.delimiter },
  ];

  monaco.editor.defineTheme("ognom-dark", {
    base: "vs-dark",
    inherit: true,
    rules: sharedRules({
      db: "00ED64",
      namespace: "9DB2AE",
      func: "5FB0EE",
      key: "C3D2CE",
      string: "7FD8A0",
      number: "C2A6F0",
      literal: "E8B153",
      operator: "5FB0EE",
      comment: "4E635F",
      delimiter: "4E635F",
    }),
    colors: {
      "editor.background": "#00121A",
      "editor.lineHighlightBackground": "#042430",
      "editorLineNumber.foreground": "#33474C",
      "editorLineNumber.activeForeground": "#9DB2AE",
      "editor.selectionBackground": "#15422F",
      "editorCursor.foreground": "#00ED64",
      "editorBracketMatch.border": "#00ED6455",
      "editorWidget.background": "#08303D",
      "editorSuggestWidget.background": "#08303D",
      "scrollbarSlider.background": "#13445333",
      "scrollbarSlider.hoverBackground": "#13445366",
    },
  });

  monaco.editor.defineTheme("ognom-light", {
    base: "vs",
    inherit: true,
    rules: sharedRules({
      db: "00875A",
      namespace: "5A6B68",
      func: "2E84C8",
      key: "2E403D",
      string: "1F8A4C",
      number: "6D3FC0",
      literal: "996A12",
      operator: "2E84C8",
      comment: "7C8B88",
      delimiter: "7C8B88",
    }),
    colors: {
      "editor.background": "#FFFFFF",
      "editor.lineHighlightBackground": "#F1F6F5",
      "editorLineNumber.foreground": "#BBC9C6",
      "editorLineNumber.activeForeground": "#5A6B68",
      "editor.selectionBackground": "#CFF3E0",
      "editorCursor.foreground": "#00875A",
    },
  });
}

export const MONO_FONT =
  '"Geist Mono", ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace';
