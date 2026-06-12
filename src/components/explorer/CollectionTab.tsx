import { useState } from "react";
import { FileJson2, ListTree, SquareTerminal, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DocumentsPane } from "@/components/explorer/DocumentsPane";
import { AggregatePane } from "@/components/aggregation/AggregatePane";
import { ShellPane } from "@/components/shell/ShellPane";
import { IndexesSheet } from "@/components/explorer/IndexesSheet";
import { useExplorer, type Tab, type TabMode } from "@/stores/explorer";
import { useSettings } from "@/stores/settings";
import { cn } from "@/lib/utils";

const MODES: { id: TabMode; label: string; icon: typeof FileJson2; advanced?: boolean }[] = [
  { id: "documents", label: "Documents", icon: FileJson2 },
  { id: "aggregate", label: "Aggregate", icon: ListTree },
  { id: "shell", label: "Shell", icon: SquareTerminal, advanced: true },
];

export function CollectionTab({ tab }: { tab: Tab }) {
  const setTabMode = useExplorer((s) => s.setTabMode);
  const advancedMode = useSettings((s) => s.advancedMode);
  const setAdvancedMode = useSettings((s) => s.setAdvancedMode);
  const [indexesOpen, setIndexesOpen] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* mode bar */}
      <div className="no-select flex h-9 shrink-0 items-center gap-1 border-b px-2">
        {MODES.filter((m) => !m.advanced || advancedMode).map((m) => (
          <button
            key={m.id}
            onClick={() => setTabMode(tab.id, m.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              tab.mode === m.id
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            <m.icon className="h-3.5 w-3.5" />
            {m.label}
          </button>
        ))}
        {!advancedMode && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => {
                  setAdvancedMode(true);
                  setTabMode(tab.id, "shell");
                }}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground"
              >
                <SquareTerminal className="h-3.5 w-3.5" />
                Shell
              </button>
            </TooltipTrigger>
            <TooltipContent>Raw shell queries — click to enable advanced mode</TooltipContent>
          </Tooltip>
        )}

        <div className="flex-1" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs text-muted-foreground"
              onClick={() => setIndexesOpen(true)}
            >
              <Wrench className="h-3.5 w-3.5" />
              Indexes
            </Button>
          </TooltipTrigger>
          <TooltipContent>Indexes & collection stats</TooltipContent>
        </Tooltip>
      </div>

      {tab.mode === "documents" && <DocumentsPane tab={tab} />}
      {tab.mode === "aggregate" && <AggregatePane tab={tab} />}
      {tab.mode === "shell" && advancedMode && <ShellPane tab={tab} />}

      <IndexesSheet tab={tab} open={indexesOpen} onOpenChange={setIndexesOpen} />
    </div>
  );
}
