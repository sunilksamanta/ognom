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
