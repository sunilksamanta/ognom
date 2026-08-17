import { useEffect, useState } from "react";
import { KeyRound, Lock, Pencil, ShieldAlert } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useConnections } from "@/stores/connections";
import { useExplorer } from "@/stores/explorer";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";
import { formatCount } from "@/lib/bson";
import { cn } from "@/lib/utils";

/**
 * Status bar: connection + topology on the left, the current query's numbers
 * in the middle, the write-mode switch, timezone and version on the right.
 * The write-mode switch is where a read-only / production workspace is
 * flipped into edit mode for the session.
 */
export function StatusBar() {
  const active = useConnections((s) => s.active);
  const security = useConnections((s) => s.security);
  const workspace = useConnections((s) => s.workspaces.find((w) => w.info.id === s.activeId));
  const setReadOnly = useConnections((s) => s.setReadOnly);
  const tab = useExplorer((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const confirmProdEdit = useSettings((s) => s.confirmProdEdit);
  const ui = useUi((s) => s.set);
  const [version, setVersion] = useState("");
  const [confirmEdit, setConfirmEdit] = useState(false);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(""));
  }, []);

  const hosts = (active?.hostSummary ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  const replica = active?.topology.match(/Replica set · (.+)/)?.[1];

  let stats: React.ReactNode = null;
  if (tab) {
    if ((tab.mode === "documents" || tab.mode === "table") && tab.docs.execMs !== null) {
      const d = tab.docs;
      const from = d.page * d.limit + 1;
      const to = d.page * d.limit + d.docs.length;
      stats = (
        <span>
          {d.docs.length > 0 ? `${formatCount(from)}-${formatCount(to)}` : "0"} of{" "}
          <b>{d.count === null ? "?" : `${d.countExact ? "" : "~"}${formatCount(d.count)}`}</b> · {d.execMs} ms
        </span>
      );
    } else if (tab.mode === "aggregate" && tab.agg.docs) {
      stats = (
        <span>
          <b>{formatCount(tab.agg.docs.length)}</b> results · {tab.agg.execMs} ms
        </span>
      );
    } else if (tab.mode === "shell" && tab.shell.outcome) {
      stats = <span>{tab.shell.outcome.execMs} ms</span>;
    }
  } else if (active) {
    stats = <span>No collection open</span>;
  }

  const tz = (() => {
    const off = -new Date().getTimezoneOffset();
    const sign = off >= 0 ? "+" : "-";
    const h = Math.floor(Math.abs(off) / 60);
    const m = Math.abs(off) % 60;
    return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
  })();

  const access = workspace?.info.access ?? "readwrite";
  const readOnly = workspace?.readOnly ?? false;

  const toggleEdit = () => {
    if (!workspace) return;
    if (readOnly && access === "production" && confirmProdEdit) {
      setConfirmEdit(true);
      return;
    }
    setReadOnly(!readOnly);
  };

  return (
    <>
      <footer className="statusbar no-select">
        {active ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={() => ui({ serverInfo: true })}>
                <i className={cn("dot", access === "production" && "dgr")} />
                {active.name}
                {replica && (
                  <>
                    {" "}· <b>{replica}</b>
                  </>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <div className="font-mono text-[11px]">
                <div>{active.topology}</div>
                {hosts.map((h) => (
                  <div key={h}>{h}</div>
                ))}
                <div className="mt-1 text-text-3">Click for server details</div>
              </div>
            </TooltipContent>
          </Tooltip>
        ) : (
          <span>
            <i className="dot off" style={{ display: "inline-block", verticalAlign: -1, marginRight: 6 }} />
            Disconnected
          </span>
        )}
        {stats}
        {active && <span>MongoDB {active.serverVersion}</span>}
        {security?.degraded && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1 text-warn">
                <KeyRound style={{ width: 11, height: 11 }} />
                keychain unavailable
              </span>
            </TooltipTrigger>
            <TooltipContent>
              You opted into the OS keychain, but it isn't reachable - the encrypted local key file is
              being used instead.
            </TooltipContent>
          </Tooltip>
        )}

        <div className="r">
          {workspace && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={cn("edit", readOnly ? (access === "production" ? "prod" : "ro") : "rw")}
                  onClick={toggleEdit}
                  aria-pressed={!readOnly}
                >
                  {readOnly ? (
                    access === "production" ? (
                      <ShieldAlert />
                    ) : (
                      <Lock />
                    )
                  ) : (
                    <Pencil />
                  )}
                  {readOnly
                    ? access === "production"
                      ? "production · read-only"
                      : "read-only"
                    : access === "production"
                      ? "production · edit mode"
                      : "edit mode"}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {readOnly
                  ? "Writes are blocked in this workspace. Click to switch to edit mode for this session."
                  : "Writes are allowed. Click to make this workspace read-only again."}
              </TooltipContent>
            </Tooltip>
          )}
          <span>{tz}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="v" onClick={() => ui({ about: true })}>
                Ognom{version ? ` ${version}` : ""}
              </button>
            </TooltipTrigger>
            <TooltipContent>About Ognom</TooltipContent>
          </Tooltip>
        </div>
      </footer>

      <ConfirmDialog
        open={confirmEdit}
        onOpenChange={setConfirmEdit}
        title="Enable edit mode on production?"
        description={
          <>
            <b className="text-text">{active?.name}</b> is marked as production. In edit mode every write
            (updates, deletes, drops, index changes) goes straight to the live server. Destructive actions
            still ask for confirmation.
          </>
        }
        confirmLabel="Enable edit mode"
        destructive
        requireAck
        ackLabel="I understand this is production"
        onConfirm={() => {
          setReadOnly(false);
          setConfirmEdit(false);
        }}
      />
    </>
  );
}
