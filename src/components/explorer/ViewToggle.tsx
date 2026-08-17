import { FileJson2, Table2 } from "lucide-react";
import type { ViewMode } from "@/stores/explorer";
import { cn } from "@/lib/utils";

/** Table / Documents segmented control for secondary result lists. */
export function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (view: ViewMode) => void }) {
  return (
    <div className="seg no-select">
      <button className={cn(view === "table" && "on")} onClick={() => onChange("table")}>
        <Table2 />
        Table
      </button>
      <button className={cn(view === "json" && "on")} onClick={() => onChange("json")}>
        <FileJson2 />
        Documents
      </button>
    </div>
  );
}
