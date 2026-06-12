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

export function ensureMonaco(): void {
  if (done) return;
  done = true;

  loader.config({ monaco });

  monaco.languages.register({ id: "mongodb" });

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
      db: "4FCB8D",
      namespace: "7FD4EA",
      func: "E0C285",
      key: "8FBCEA",
      string: "D9A862",
      number: "BFA0EE",
      literal: "E783AD",
      operator: "C39AF0",
      comment: "5F6875",
      delimiter: "8B93A1",
    }),
    colors: {
      "editor.background": "#12151B",
      "editor.lineHighlightBackground": "#1A1E27",
      "editorLineNumber.foreground": "#3D4452",
      "editorLineNumber.activeForeground": "#8B93A1",
      "editor.selectionBackground": "#1F4536",
      "editorCursor.foreground": "#4FCB8D",
      "editorBracketMatch.border": "#4FCB8D55",
      "editorWidget.background": "#161A22",
      "editorSuggestWidget.background": "#161A22",
      "scrollbarSlider.background": "#2A303C66",
      "scrollbarSlider.hoverBackground": "#2A303C99",
    },
  });

  monaco.editor.defineTheme("ognom-light", {
    base: "vs",
    inherit: true,
    rules: sharedRules({
      db: "1F7A4D",
      namespace: "0E7490",
      func: "9A6700",
      key: "2563AE",
      string: "AE6A18",
      number: "7843D6",
      literal: "C2326B",
      operator: "8A3FC9",
      comment: "8A919C",
      delimiter: "6B7280",
    }),
    colors: {
      "editor.background": "#FFFFFF",
      "editor.lineHighlightBackground": "#F4F6F9",
      "editorLineNumber.foreground": "#C3C9D2",
      "editorLineNumber.activeForeground": "#6B7280",
      "editor.selectionBackground": "#C9EDDC",
      "editorCursor.foreground": "#1F7A4D",
    },
  });
}

export const MONO_FONT =
  'ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace';
