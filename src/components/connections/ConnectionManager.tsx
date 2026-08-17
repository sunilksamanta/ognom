import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, ChevronDown, Copy, Download, KeyRound, Link2, Loader2, Lock, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ConnectionForm } from "@/components/connections/ConnectionForm";
import { PassphraseDialog } from "@/components/connections/PassphraseDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { initials } from "@/components/layout/Rail";
import { api, errMsg, type ProfileSummary } from "@/lib/api";
import { exportConnections, pickConnectionImport, runConnectionImport } from "@/lib/files";
import { useConnections } from "@/stores/connections";
import { useUi } from "@/stores/ui";
import { timeAgo } from "@/lib/bson";
import { cn } from "@/lib/utils";

const IS_MAC = navigator.platform.toUpperCase().includes("MAC");

/**
 * Connections modal: the list of saved profiles (connect, edit, duplicate,
 * copy URI, delete, import/export) or the new/edit form. State lives in the
 * UI store so the rail, palette and welcome pane can all open it.
 */
export function ConnectionManager() {
  const state = useUi((s) => s.connections);
  const openConnections = useUi((s) => s.openConnections);
  const closeConnections = useUi((s) => s.closeConnections);
  const { profiles, security, connect, connectingId, remove, save, refresh, setSecretBackend } = useConnections();
  const workspaces = useConnections((s) => s.workspaces);
  const [filter, setFilter] = useState("");
  const [deleting, setDeleting] = useState<ProfileSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportPassOpen, setExportPassOpen] = useState(false);
  const [importPath, setImportPath] = useState<string | null>(null);

  const open = state.open;
  const view = state.open ? state.view : "list";
  const editing = state.open ? state.editing : null;

  useEffect(() => {
    if (open) setFilter("");
  }, [open]);

  const filtered = profiles.filter(
    (p) =>
      !filter ||
      p.name.toLowerCase().includes(filter.toLowerCase()) ||
      p.hostSummary.toLowerCase().includes(filter.toLowerCase())
  );

  const handleConnect = async (p: ProfileSummary) => {
    if (await connect(p.id)) closeConnections();
  };

  const handleDuplicate = async (p: ProfileSummary) => {
    try {
      await save({
        id: null,
        name: `${p.name} copy`,
        color: p.color,
        access: p.access,
        kind: p.kind,
        fields: p.fields,
        uri: null,
        password: null,
      });
      toast.success(p.hasSecret ? "Duplicated - re-enter the password on the copy" : "Duplicated");
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const copyUri = async (id: string, withPassword: boolean) => {
    try {
      const uri = await api.connectionUri(id, withPassword);
      await navigator.clipboard.writeText(uri);
      toast.success(withPassword ? "Connection string copied - includes the password" : "Connection string copied - without password");
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
    if (picked.preview.encrypted) setImportPath(picked.path);
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
      <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && closeConnections()}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="ov mid" onClick={closeConnections}>
            <DialogPrimitive.Content
              className={cn("modal outline-none", view === "form" && "wide")}
              onClick={(e) => e.stopPropagation()}
              aria-describedby={undefined}
            >
              <div className="mhd">
                <div className="min-w-0">
                  <DialogPrimitive.Title asChild>
                    <h3 className="hstack">
                      {view === "form" && profiles.length > 0 && (
                        <button className="ico -ml-2" onClick={() => openConnections("list")} aria-label="Back">
                          <ArrowLeft />
                        </button>
                      )}
                      {view === "list" ? "Connections" : editing ? `Edit ${editing.name}` : "New connection"}
                    </h3>
                  </DialogPrimitive.Title>
                  <div className="sub">
                    {view === "list"
                      ? "credentials are AES-256 encrypted at rest, on this machine only"
                      : "paste a URI or fill the fields - Ognom parses either"}
                  </div>
                </div>
                <button className="ico" onClick={closeConnections} aria-label="Close">
                  <X />
                </button>
              </div>

              {view === "list" ? (
                <>
                  <div className="mbd">
                    <div className="hstack">
                      {profiles.length > 4 && (
                        <input className="in sans" placeholder="Filter connections" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 260 }} />
                      )}
                      <div className="ml-auto flex shrink-0 gap-2">
                        <button className="btn qt" onClick={() => void handleImport()}>
                          <Upload />
                          Import
                        </button>
                        {profiles.length > 0 && (
                          <DropdownMenu modal={false}>
                            <DropdownMenuTrigger asChild>
                              <button className="btn qt">
                                <Download />
                                Export
                                <ChevronDown style={{ width: 12, height: 12, opacity: 0.7 }} />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-64">
                              <DropdownMenuItem className="gap-2" onSelect={() => void exportConnections({ includeSecrets: false })}>
                                <Download className="h-3.5 w-3.5" />
                                <div className="min-w-0">
                                  <div>Export without passwords</div>
                                  <div className="text-[11px] text-text-3">Portable; re-enter passwords on import</div>
                                </div>
                              </DropdownMenuItem>
                              <DropdownMenuItem className="gap-2" onSelect={() => setExportPassOpen(true)}>
                                <Lock className="h-3.5 w-3.5" />
                                <div className="min-w-0">
                                  <div>Export with passwords</div>
                                  <div className="text-[11px] text-text-3">Encrypted with a passphrase you set</div>
                                </div>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                        <button className="btn pri" onClick={() => openConnections("form")}>
                          <Plus />
                          New connection
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-col gap-[7px]">
                      {filtered.length === 0 && (
                        <p className="py-8 text-center text-[12.5px] text-text-3">
                          {profiles.length === 0 ? "No saved connections yet." : "No matches."}
                        </p>
                      )}
                      {filtered.map((p) => {
                        const live = workspaces.some((w) => w.info.profileId === p.id);
                        return (
                          <div
                            key={p.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => void handleConnect(p)}
                            onKeyDown={(e) => e.key === "Enter" && void handleConnect(p)}
                            className={cn("idxrow group cursor-pointer hover:bg-hover", connectingId === p.id && "acc")}
                          >
                            <span
                              className={cn("cx", p.access === "production" && "prod", p.access === "readonly" && "ro", !live && "off")}
                              style={{ width: 32, height: 32, fontSize: 11 }}
                            >
                              {p.color && <span className="tag" style={{ background: p.color }} />}
                              {initials(p.name)}
                              <i />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="hstack">
                                <span className="truncate text-[13px] font-medium">{p.name}</span>
                                {p.access === "production" && <span className="pill dgr">production</span>}
                                {p.access === "readonly" && <span className="pill warn">read-only</span>}
                                {p.srv && <span className="pill">SRV</span>}
                                {p.tls && <Lock className="h-3 w-3 text-text-3" />}
                                {live && <span className="pill ok">live</span>}
                              </div>
                              <p className="truncate font-mono text-[11px] text-text-3">{p.hostSummary || "(connection string)"}</p>
                            </div>
                            <span className="shrink-0 font-mono text-[10.5px] text-text-3">{timeAgo(p.lastUsedAt)}</span>
                            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                              <DropdownMenu modal={false}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <DropdownMenuTrigger asChild>
                                      <button className="ico sm" aria-label="Copy connection string">
                                        <Link2 />
                                      </button>
                                    </DropdownMenuTrigger>
                                  </TooltipTrigger>
                                  <TooltipContent>Copy connection string</TooltipContent>
                                </Tooltip>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem className="gap-2" onSelect={() => void copyUri(p.id, true)}>
                                    <Copy className="h-3.5 w-3.5" /> Copy connection string
                                  </DropdownMenuItem>
                                  <DropdownMenuItem className="gap-2" onSelect={() => void copyUri(p.id, false)}>
                                    <Link2 className="h-3.5 w-3.5" /> Copy without password
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button className="ico sm" onClick={() => openConnections("form", p)} aria-label="Edit">
                                    <Pencil />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>Edit</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button className="ico sm" onClick={() => void handleDuplicate(p)} aria-label="Duplicate">
                                    <Copy />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>Duplicate</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button className="ico sm dgr" onClick={() => setDeleting(p)} aria-label="Delete">
                                    <Trash2 />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>Delete</TooltipContent>
                              </Tooltip>
                            </div>
                            {connectingId === p.id && <Loader2 className="spin h-4 w-4 shrink-0 text-primary" />}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mft">
                    <KeyRound className="h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1 text-[11.5px] leading-snug text-text-3">
                      <div className="hstack">
                        <span className="font-medium text-text">Guard the encryption key with the OS keychain</span>
                        <Switch className="ml-auto" checked={security?.secretBackend === "keychain"} onCheckedChange={(on) => void setSecretBackend(on ? "keychain" : "file")} />
                      </div>
                      <p className="mt-1">
                        Connections are AES-256 encrypted either way; this only changes where the key itself lives.
                        Off = a private key file, zero prompts.{IS_MAC && " On = macOS may ask for keychain access once after updates."}
                        {security?.degraded && <span className="text-warn"> Keychain unavailable right now - using the key file.</span>}
                      </p>
                    </div>
                  </div>
                </>
              ) : (
                <ConnectionForm
                  key={editing?.id ?? "new"}
                  editing={editing}
                  onDone={closeConnections}
                  onCancel={() => (profiles.length > 0 ? openConnections("list") : closeConnections())}
                />
              )}
            </DialogPrimitive.Content>
          </DialogPrimitive.Overlay>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete "${deleting?.name}"?`}
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
