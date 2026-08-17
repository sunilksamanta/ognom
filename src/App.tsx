import { useEffect } from "react";
import { Loader2, Plus } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Titlebar } from "@/components/layout/Titlebar";
import { Rail } from "@/components/layout/Rail";
import { Picker } from "@/components/layout/Picker";
import { StatusBar } from "@/components/layout/StatusBar";
import { Blank } from "@/components/layout/Blank";
import { Canvas } from "@/components/explorer/Canvas";
import { DocDrawer } from "@/components/explorer/DocDrawer";
import { CommandPalette } from "@/components/CommandPalette";
import { ConnectionManager } from "@/components/connections/ConnectionManager";
import { AppearanceDialog } from "@/components/AppearanceDialog";
import { SettingsDialog } from "@/components/SettingsDialog";
import { HelpDialog } from "@/components/HelpDialog";
import { OpsDialog } from "@/components/OpsDialog";
import { ServerInfoDialog } from "@/components/ServerInfoDialog";
import { AboutDialog } from "@/components/AboutDialog";
import { WhatsNewDialog } from "@/components/WhatsNewDialog";
import { SplashScreen } from "@/components/SplashScreen";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useTheme } from "@/components/theme-provider";
import { useConnections } from "@/stores/connections";
import { useExplorer } from "@/stores/explorer";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";
import { seenVersion } from "@/lib/whatsnew";
import { checkForUpdates } from "@/lib/updater";
import { cn } from "@/lib/utils";

/** The active tab's drawer, mounted beside the canvas. */
function ActiveDrawer() {
  const tab = useExplorer((s) => s.tabs.find((t) => t.id === s.activeTabId));
  if (!tab || tab.drawer.kind === "closed") return null;
  return <DocDrawer key={tab.id} tab={tab} />;
}

/** Not connected: pick a saved connection or add one. */
function NotConnected() {
  const profiles = useConnections((s) => s.profiles);
  const connect = useConnections((s) => s.connect);
  const status = useConnections((s) => s.status);
  const openConnections = useUi((s) => s.openConnections);
  const recent = profiles.slice(0, 3);
  return (
    <main className="canvas">
      <Blank
        title={status === "connecting" ? "Connecting" : "Not connected"}
        text={
          profiles.length
            ? "Pick a saved connection from the rail, or add a new one. Nothing is read until you connect."
            : "Add a connection to get started. localhost, a replica set or Atlas - it takes ten seconds."
        }
        actions={
          <>
            {recent.map((p, i) => (
              <button
                key={p.id}
                className={cn("btn", i > 0 && "qt")}
                disabled={status === "connecting"}
                onClick={() => void connect(p.id)}
              >
                {p.name}
                {p.access === "production" && <span className="pill dgr">production</span>}
                {p.access === "readonly" && <span className="pill warn">read-only</span>}
              </button>
            ))}
            <button className="btn pri" onClick={() => openConnections("form")}>
              <Plus />
              New connection
            </button>
          </>
        }
        serverLine="No server session"
      />
    </main>
  );
}

function App() {
  const status = useConnections((s) => s.status);
  const activeId = useConnections((s) => s.activeId);
  const restoring = useConnections((s) => s.restoring);
  const init = useConnections((s) => s.init);
  const ui = useUi();
  const { cycleTheme } = useTheme();

  // What's New once per version, after the splash settles.
  useEffect(() => {
    const timer = setTimeout(() => {
      void getVersion()
        .then((v) => {
          if (seenVersion() !== v) ui.set({ whatsNew: true });
        })
        .catch(() => {});
    }, 1600);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void init();
    void checkForUpdates();
  }, [init]);

  // System menu (Help > About / Check for Updates)
  useEffect(() => {
    const unlisten = listen<string>("menu-action", (event) => {
      if (event.payload === "check-updates") void checkForUpdates(true);
      else if (event.payload === "about-ognom") ui.set({ about: true });
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // No native context menu (custom menus everywhere); editable text keeps its own.
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"], .monaco-editor')) return;
      e.preventDefault();
    };
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);

  // Global shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      const connected = useConnections.getState().status === "connected";
      if (key === "k") {
        e.preventDefault();
        if (connected) ui.setPalette(!useUi.getState().palette);
      } else if (key === "t" && e.shiftKey) {
        e.preventDefault();
        cycleTheme();
      } else if (key === ",") {
        e.preventDefault();
        ui.set({ settings: true });
      } else if (key === "o") {
        e.preventDefault();
        if (connected) ui.setPalette(true);
      } else if (key === "n" && !e.shiftKey) {
        const ex = useExplorer.getState();
        const tab = ex.tabs.find((t) => t.id === ex.activeTabId);
        const ws = useConnections.getState();
        const ro = ws.workspaces.find((w) => w.info.id === ws.activeId)?.readOnly;
        if (tab && !ro) {
          e.preventDefault();
          if (tab.mode !== "documents" && tab.mode !== "table") ex.setTabMode(tab.id, "documents");
          ex.setDrawer(tab.id, { kind: "insert" });
        }
      } else if (key === "w") {
        const ex = useExplorer.getState();
        if (ex.activeTabId) {
          e.preventDefault();
          ex.closeTab(ex.activeTabId);
        }
      } else if (key === "b") {
        e.preventDefault();
        useSettings.getState().togglePicker();
      } else if (key === "enter") {
        // Run the active query from anywhere in the canvas.
        const ex = useExplorer.getState();
        const tab = ex.tabs.find((t) => t.id === ex.activeTabId);
        if (!tab) return;
        const target = e.target as HTMLElement | null;
        if (target?.closest(".monaco-editor")) return; // editors bind their own
        if (tab.mode === "aggregate") void ex.runAggregate(tab.id);
        else if (tab.mode === "table" || tab.mode === "documents") void ex.runFind(tab.id, { resetPage: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cycleTheme]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickerCollapsed = useSettings((s) => s.pickerCollapsed);
  const connected = status === "connected";

  return (
    <TooltipProvider delayDuration={300}>
      <SplashScreen />
      <div className="win">
        <Titlebar />
        <div className="shell">
          <Rail />
          {connected ? (
            // key={activeId}: switching workspace remounts the picker/canvas so
            // they rebind to the freshly-hydrated explorer slice.
            <div key={activeId ?? "none"} className="flex min-h-0 min-w-0 flex-1">
              {!pickerCollapsed && <Picker />}
              <ErrorBoundary>
                <Canvas />
              </ErrorBoundary>
              <ErrorBoundary>
                <ActiveDrawer />
              </ErrorBoundary>
            </div>
          ) : restoring ? (
            <main className="canvas center">
              <Loader2 className="spin h-5 w-5 text-text-3" />
            </main>
          ) : (
            <NotConnected />
          )}
        </div>
        <StatusBar />
      </div>

      <CommandPalette open={ui.palette} onOpenChange={ui.setPalette} />
      <ConnectionManager />
      <AppearanceDialog open={ui.appearance} onOpenChange={(o) => ui.set({ appearance: o })} />
      <SettingsDialog open={ui.settings} onOpenChange={(o) => ui.set({ settings: o })} />
      <HelpDialog open={ui.help} onOpenChange={(o) => ui.set({ help: o })} />
      {connected && <OpsDialog open={ui.ops} onOpenChange={(o) => ui.set({ ops: o })} />}
      {connected && <ServerInfoDialog open={ui.serverInfo} onOpenChange={(o) => ui.set({ serverInfo: o })} />}
      <AboutDialog
        open={ui.about}
        onOpenChange={(o) => ui.set({ about: o })}
        onWhatsNew={() => ui.set({ about: false, whatsNew: true })}
      />
      <WhatsNewDialog open={ui.whatsNew} onOpenChange={(o) => ui.set({ whatsNew: o })} />
    </TooltipProvider>
  );
}

export default App;
