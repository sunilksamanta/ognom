import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Cpu, Database, History, KeyRound, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StudioChat, RecentChats } from "@/components/studio/StudioChat";
import { useExplorer } from "@/stores/explorer";
import { useSettings } from "@/stores/settings";
import { useStudio, DEFAULT_MODEL } from "@/stores/studio";
import { useChat, WHOLE_DB, type ChatSession } from "@/stores/chat";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export function StudioPane() {
  const { databases, collections, loadDatabases, loadCollections, openShellWithQuery } =
    useExplorer();
  const { apiKey, setApiKey, setTerminator } = useStudio();
  const setAdvancedMode = useSettings((s) => s.setAdvancedMode);
  const sessions = useChat((s) => s.sessions);
  const setActiveChat = useChat((s) => s.setActive);

  const [database, setDatabase] = useState("");
  const [scope, setScope] = useState(""); // collection name, or WHOLE_DB
  const [fields, setFields] = useState<string[]>([]);

  // Hand a generated query over to the developer Shell (normal mode) to
  // optimize it there. Studio (Terminator) stays purely no-code/visualize.
  const optimizeInShell = (query: string, collection: string) => {
    setAdvancedMode(true);
    openShellWithQuery(database, collection, query);
    setTerminator(false);
  };

  // Reopen a past chat from anywhere — restore its database + scope, then
  // activate it so its transcript shows.
  const openSession = (s: ChatSession) => {
    setDatabase(s.database);
    setScope(s.scope);
    setActiveChat(s.id);
  };

  useEffect(() => {
    if (databases.length === 0) void loadDatabases();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (database && !collections[database]) void loadCollections(database);
  }, [database]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sampled fields for single-collection scope (whole-db samples lazily in chat).
  useEffect(() => {
    setFields([]);
    if (database && scope && scope !== WHOLE_DB) {
      api
        .collectionFields(database, scope, 1000)
        .then(setFields)
        .catch(() => {});
    }
  }, [database, scope]);

  const colls = collections[database] ?? [];
  const ready = Boolean(database && scope);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-gradient-to-b from-primary/[0.04] to-transparent">
      {/* studio header */}
      <div className="no-select flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <span className="flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
          <Cpu className="h-3.5 w-3.5" />
          Ognom Studio
        </span>

        <div className="mx-1 h-5 w-px bg-border" />

        <Database className="h-3.5 w-3.5 text-muted-foreground" />
        <Select value={database} onValueChange={(v) => { setDatabase(v); setScope(WHOLE_DB); }}>
          <SelectTrigger className="h-7 w-[160px] text-xs">
            <SelectValue placeholder="Database" />
          </SelectTrigger>
          <SelectContent>
            {databases.map((db) => (
              <SelectItem key={db.name} value={db.name} className="text-xs">
                {db.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={scope} onValueChange={setScope} disabled={!database}>
          <SelectTrigger className="h-7 w-[200px] text-xs">
            <SelectValue placeholder="Collection" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={WHOLE_DB} className="text-xs">
              <span className="flex items-center gap-1.5 font-medium text-primary">
                <Layers className="h-3.5 w-3.5" />
                Whole database (joins)
              </span>
            </SelectItem>
            <SelectSeparator />
            {colls.map((c) => (
              <SelectItem key={c.name} value={c.name} className="text-xs">
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex-1" />

        <ApiKeyPopover apiKey={apiKey} setApiKey={setApiKey} />
      </div>

      {!ready ? (
        <div className="flex flex-1 flex-col items-center overflow-y-auto px-4 py-10">
          <div className="no-select flex flex-col items-center gap-3 text-center">
            <Cpu className="h-10 w-10 text-primary/40" />
            <p className="text-sm font-medium">Welcome to Ognom Studio</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Pick a database and a collection — or{" "}
              <span className="font-medium text-primary">Whole database</span> to join across
              collections — then chat to explore. Studio writes the query, runs it, and visualizes
              the result.
            </p>
          </div>

          {sessions.length > 0 && (
            <div className="mt-8 w-full max-w-md">
              <p className="mb-2 flex items-center gap-1.5 px-1 text-xs font-semibold text-muted-foreground">
                <History className="h-3.5 w-3.5" />
                Recent chats
              </p>
              <RecentChats sessions={sessions} onPick={openSession} />
              <p className="mt-2 px-1 text-[11px] text-muted-foreground">
                Reopening a chat restores its database &amp; collection.
              </p>
            </div>
          )}
        </div>
      ) : (
        <StudioChat
          key={`${database}:${scope}`}
          database={database}
          scope={scope}
          fields={fields}
          onOptimize={optimizeInShell}
          onOpenSession={openSession}
        />
      )}
    </div>
  );
}

function ApiKeyPopover({
  apiKey,
  setApiKey,
}: {
  apiKey: string;
  setApiKey: (k: string) => void;
}) {
  const [draft, setDraft] = useState(apiKey);
  return (
    <Popover onOpenChange={(o) => o && setDraft(apiKey)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant={apiKey ? "ghost" : "outline"}
              size="sm"
              className={cn("h-7 gap-1.5 text-xs", !apiKey && "border-warning/60 text-warning")}
            >
              <KeyRound className="h-3.5 w-3.5" />
              {apiKey ? "API key" : "Set API key"}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>OpenAI API key — required for Studio AI</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-96 space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs">OpenAI API key</Label>
          <Input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="sk-…"
            className="h-8 font-mono text-xs"
            spellCheck={false}
          />
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Stored locally on this machine and sent only to api.openai.com from the Ognom backend.
            Defaults to {DEFAULT_MODEL}; Deep Think turns on reasoning for the same model — change
            the model in Settings → Prompts &amp; AI.
          </p>
        </div>
        <Button
          size="sm"
          className="w-full"
          onClick={() => {
            setApiKey(draft);
            toast.success(draft.trim() ? "API key saved" : "API key cleared");
          }}
        >
          <Check className="h-3.5 w-3.5" />
          Save key
        </Button>
      </PopoverContent>
    </Popover>
  );
}
