import Editor, { type OnMount } from "@monaco-editor/react";
import { KeyCode, KeyMod } from "monaco-editor";
import { useEffect, useRef } from "react";
import { applyMonacoTheme, ensureMonaco, MONO_FONT, setShellCompletions } from "@/lib/monaco";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

ensureMonaco();

interface QueryInputProps {
  value: string;
  onChange: (v: string) => void;
  /** Enter (when no suggestion is selected) and Cmd/Ctrl+Enter. */
  onRun?: () => void;
  placeholder?: string;
  /** Sampled field paths of the collection - fed to the completion provider
   *  whenever this input has focus. */
  fields?: string[];
  className?: string;
  ariaLabel?: string;
  height?: number;
}

/**
 * Single-line Monaco input for the dock: auto-closing braces and quotes,
 * $operator / field / helper completions, run on Enter. Newlines are
 * flattened so it always stays one line.
 */
export function QueryInput({
  value,
  onChange,
  onRun,
  placeholder,
  fields,
  className,
  ariaLabel,
  height = 36,
}: QueryInputProps) {
  const { theme, resolved } = useTheme();
  const runRef = useRef(onRun);
  runRef.current = onRun;
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

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
    editor.addCommand(KeyCode.Enter, () => runRef.current?.(), "!suggestWidgetVisible");
    editor.addCommand(KeyMod.CtrlCmd | KeyCode.Enter, () => runRef.current?.());
    editor.addCommand(KeyCode.Escape, () => {
      (document.activeElement as HTMLElement | null)?.blur();
    }, "!suggestWidgetVisible");
    editor.onDidFocusEditorText(() => {
      if (fieldsRef.current) setShellCompletions({ fields: fieldsRef.current });
    });
    // Stay single-line: paste or a stray newline collapses to spaces.
    editor.onDidChangeModelContent(() => {
      const model = editor.getModel();
      if (!model) return;
      const text = model.getValue();
      if (text.includes("\n")) {
        const flat = text.replace(/\s*\n\s*/g, " ");
        const pos = editor.getPosition();
        model.setValue(flat);
        if (pos) editor.setPosition({ lineNumber: 1, column: Math.min(pos.column, flat.length + 1) });
      }
    });
  };

  return (
    <div
      className={cn("qin", className)}
      style={{ height: height + 4, padding: "0 6px 0 12px" }}
      aria-label={ariaLabel}
      onClick={() => editorRef.current?.focus()}
    >
      <div className="min-w-0 flex-1" style={{ height }}>
        <Editor
          height={height}
          language="mongodb"
          theme="ognom"
          value={value}
          onChange={(v) => onChange((v ?? "").replace(/\n/g, " "))}
          onMount={handleMount}
          options={{
            fontSize: 13,
            fontFamily: MONO_FONT,
            lineHeight: height,
            lineNumbers: "off",
            glyphMargin: false,
            folding: false,
            lineDecorationsWidth: 0,
            lineNumbersMinChars: 0,
            wordWrap: "off",
            minimap: { enabled: false },
            scrollbar: { vertical: "hidden", horizontal: "hidden", alwaysConsumeMouseWheel: false, handleMouseWheel: false },
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            overviewRulerBorder: false,
            renderLineHighlight: "none",
            scrollBeyondLastLine: false,
            scrollBeyondLastColumn: 3,
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
            matchBrackets: "always",
            renderWhitespace: "none",
            padding: { top: 0, bottom: 0 },
            placeholder,
            find: { addExtraSpaceOnTop: false, autoFindInSelection: "never", seedSearchStringFromSelection: "never" },
            cursorStyle: "line",
            cursorWidth: 1.5,
          }}
        />
      </div>
    </div>
  );
}
