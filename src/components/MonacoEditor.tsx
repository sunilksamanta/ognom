import Editor from "@monaco-editor/react";
import { cn } from "@/lib/utils";

interface MonacoEditorProps {
  value: string;
  onChange: (value: string | undefined) => void;
  className?: string;
  height?: string;
}

export function MonacoEditor({ value, onChange, className, height = "200px" }: MonacoEditorProps) {
  return (
    <div className={cn("border rounded-md overflow-hidden", className)}>
      <Editor
        height={height}
        defaultLanguage="json"
        value={value}
        onChange={onChange}
        theme="vs-dark"
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
