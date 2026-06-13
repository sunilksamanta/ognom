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
import { useStudio, AI_MODE_META, DEFAULT_MODEL, type AiMode } from "@/stores/studio";
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

function ApiKeyField() {
  const { apiKey, setApiKey } = useStudio();
  const [draft, setDraft] = useState(apiKey);
  useEffect(() => setDraft(apiKey), [apiKey]);
  const dirty = draft.trim() !== apiKey;
  return (
    <div className="flex w-full items-center gap-2">
      <div className="relative flex-1">
        <KeyRound className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="sk-…"
          className="h-8 pl-8 font-mono text-xs"
          spellCheck={false}
        />
      </div>
      <Button
        size="sm"
        className="h-8"
        variant={dirty ? "default" : "outline"}
        disabled={!dirty}
        onClick={() => {
          setApiKey(draft);
          toast.success(draft.trim() ? "API key saved" : "API key cleared");
        }}
      >
        <Check className="h-3.5 w-3.5" />
        Save
      </Button>
    </div>
  );
}

function ModelField() {
  const { model, setModel } = useStudio();
  // Local draft so typing doesn't hit the persisted store on every keystroke
  // (laggy) and an empty field doesn't instantly snap back to the default.
  const [draft, setDraft] = useState(model);
  useEffect(() => setDraft(model), [model]);

  const commit = () => {
    const next = draft.trim() || DEFAULT_MODEL;
    setDraft(next);
    if (next !== model) setModel(next);
  };

  return (
    <div className="flex items-center gap-2">
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        placeholder={DEFAULT_MODEL}
        className="h-8 w-56 font-mono text-xs"
        spellCheck={false}
      />
      {draft.trim() !== DEFAULT_MODEL && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          title={`Reset to ${DEFAULT_MODEL}`}
          onClick={() => {
            setDraft(DEFAULT_MODEL);
            setModel(DEFAULT_MODEL);
          }}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// dialog
// ---------------------------------------------------------------------------

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { pageSize, setPageSize, advancedMode, setAdvancedMode, clearShellHistory, setSidebarWidth } =
    useSettings();
  const { apiKey } = useStudio();

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
              <div className="py-2.5">
                <p className="mb-1.5 text-sm font-medium leading-tight">
                  OpenAI API key
                  {!apiKey && (
                    <span className="ml-2 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                      required for Studio
                    </span>
                  )}
                </p>
                <ApiKeyField />
              </div>
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
            <SectionTitle>Provider — OpenAI</SectionTitle>
            <div className="divide-y rounded-lg border bg-card px-4">
              <div className="py-2.5">
                <p className="mb-1.5 text-sm font-medium leading-tight">API key</p>
                <ApiKeyField />
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  Stored locally on this machine and sent only to api.openai.com from the Ognom
                  backend — never through the webview.
                </p>
              </div>
              <Row label="Model" hint={`OpenAI model for Studio · default ${DEFAULT_MODEL}`}>
                <ModelField />
              </Row>
              <Row
                label="Reasoning"
                hint="Deep Think reasons harder on the same model; Normal stays fast"
              >
                <AiModeSwitch />
              </Row>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              More providers (Anthropic, local models, …) will appear here as separate sections.
            </p>

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
