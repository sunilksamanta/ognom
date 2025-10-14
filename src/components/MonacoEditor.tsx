import Editor, { OnMount } from "@monaco-editor/react";
import { cn } from "@/lib/utils";
import { useRef } from "react";

interface MonacoEditorProps {
  value: string;
  onChange: (value: string | undefined) => void;
  className?: string;
  height?: string;
}

export function MonacoEditor({ value, onChange, className, height = "200px" }: MonacoEditorProps) {
  const monacoRef = useRef<any>(null);

  const handleEditorDidMount: OnMount = (_editor, monaco) => {
    monacoRef.current = monaco;

    // Register MongoDB shell language
    monaco.languages.register({ id: 'mongodb' });

    // Define MongoDB shell syntax highlighting
    monaco.languages.setMonarchTokensProvider('mongodb', {
      tokenizer: {
        root: [
          // MongoDB functions
          [/\b(ObjectId|ISODate|NumberLong|NumberInt|NumberDecimal|BinData|UUID|Timestamp|DBRef|MinKey|MaxKey)\b/, 'keyword'],
          // Strings
          [/"([^"\\]|\\.)*$/, 'string.invalid'],
          [/'([^'\\]|\\.)*$/, 'string.invalid'],
          [/"/, 'string', '@string_double'],
          [/'/, 'string', '@string_single'],
          // Numbers
          [/\d+\.\d+([eE][\-+]?\d+)?/, 'number.float'],
          [/0[xX][0-9a-fA-F]+/, 'number.hex'],
          [/\d+/, 'number'],
          // MongoDB operators
          [/\$[a-zA-Z_]\w*/, 'operator'],
          // Delimiters and operators
          [/[{}()\[\]]/, '@brackets'],
          [/[,:;]/, 'delimiter'],
        ],
        string_double: [
          [/[^\\"]+/, 'string'],
          [/\\./, 'string.escape'],
          [/"/, 'string', '@pop']
        ],
        string_single: [
          [/[^\\']+/, 'string'],
          [/\\./, 'string.escape'],
          [/'/, 'string', '@pop']
        ],
      }
    });

    // Configure language features
    monaco.languages.setLanguageConfiguration('mongodb', {
      brackets: [
        ['{', '}'],
        ['[', ']'],
        ['(', ')']
      ],
      autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
      surroundingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
    });

    // Disable JSON validation errors
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: false,
    });
  };

  return (
    <div className={cn("border rounded-md overflow-hidden", className)}>
      <Editor
        height={height}
        defaultLanguage="mongodb"
        value={value}
        onChange={onChange}
        theme="vs-dark"
        onMount={handleEditorDidMount}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          lineNumbers: "on",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          formatOnPaste: true,
          formatOnType: true,
        }}
      />
    </div>
  );
}
