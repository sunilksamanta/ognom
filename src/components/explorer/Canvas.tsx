import { Rows3, Search, Terminal } from "lucide-react";
import { Blank } from "@/components/layout/Blank";
import { CollectionView } from "@/components/explorer/CollectionView";
import { useExplorer } from "@/stores/explorer";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";
import { cn } from "@/lib/utils";

const IS_MAC = navigator.platform.toUpperCase().includes("MAC");
const MOD = IS_MAC ? "⌘" : "Ctrl ";

/**
 * The canvas: every open collection stays mounted (its state survives tab
 * switches); only the active one is visible. With nothing open it is the
 * "nothing open" blank pane with start actions.
 */
export function Canvas() {
  const tabs = useExplorer((s) => s.tabs);
  const activeTabId = useExplorer((s) => s.activeTabId);
  const selectedDb = useExplorer((s) => s.selectedDb);
  const collections = useExplorer((s) => s.collections);
  const openCollection = useExplorer((s) => s.openCollection);
  const openCollectionAs = useExplorer((s) => s.openCollectionAs);
  const setPalette = useUi((s) => s.setPalette);
  const advancedMode = useSettings((s) => s.advancedMode);
  const setAdvancedMode = useSettings((s) => s.setAdvancedMode);

  if (tabs.length === 0) {
    const first = selectedDb ? collections[selectedDb]?.[0]?.name : undefined;
    return (
      <main className="canvas">
        <Blank
          starts={
            <>
              <button
                className="s"
                onClick={() => (first && selectedDb ? openCollection(selectedDb, first) : setPalette(true))}
              >
                <Rows3 />
                Open a collection <span className="kbd">{MOD}O</span>
              </button>
              <button className="s" onClick={() => setPalette(true)}>
                <Search />
                Find anything <span className="kbd">{MOD}K</span>
              </button>
              {first && selectedDb && (
                <button
                  className="s"
                  onClick={() => {
                    setAdvancedMode(true);
                    openCollectionAs(selectedDb, first, "shell");
                  }}
                >
                  <Terminal />
                  Shell{!advancedMode && " (advanced)"}
                </button>
              )}
            </>
          }
        />
      </main>
    );
  }

  return (
    <main className="canvas">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={cn("min-h-0 flex-1 flex-col", tab.id === activeTabId ? "flex" : "hidden")}
        >
          <CollectionView tab={tab} active={tab.id === activeTabId} />
        </div>
      ))}
    </main>
  );
}
