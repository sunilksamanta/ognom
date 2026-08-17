import Editor, { type OnMount } from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import { applyMonacoTheme, ensureMonaco, MONO_FONT, setShellCompletions } from "@/lib/monaco";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

ensureMonaco();

const LINE = 22;
const PAD = 8;

interface QueryInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Sampled field paths of the collection - fed to the completion provider
   *  whenever this input has focus. */
  fields?: string[];
  className?: string;
  ariaLabel?: string;
  /** The editor grows with its content up to this many lines, then scrolls. */
  maxLines?: number;
  autoFocus?: boolean;
}

/**
 * Query editor for the dock: a Monaco editor that starts as one line and grows
 * with the query (Enter inserts a newline - running is a button, never a key).
 * Auto-closing braces and quotes, $operator / field / helper completions.
 */
export function QueryInput({
  value,
  onChange,
  placeholder,
  fields,
  className,
  ariaLabel,
  maxLines = 10,
  autoFocus,
}: QueryInputProps) {
  const { theme, resolved } = useTheme();
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const [height, setHeight] = useState(LINE);

  useEffect(() => {
    applyMonacoTheme();
  }, [theme, resolved]);

  // Keep the shared completion registry pointed at this collection while the
  // input is focused (several tabs share one provider).
  useEffect(() => {
    if (fields && editorRef.current?.hasTextFocus()) setShellCompletions({ fields });
  }, [fields]);

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;
    editor.onDidFocusEditorText(() => {
      if (fieldsRef.current) setShellCompletions({ fields: fieldsRef.current });
    });
    // Grow with the content (wrapped lines included), cap at maxLines.
    const fit = () => {
      const h = Math.min(editor.getContentHeight(), LINE * maxLines);
      setHeight(Math.max(LINE, h));
    };
    editor.onDidContentSizeChange(fit);
    fit();
    if (autoFocus) editor.focus();
  };

  return (
    <div
      className={cn("qin", className)}
      style={{ height: "auto", minHeight: LINE + PAD * 2, padding: `${PAD}px 8px ${PAD}px 12px`, alignItems: "flex-start" }}
      aria-label={ariaLabel}
      onClick={() => editorRef.current?.focus()}
    >
      <div className="min-w-0 flex-1" style={{ height }}>
        <Editor
          height={height}
          language="mongodb"
          theme="ognom"
          value={value}
          onChange={(v) => onChange(v ?? "")}
          onMount={handleMount}
          options={{
            fontSize: 13,
            fontFamily: MONO_FONT,
            lineHeight: LINE,
            lineNumbers: "off",
            glyphMargin: false,
            folding: false,
            lineDecorationsWidth: 0,
            lineNumbersMinChars: 0,
            wordWrap: "on",
            wrappingIndent: "indent",
            minimap: { enabled: false },
            scrollbar: {
              vertical: "auto",
              horizontal: "hidden",
              verticalScrollbarSize: 6,
              alwaysConsumeMouseWheel: false,
            },
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            overviewRulerBorder: false,
            renderLineHighlight: "none",
            scrollBeyondLastLine: false,
            scrollBeyondLastColumn: 2,
            fixedOverflowWidgets: true,
            contextmenu: false,
            automaticLayout: true,
            quickSuggestions: { other: true, comments: false, strings: true },
            suggestOnTriggerCharacters: true,
            acceptSuggestionOnEnter: "on",
            tabCompletion: "on",
            wordBasedSuggestions: "off",
            autoClosingBrackets: "always",
            autoClosingQuotes: "always",
            autoSurround: "languageDefined",
            autoIndent: "full",
            formatOnPaste: false,
            // No boxes around brackets or occurrences - a plain input feel.
            matchBrackets: "never",
            bracketPairColorization: { enabled: false },
            guides: { bracketPairs: false, indentation: false, highlightActiveIndentation: false },
            occurrencesHighlight: "off",
            selectionHighlight: false,
            renderWhitespace: "none",
            padding: { top: 0, bottom: 0 },
            placeholder,
            find: { addExtraSpaceOnTop: false, autoFindInSelection: "never", seedSearchStringFromSelection: "never" },
            cursorStyle: "line",
            cursorWidth: 1.5,
            tabSize: 2,
          }}
        />
      </div>
    </div>
  );
}
