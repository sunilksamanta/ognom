import Editor, { OnMount } from "@monaco-editor/react";
import { KeyCode, KeyMod } from "monaco-editor";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { applyMonacoTheme, ensureMonaco, MONO_FONT } from "@/lib/monaco";
import { useTheme } from "@/components/theme-provider";

ensureMonaco();

interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  /** Cmd/Ctrl+Enter */
  onRun?: () => void;
  height?: string | number;
  className?: string;
  readOnly?: boolean;
  lineNumbers?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  /** Borderless: the parent paints the surface (drawer JSON view, dock). */
  bare?: boolean;
  /**
   * Stable, unique model identity. With many editors mounted at once (aggregate
   * stages, plus every open tab), giving each its own path keeps Monaco's
   * per-model view state (scroll/cursor) from sharing one anonymous slot.
   */
  path?: string;
}

export function CodeEditor({
  value,
  onChange,
  onRun,
  height = 160,
  className,
  readOnly = false,
  lineNumbers = true,
  placeholder,
  autoFocus = false,
  bare = false,
  path,
}: CodeEditorProps) {
  const { theme, resolved } = useTheme();
  const runRef = useRef(onRun);
  runRef.current = onRun;

  // Re-derive the Monaco theme from the live tokens whenever the app theme
  // flips. Tokens are applied to <html> synchronously by the provider, so by
  // the time this effect runs getComputedStyle sees the new palette.
  useEffect(() => {
    applyMonacoTheme();
  }, [theme, resolved]);

  // NOTE: don't dispose the editor here - @monaco-editor/react owns the editor
  // (and model) lifecycle and disposes them on unmount. Disposing it ourselves
  // double-disposes and blanks the app.
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;
    editor.addCommand(KeyMod.CtrlCmd | KeyCode.Enter, () => runRef.current?.());
    if (autoFocus) {
      editor.focus();
      const model = editor.getModel();
      if (model) {
        const lastLine = model.getLineCount();
        editor.setPosition({ lineNumber: lastLine, column: model.getLineMaxColumn(lastLine) });
      }
    }
  };

  return (
    <div
      className={cn(
        "overflow-hidden",
        !bare && "rounded-[var(--r-sm)] border border-line bg-panel-2 focus-within:border-accent-line",
        className
      )}
    >
      <Editor
        height={height}
        path={path}
        language="mongodb"
        theme="ognom"
        value={value}
        onChange={(v) => onChange?.(v ?? "")}
        onMount={handleMount}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 12.5,
          fontFamily: MONO_FONT,
          lineNumbers: lineNumbers ? "on" : "off",
          lineNumbersMinChars: 3,
          folding: lineNumbers,
          glyphMargin: false,
          renderLineHighlight: "none",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          wordWrap: "on",
          contextmenu: false,
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
          padding: { top: 8, bottom: 8 },
          placeholder,
          fixedOverflowWidgets: true,
        }}
      />
    </div>
  );
}
