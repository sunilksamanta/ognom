import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, KeyRound, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettings } from "@/stores/settings";
import {
  useStudio,
  aiReady,
  AI_MODE_META,
  AI_PROVIDERS,
  PROVIDER_META,
  type AiMode,
  type AiProvider,
} from "@/stores/studio";
import { api } from "@/lib/api";
import { checkForUpdates } from "@/lib/updater";
import { cn } from "@/lib/utils";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// shared bits
// ---------------------------------------------------------------------------

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium leading-tight">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground first:mt-0">
      {children}
    </p>
  );
}

function AiModeSwitch({ compact = false }: { compact?: boolean }) {
  const { aiMode, setAiMode } = useStudio();
  return (
    <div className="flex items-center rounded-md border bg-muted/60 p-0.5">
      {(Object.keys(AI_MODE_META) as AiMode[]).map((m) => (
        <button
          key={m}
          onClick={() => setAiMode(m)}
          className={cn(
            "rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors",
            aiMode === m
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {compact ? AI_MODE_META[m].label.replace(" mode", "") : AI_MODE_META[m].label}
        </button>
      ))}
    </div>
  );
}

function ProviderSelect() {
  const { provider, setProvider } = useStudio();
  return (
    <Select value={provider} onValueChange={(v) => setProvider(v as AiProvider)}>
      <SelectTrigger className="h-8 w-56 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {AI_PROVIDERS.map((p) => (
          <SelectItem key={p} value={p} className="text-xs">
            {PROVIDER_META[p].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Write-only key field: the key goes straight into the backend's encrypted
 *  vault and is never read back into the webview. */
function ApiKeyField() {
  const provider = useStudio((s) => s.provider);
  const keysConfigured = useStudio((s) => s.keysConfigured);
  const setKeysConfigured = useStudio((s) => s.setKeysConfigured);
  const meta = PROVIDER_META[provider];
  const saved = keysConfigured.includes(provider);
  const [draft, setDraft] = useState("");
  useEffect(() => setDraft(""), [provider]);

  const commit = async (key: string) => {
    try {
      setKeysConfigured(await api.setAiKey(provider, key));
      toast.success(key.trim() ? `${meta.label} key saved` : `${meta.label} key cleared`);
      setDraft("");
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <div className="flex w-full items-center gap-2">
      <div className="relative flex-1">
        <KeyRound className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={saved ? "saved ✓ — enter a new key to replace" : meta.keyPlaceholder}
          className="h-8 pl-8 font-mono text-xs"
          spellCheck={false}
          disabled={!meta.needsKey && provider !== "custom"}
        />
      </div>
      <Button
        size="sm"
        className="h-8"
        variant={draft.trim() ? "default" : "outline"}
        disabled={!draft.trim()}
        onClick={() => void commit(draft)}
      >
        <Check className="h-3.5 w-3.5" />
        Save
      </Button>
      {saved && (
        <Button
          size="sm"
          variant="ghost"
          className="h-8 text-muted-foreground hover:text-destructive"
          title="Remove the stored key"
          onClick={() => void commit("")}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

function ModelField() {
  const provider = useStudio((s) => s.provider);
  const model = useStudio((s) => s.models[s.provider] ?? "");
  const setModel = useStudio((s) => s.setModel);
  const fallback = PROVIDER_META[provider].defaultModel;
  // Local draft so typing doesn't hit the persisted store on every keystroke
  // (laggy) and an empty field doesn't instantly snap back to the default.
  const [draft, setDraft] = useState(model);
  useEffect(() => setDraft(model), [model, provider]);

  const commit = () => {
    const next = draft.trim() || fallback;
    setDraft(next);
    if (next !== model) setModel(provider, next);
  };

  return (
    <div className="flex items-center gap-2">
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        placeholder={fallback || "model id"}
        className="h-8 w-56 font-mono text-xs"
        spellCheck={false}
      />
      {fallback && draft.trim() !== fallback && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          title={`Reset to ${fallback}`}
          onClick={() => {
            setDraft(fallback);
            setModel(provider, fallback);
          }}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

/** Endpoint URL for local / custom OpenAI-compatible providers. */
function BaseUrlField() {
  const provider = useStudio((s) => s.provider);
  const baseUrl = useStudio((s) => s.baseUrls[s.provider] ?? "");
  const setBaseUrl = useStudio((s) => s.setBaseUrl);
  const fallback = PROVIDER_META[provider].defaultBaseUrl ?? "";
  const [draft, setDraft] = useState(baseUrl);
  useEffect(() => setDraft(baseUrl), [baseUrl, provider]);

  const commit = () => {
    const next = draft.trim() || fallback;
    setDraft(next);
    if (next !== baseUrl) setBaseUrl(provider, next);
  };

  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      placeholder={fallback || "https://…/v1"}
      className="h-8 w-64 font-mono text-xs"
      spellCheck={false}
    />
  );
}

// ---------------------------------------------------------------------------
// dialog
// ---------------------------------------------------------------------------

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { pageSize, setPageSize, advancedMode, setAdvancedMode, clearShellHistory, setSidebarWidth } =
    useSettings();
  const provider = useStudio((s) => s.provider);
  const ready = useStudio((s) => aiReady(s));
  const refreshKeys = useStudio((s) => s.refreshKeys);
  const meta = PROVIDER_META[provider];

  // Key presence lives in the backend vault — refresh whenever settings open.
  useEffect(() => {
    if (open) void refreshKeys();
  }, [open, refreshKeys]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[640px]">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Preferences for Ognom and the Studio AI.</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="quick" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="mx-5 mt-3 h-8 w-fit justify-start">
            <TabsTrigger value="quick" className="h-7 px-3 text-xs">
              Quick Settings
            </TabsTrigger>
            <TabsTrigger value="ai" className="h-7 px-3 text-xs">
              Prompts &amp; AI
            </TabsTrigger>
            <TabsTrigger value="workspace" className="h-7 px-3 text-xs">
              Workspace
            </TabsTrigger>
          </TabsList>

          {/* ── Quick Settings ─────────────────────────────────────────── */}
          <TabsContent value="quick" className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-2">
            <SectionTitle>Essentials</SectionTitle>
            <div className="divide-y rounded-lg border bg-card px-4">
              <Row label="AI provider" hint="Powers Studio and shell AI assist">
                <ProviderSelect />
              </Row>
              {meta.needsKey && (
                <div className="py-2.5">
                  <p className="mb-1.5 text-sm font-medium leading-tight">
                    {meta.label} API key
                    {!ready && (
                      <span className="ml-2 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                        required for Studio
                      </span>
                    )}
                  </p>
                  <ApiKeyField />
                </div>
              )}
              <Row label="AI mode" hint="Normal is fast · Deep Think reasons harder">
                <AiModeSwitch compact />
              </Row>
              <Row label="Documents per page" hint="Default page size for new tabs">
                <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                  <SelectTrigger className="h-8 w-24 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 25, 50, 100].map((n) => (
                      <SelectItem key={n} value={String(n)} className="text-xs">
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
              <Row label="Advanced mode" hint="Unlocks the raw shell tab">
                <Switch checked={advancedMode} onCheckedChange={setAdvancedMode} />
              </Row>
            </div>

            <SectionTitle>Application</SectionTitle>
            <div className="rounded-lg border bg-card px-4">
              <Row label="Updates" hint="Ognom updates itself from GitHub releases">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => void checkForUpdates(true)}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Check for updates
                </Button>
              </Row>
            </div>
          </TabsContent>

          {/* ── Prompts & AI ───────────────────────────────────────────── */}
          <TabsContent value="ai" className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-2">
            <SectionTitle>Provider</SectionTitle>
            <div className="divide-y rounded-lg border bg-card px-4">
              <Row label="Provider" hint="OpenAI, Anthropic, local (Ollama / LM Studio), or any OpenAI-compatible endpoint">
                <ProviderSelect />
              </Row>
              {(meta.needsKey || provider === "custom") && (
                <div className="py-2.5">
                  <p className="mb-1.5 text-sm font-medium leading-tight">
                    API key{provider === "custom" && " (optional)"}
                  </p>
                  <ApiKeyField />
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    Stored in Ognom&apos;s encrypted vault — the same AES-256-GCM protection as
                    your database passwords. {meta.hint}
                  </p>
                </div>
              )}
              {PROVIDER_META[provider].defaultBaseUrl !== undefined && (
                <Row label="Endpoint" hint="OpenAI-compatible /v1 base URL">
                  <BaseUrlField />
                </Row>
              )}
              <Row
                label="Model"
                hint={
                  PROVIDER_META[provider].defaultModel
                    ? `${meta.label} model for Studio · default ${PROVIDER_META[provider].defaultModel}`
                    : `${meta.label} model id`
                }
              >
                <ModelField />
              </Row>
              <Row
                label="Reasoning"
                hint="Deep Think reasons harder on the same model; Normal stays fast"
              >
                <AiModeSwitch />
              </Row>
            </div>
            {(provider === "ollama" || provider === "lmstudio") && (
              <p className="mt-3 text-xs text-muted-foreground">
                Local provider — prompts, schema samples, and results never leave this machine.
              </p>
            )}

            <SectionTitle>Query safety</SectionTitle>
            <div className="rounded-lg border bg-card px-4 py-2.5 text-xs leading-relaxed text-muted-foreground">
              AI-generated queries always run through Ognom&apos;s safe query layer: results are
              capped at 500 documents, aggregations get an automatic <code className="font-mono">$limit</code>,
              and Studio never executes write operations from prompts.
            </div>
          </TabsContent>

          {/* ── Workspace ──────────────────────────────────────────────── */}
          <TabsContent value="workspace" className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-2">
            <SectionTitle>Explorer</SectionTitle>
            <div className="divide-y rounded-lg border bg-card px-4">
              <Row label="Documents per page" hint="Default page size for new collection tabs">
                <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                  <SelectTrigger className="h-8 w-24 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 25, 50, 100].map((n) => (
                      <SelectItem key={n} value={String(n)} className="text-xs">
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
              <Row label="Advanced mode" hint="Raw shell tab and power-user options">
                <Switch checked={advancedMode} onCheckedChange={setAdvancedMode} />
              </Row>
              <Row label="Sidebar width" hint="Restore the default 256px width">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => {
                    setSidebarWidth(256);
                    toast.success("Sidebar width reset");
                  }}
                >
                  Reset
                </Button>
              </Row>
            </div>

            <SectionTitle>Data</SectionTitle>
            <div className="rounded-lg border bg-card px-4">
              <Row label="Shell history" hint="Recent statements stored on this machine">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    clearShellHistory();
                    toast.success("Shell history cleared");
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear
                </Button>
              </Row>
            </div>
          </TabsContent>
        </Tabs>

        <Separator />
        <div className="flex justify-end px-5 py-3">
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
