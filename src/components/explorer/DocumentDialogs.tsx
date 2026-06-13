import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/CodeEditor";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { api, errMsg, type Doc } from "@/lib/api";
import { docId, idLabel, toShellText } from "@/lib/bson";

export type DocDialogState =
  | { type: "closed" }
  | { type: "view"; doc: Doc }
  | { type: "edit"; doc: Doc }
  | { type: "insert"; template?: Doc }
  | { type: "delete"; doc: Doc };

interface DocumentDialogsProps {
  database: string;
  collection: string;
  state: DocDialogState;
  onClose: () => void;
  onMutated: () => void;
}

export function DocumentDialogs({
  database,
  collection,
  state,
  onClose,
  onMutated,
}: DocumentDialogsProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state.type === "edit" || state.type === "view") {
      setText(toShellText(state.doc));
    } else if (state.type === "insert") {
      if (state.template) {
        const { _id: _drop, ...rest } = state.template;
        setText(toShellText(rest));
      } else {
        setText("{\n  \n}");
      }
    }
  }, [state]);

  const editorOpen = state.type === "view" || state.type === "edit" || state.type === "insert";

  const handleSave = async () => {
    setBusy(true);
    try {
      if (state.type === "edit") {
        await api.replaceDocument(database, collection, docId(state.doc), text);
        toast.success("Document updated");
      } else if (state.type === "insert") {
        await api.insertDocument(database, collection, text);
        toast.success("Document inserted");
      }
      onMutated();
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={editorOpen} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>
              {state.type === "view" && "Document"}
              {state.type === "edit" && "Edit document"}
              {state.type === "insert" && "Insert document"}
            </DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {state.type === "view" || state.type === "edit"
                ? `${database}.${collection} · _id ${idLabel(state.doc)}`
                : `${database}.${collection}`}
            </DialogDescription>
          </DialogHeader>

          {editorOpen && (
            <CodeEditor
              value={text}
              onChange={setText}
              onRun={state.type !== "view" ? () => void handleSave() : undefined}
              readOnly={state.type === "view"}
              height="46vh"
              autoFocus={state.type !== "view"}
              path="dialog/document-editor"
            />
          )}

          {state.type === "edit" && (
            <p className="text-xs text-muted-foreground">
              Saving replaces the whole document. <code className="font-mono">_id</code> is
              immutable — keep it as is.
            </p>
          )}

          <DialogFooter className="gap-2">
            {state.type === "view" ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    await navigator.clipboard.writeText(text);
                    toast.success("Copied");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </Button>
                <Button size="sm" onClick={onClose}>
                  Close
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
                  Cancel
                </Button>
                <Button size="sm" onClick={() => void handleSave()} disabled={busy}>
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {state.type === "insert" ? "Insert" : "Save changes"}
                  <kbd className="ml-1 rounded border border-primary-foreground/30 px-1 font-mono text-[10px] opacity-70">
                    ⌘↵
                  </kbd>
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={state.type === "delete"}
        onOpenChange={(o) => !o && onClose()}
        title="Delete document?"
        description={
          state.type === "delete" ? (
            <span>
              <code className="font-mono text-xs">_id {idLabel(state.doc)}</code> will be removed
              from <code className="font-mono text-xs">{database}.{collection}</code>. This cannot
              be undone.
            </span>
          ) : undefined
        }
        confirmLabel="Delete"
        destructive
        requireAck
        busy={busy}
        onConfirm={async () => {
          if (state.type !== "delete") return;
          setBusy(true);
          try {
            await api.deleteDocument(database, collection, docId(state.doc));
            toast.success("Document deleted");
            onMutated();
            onClose();
          } catch (e) {
            toast.error(errMsg(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}
