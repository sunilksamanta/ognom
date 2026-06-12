import { useEffect, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import { TopBar } from "@/components/layout/TopBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { StatusBar } from "@/components/layout/StatusBar";
import { Workspace } from "@/components/explorer/Workspace";
import { listen } from "@tauri-apps/api/event";
import { CommandPalette } from "@/components/CommandPalette";
import { SplashScreen } from "@/components/SplashScreen";
import { AboutDialog } from "@/components/AboutDialog";
import { useConnections } from "@/stores/connections";
import { useSettings } from "@/stores/settings";
import { useStudio } from "@/stores/studio";
import { StudioPane } from "@/components/studio/StudioPane";
import { checkForUpdates } from "@/lib/updater";

function App() {
  const status = useConnections((s) => s.status);
  const init = useConnections((s) => s.init);
  const terminator = useStudio((s) => s.terminator);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    void init();
    void checkForUpdates();
  }, [init]);

  // System menu (Help → About / Check for Updates…)
  useEffect(() => {
    const unlisten = listen<string>("menu-action", (event) => {
      if (event.payload === "check-updates") void checkForUpdates(true);
      else if (event.payload === "about-ognom") setAboutOpen(true);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  // Disable the native browser context menu app-wide; custom menus are used
  // instead. Editable text fields keep their native menu (copy/paste/spellcheck).
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"], .monaco-editor')) {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === "k") {
        e.preventDefault();
        if (useConnections.getState().status === "connected") {
          setPaletteOpen((open) => !open);
        }
      } else if (key === "b") {
        e.preventDefault();
        if (useConnections.getState().status === "connected") {
          useSettings.getState().toggleSidebar();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <TooltipProvider delayDuration={300}>
      <SplashScreen />
      <div className="flex h-full flex-col overflow-hidden">
        {status === "connected" ? (
          <>
            <TopBar onOpenPalette={() => setPaletteOpen(true)} />
            <div className="flex min-h-0 flex-1">
              {terminator ? (
                <StudioPane />
              ) : (
                <>
                  <Sidebar />
                  <Workspace />
                </>
              )}
            </div>
            <StatusBar />
            <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
          </>
        ) : (
          <WelcomeScreen />
        )}
      </div>
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    </TooltipProvider>
  );
}

export default App;
