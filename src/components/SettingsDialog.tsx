import { toast } from "sonner";
import { RefreshCw, Trash2 } from "lucide-react";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DRAWER_DEFAULT, PICKER_DEFAULT, useSettings } from "@/stores/settings";
import { useConnections } from "@/stores/connections";
import { useUi } from "@/stores/ui";
import { checkForUpdates } from "@/lib/updater";

const IS_MAC = navigator.platform.toUpperCase().includes("MAC");

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="row">
      <div className="l">
        <b>{label}</b>
        {hint && <span>{hint}</span>}
      </div>
      <div className="rr">{children}</div>
    </div>
  );
}

/** Settings: explorer defaults, safety, appearance shortcut, security, app. */
export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const {
    pageSize,
    setPageSize,
    advancedMode,
    setAdvancedMode,
    offerBackupOnDelete,
    setOfferBackupOnDelete,
    confirmProdEdit,
    setConfirmProdEdit,
    clearShellHistory,
    setPickerWidth,
    setDrawerWidth,
  } = useSettings();
  const security = useConnections((s) => s.security);
  const setSecretBackend = useConnections((s) => s.setSecretBackend);
  const ui = useUi((s) => s.set);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>preferences for this machine · nothing leaves it</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="fld">
            <label>Explorer</label>
            <div className="card">
              <Row label="Documents per page" hint="Default page size for new collection tabs">
                <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                  <SelectTrigger className="h-8 w-24 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 25, 50, 100].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
              <Row label="Advanced mode" hint="Unlocks the raw Shell view on every collection">
                <Switch checked={advancedMode} onCheckedChange={setAdvancedMode} />
              </Row>
              <Row label="Panel widths" hint="Restore the picker and drawer to their defaults">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPickerWidth(PICKER_DEFAULT);
                    setDrawerWidth(DRAWER_DEFAULT);
                    toast.success("Panel widths reset");
                  }}
                >
                  Reset
                </Button>
              </Row>
            </div>
          </div>

          <div className="fld">
            <label>Safety</label>
            <div className="card">
              <Row label="Offer a backup before deleting" hint="Multi-document deletes show an optional export first">
                <Switch checked={offerBackupOnDelete} onCheckedChange={setOfferBackupOnDelete} />
              </Row>
              <Row label="Confirm edit mode on production" hint="Ask before a production workspace leaves read-only">
                <Switch checked={confirmProdEdit} onCheckedChange={setConfirmProdEdit} />
              </Row>
              <Row label="Encryption key in the OS keychain" hint="Off = a private key file next to the app data, zero prompts">
                <Switch checked={security?.secretBackend === "keychain"} onCheckedChange={(on) => void setSecretBackend(on ? "keychain" : "file")} />
              </Row>
            </div>
          </div>

          <div className="fld">
            <label>Appearance</label>
            <div className="card">
              <Row label="Themes and density" hint={`Nine themes, three densities · ${IS_MAC ? "⌘⇧T" : "Ctrl+Shift+T"} cycles themes`}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onOpenChange(false);
                    ui({ appearance: true });
                  }}
                >
                  Open
                </Button>
              </Row>
            </div>
          </div>

          <div className="fld">
            <label>Data on this machine</label>
            <div className="card">
              <Row label="Shell history" hint="Recent statements, stored locally">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    clearShellHistory();
                    toast.success("Shell history cleared");
                  }}
                >
                  <Trash2 />
                  Clear
                </Button>
              </Row>
              <Row label="Updates" hint="Ognom updates itself from GitHub releases">
                <Button variant="outline" size="sm" onClick={() => void checkForUpdates(true)}>
                  <RefreshCw />
                  Check for updates
                </Button>
              </Row>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
