import { useEffect, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import { TopBar } from "@/components/layout/TopBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { StatusBar } from "@/components/layout/StatusBar";
import { Workspace } from "@/components/explorer/Workspace";
import { CommandPalette } from "@/components/CommandPalette";
import { useConnections } from "@/stores/connections";
import { checkForUpdates } from "@/lib/updater";

function App() {
  const status = useConnections((s) => s.status);
  const init = useConnections((s) => s.init);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    void init();
    void checkForUpdates();
  }, [init]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (useConnections.getState().status === "connected") {
          setPaletteOpen((open) => !open);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col overflow-hidden">
        {status === "connected" ? (
          <>
            <TopBar onOpenPalette={() => setPaletteOpen(true)} />
            <div className="flex min-h-0 flex-1">
              <Sidebar />
              <Workspace />
            </div>
            <StatusBar />
            <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
          </>
        ) : (
          <WelcomeScreen />
        )}
      </div>
    </TooltipProvider>
  );
}

export default App;
