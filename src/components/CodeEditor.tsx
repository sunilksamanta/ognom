import Editor, { OnMount } from "@monaco-editor/react";
import { KeyCode, KeyMod } from "monaco-editor";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { ensureMonaco, MONO_FONT } from "@/lib/monaco";
import { useTheme } from "@/components/theme-provider";

ensureMonaco();

interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  /** ⌘/Ctrl+Enter */
  onRun?: () => void;
  height?: string | number;
  className?: string;
  readOnly?: boolean;
  lineNumbers?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
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
}: CodeEditorProps) {
  const { resolved } = useTheme();
  const runRef = useRef(onRun);
  runRef.current = onRun;

  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  useEffect(() => () => editorRef.current?.dispose(), []);

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
    <div className={cn("overflow-hidden rounded-md border bg-card", className)}>
      <Editor
        height={height}
        language="mongodb"
        theme={resolved === "dark" ? "ognom-dark" : "ognom-light"}
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
