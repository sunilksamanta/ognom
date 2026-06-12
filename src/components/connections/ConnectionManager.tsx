import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Copy,
  KeyRound,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ConnectionForm, PROFILE_COLORS } from "@/components/connections/ConnectionForm";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { errMsg, type ProfileSummary } from "@/lib/api";
import { useConnections } from "@/stores/connections";
import { timeAgo } from "@/lib/bson";
import { cn } from "@/lib/utils";

interface ConnectionManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const IS_MAC = navigator.platform.toUpperCase().includes("MAC");

export function ConnectionManager({ open, onOpenChange }: ConnectionManagerProps) {
  const { profiles, security, connect, connectingId, remove, save, setSecretBackend } =
    useConnections();
  const [view, setView] = useState<"list" | "form">("list");
  const [editing, setEditing] = useState<ProfileSummary | null>(null);
  const [filter, setFilter] = useState("");
  const [deleting, setDeleting] = useState<ProfileSummary | null>(null);

  useEffect(() => {
    if (open) {
      setView(profiles.length === 0 ? "form" : "list");
      setEditing(null);
      setFilter("");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = profiles.filter(
    (p) =>
      !filter ||
      p.name.toLowerCase().includes(filter.toLowerCase()) ||
      p.hostSummary.toLowerCase().includes(filter.toLowerCase())
  );

  const handleConnect = async (p: ProfileSummary) => {
    if (await connect(p.id)) onOpenChange(false);
  };

  const handleDuplicate = async (p: ProfileSummary) => {
    try {
      await save({
        id: null,
        name: `${p.name} copy`,
        color: p.color,
        kind: p.kind,
        fields: p.fields,
        // secrets can't be copied across profiles — user re-enters them
        uri: null,
        password: null,
      });
      toast.success(p.hasSecret ? "Duplicated — re-enter the password on the copy" : "Duplicated");
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {view === "form" && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="-ml-2 h-7 w-7"
                  onClick={() => setView("list")}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              )}
              {view === "list" ? "Connections" : editing ? `Edit “${editing.name}”` : "New connection"}
            </DialogTitle>
            <DialogDescription>
              {view === "list"
                ? "Credentials are AES-256 encrypted at rest, on your machine only."
                : "Only the basics are required. Everything else lives under Advanced."}
            </DialogDescription>
          </DialogHeader>

          {view === "list" ? (
            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                {profiles.length > 4 && (
                  <Input
                    placeholder="Filter connections…"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="h-8"
                  />
                )}
                <Button
                  size="sm"
                  className="ml-auto shrink-0"
                  onClick={() => {
                    setEditing(null);
                    setView("form");
                  }}
                >
                  <Plus className="h-4 w-4" />
                  New connection
                </Button>
              </div>

              <ScrollArea className="max-h-[420px]">
                <div className="flex flex-col gap-2 pr-1">
                  {filtered.length === 0 && (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      {profiles.length === 0 ? "No saved connections yet." : "No matches."}
                    </p>
                  )}
                  {filtered.map((p) => (
                    <div
                      key={p.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => void handleConnect(p)}
                      onKeyDown={(e) => e.key === "Enter" && void handleConnect(p)}
                      className={cn(
                        "group flex cursor-pointer items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors",
                        "hover:border-primary/40 hover:bg-accent/50",
                        connectingId === p.id && "border-primary/50"
                      )}
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: p.color ?? PROFILE_COLORS[0] }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{p.name}</span>
                          {p.srv && (
                            <Badge variant="outline" className="h-4 px-1 text-[10px]">
                              SRV
                            </Badge>
                          )}
                          {p.tls && <Lock className="h-3 w-3 text-muted-foreground" />}
                        </div>
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {p.hostSummary || "(connection string)"}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {timeAgo(p.lastUsedAt)}
                      </span>
                      <div
                        className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => {
                                setEditing(p);
                                setView("form");
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Edit</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => void handleDuplicate(p)}
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Duplicate</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => setDeleting(p)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Delete</TooltipContent>
                        </Tooltip>
                      </div>
                      {connectingId === p.id && (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>

              <div className="flex items-start gap-3 rounded-md border bg-muted/40 px-3 py-2.5">
                <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="flex-1 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-foreground">
                      Guard the encryption key with the OS keychain
                    </span>
                    <Switch
                      checked={security?.secretBackend === "keychain"}
                      onCheckedChange={(on) => void setSecretBackend(on ? "keychain" : "file")}
                    />
                  </div>
                  <p className="mt-1">
                    Connections are AES-256 encrypted either way; this only changes where the key
                    itself lives. Off = a private key file, zero prompts.
                    {IS_MAC && " On = macOS may ask for keychain access once after app updates."}
                  </p>
                  {security?.degraded && (
                    <p className="mt-1 text-warning">
                      Keychain unavailable right now — using the local key file instead.
                    </p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <ConnectionForm
              editing={editing}
              onDone={() => {
                setView("list");
                onOpenChange(false);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete “${deleting?.name}”?`}
        description="The saved connection and its encrypted credentials will be removed. This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await remove(deleting.id);
            toast.success(`Deleted "${deleting.name}"`);
          } catch (e) {
            toast.error(errMsg(e));
          } finally {
            setDeleting(null);
          }
        }}
      />
    </>
  );
}
