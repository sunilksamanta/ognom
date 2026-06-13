import { Coins } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { TokenUsage } from "@/lib/ai";
import { cn } from "@/lib/utils";

function fmt(n: number): string {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Compact total-token chip; hover reveals the input/output breakdown. */
export function TokenBadge({
  usage,
  label = "tokens",
  className,
}: {
  usage: TokenUsage;
  label?: string;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "flex items-center gap-1 tabular-nums text-muted-foreground",
            className
          )}
        >
          <Coins className="h-3 w-3 opacity-70" />
          {fmt(usage.total)} {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <div className="space-y-0.5 text-xs">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Input</span>
            <span className="tabular-nums">{usage.input.toLocaleString()}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Output</span>
            <span className="tabular-nums">{usage.output.toLocaleString()}</span>
          </div>
          <div className="mt-0.5 flex justify-between gap-4 border-t pt-0.5 font-medium">
            <span>Total</span>
            <span className="tabular-nums">{usage.total.toLocaleString()}</span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
