import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  ChevronDown,
  Copy,
  Download,
  KeyRound,
  Link2,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ConnectionForm, PROFILE_COLORS } from "@/components/connections/ConnectionForm";
import { PassphraseDialog } from "@/components/connections/PassphraseDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { api, errMsg, type ProfileSummary } from "@/lib/api";
import { exportConnections, pickConnectionImport, runConnectionImport } from "@/lib/files";
import { useConnections } from "@/stores/connections";
import { timeAgo } from "@/lib/bson";
import { cn } from "@/lib/utils";

interface ConnectionManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const IS_MAC = navigator.platform.toUpperCase().includes("MAC");

export function ConnectionManager({ open, onOpenChange }: ConnectionManagerProps) {
  const { profiles, security, connect, connectingId, remove, save, refresh, setSecretBackend } =
    useConnections();
  const [view, setView] = useState<"list" | "form">("list");
  const [editing, setEditing] = useState<ProfileSummary | null>(null);
  const [filter, setFilter] = useState("");
  const [deleting, setDeleting] = useState<ProfileSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportPassOpen, setExportPassOpen] = useState(false);
  const [importPath, setImportPath] = useState<string | null>(null); // encrypted import awaiting passphrase

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

  const copyUri = async (id: string, withPassword: boolean) => {
    try {
      const uri = await api.connectionUri(id, withPassword);
      await navigator.clipboard.writeText(uri);
      toast.success(
        withPassword
          ? "Connection string copied — includes the password"
          : "Connection string copied — without password"
      );
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const finishImport = async (path: string, passphrase?: string) => {
    setBusy(true);
    const outcome = await runConnectionImport(path, passphrase);
    setBusy(false);
    if (outcome) {
      await refresh();
      setImportPath(null);
    }
  };

  const handleImport = async () => {
    const picked = await pickConnectionImport();
    if (!picked) return;
    if (picked.preview.encrypted) setImportPath(picked.path); // ask for the passphrase
    else await finishImport(picked.path);
  };

  const handleExportFull = async (passphrase: string) => {
    setBusy(true);
    const ok = await exportConnections({ includeSecrets: true, passphrase });
    setBusy(false);
    if (ok) setExportPassOpen(false);
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
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex gap-2">
                {profiles.length > 4 && (
                  <Input
                    placeholder="Filter connections…"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="h-8"
                  />
                )}
                <div className="ml-auto flex shrink-0 gap-2">
                  <Button variant="outline" size="sm" onClick={() => void handleImport()}>
                    <Upload className="h-4 w-4" />
                    Import
                  </Button>
                  {profiles.length > 0 && (
                    // modal={false}: "with passwords…" opens a Dialog from a menu item —
                    // a modal menu would leave pointer-events stuck on <body>.
                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm">
                          <Download className="h-4 w-4" />
                          Export
                          <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-60">
                        <DropdownMenuItem
                          className="gap-2"
                          onSelect={() => void exportConnections({ includeSecrets: false })}
                        >
                          <Download className="h-3.5 w-3.5" />
                          <div className="min-w-0">
                            <div>Export without passwords</div>
                            <div className="text-[11px] text-muted-foreground">
                              Portable; re-enter passwords on import
                            </div>
                          </div>
                        </DropdownMenuItem>
                        <DropdownMenuItem className="gap-2" onSelect={() => setExportPassOpen(true)}>
                          <Lock className="h-3.5 w-3.5" />
                          <div className="min-w-0">
                            <div>Export with passwords…</div>
                            <div className="text-[11px] text-muted-foreground">
                              Encrypted with a passphrase you set
                            </div>
                          </div>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditing(null);
                      setView("form");
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    New connection
                  </Button>
                </div>
              </div>

              <ScrollArea className="min-w-0 max-h-[420px]">
                <div className="flex min-w-0 flex-col gap-2 pr-1">
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
                        "group flex min-w-0 cursor-pointer items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors",
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
                        <DropdownMenu modal={false}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7">
                                  <Link2 className="h-3.5 w-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                            </TooltipTrigger>
                            <TooltipContent>Copy connection string</TooltipContent>
                          </Tooltip>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => void copyUri(p.id, true)}>
                              <Copy className="h-3.5 w-3.5" />
                              Copy connection string
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void copyUri(p.id, false)}>
                              <Link2 className="h-3.5 w-3.5" />
                              Copy without password
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
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
        busy={busy}
        confirmPhrase={deleting?.name}
        onConfirm={async () => {
          if (!deleting) return;
          setBusy(true);
          try {
            await remove(deleting.id);
            toast.success(`Deleted "${deleting.name}"`);
            setDeleting(null);
          } catch (e) {
            toast.error(errMsg(e));
          } finally {
            setBusy(false);
          }
        }}
      />

      <PassphraseDialog
        open={exportPassOpen}
        onOpenChange={(o) => !o && setExportPassOpen(false)}
        title="Encrypt the export"
        description="Set a passphrase. You'll need it to import these connections on another machine."
        confirmLabel="Choose file & export"
        requireConfirm
        busy={busy}
        onSubmit={handleExportFull}
      />

      <PassphraseDialog
        open={importPath !== null}
        onOpenChange={(o) => !o && setImportPath(null)}
        title="Encrypted export"
        description="This file is passphrase-protected. Enter the passphrase it was exported with."
        confirmLabel="Import"
        busy={busy}
        onSubmit={(pass) => {
          if (importPath) void finishImport(importPath, pass);
        }}
      />
    </>
  );
}
