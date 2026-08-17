<p align="center">
  <img src="public/icon.svg" width="104" alt="Ognom" />
</p>

<h1 align="center">Ognom</h1>

<p align="center">
  <b>The free, no-nonsense MongoDB client.</b><br/>
  A fast native console for people who query: table and document views, a typed document
  drawer, an aggregation builder, indexes and schema, a real shell - and connections that
  know when they are production.
</p>

<p align="center">
  <a href="https://github.com/sunilksamanta/ognom/releases/latest"><img alt="Download" src="https://img.shields.io/github/v/release/sunilksamanta/ognom?style=for-the-badge&label=Download&color=10b981"></a>
  &nbsp;
  <img alt="Platforms" src="https://img.shields.io/badge/macOS%20·%20Windows%20·%20Linux-private?style=for-the-badge&color=27272a">
  &nbsp;
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge"></a>
</p>

---

## 📑 Table of contents

- [⚡ Why Ognom](#-why-ognom)
- [🖥️ The console](#️-the-console)
- [✨ Features](#-features)
- [🛡️ Production, read-only and backups](#️-production-read-only-and-backups)
- [🎨 Themes and density](#-themes-and-density)
- [📦 Installation](#-installation)
- [🚀 Getting started](#-getting-started)
- [⌨️ Shortcuts](#️-shortcuts)
- [🔐 Security model](#-security-model)
- [🔌 Connect to anything](#-connect-to-anything)
- [🔧 Build from source](#-build-from-source)
- [📚 Docs and more](#-docs-and-more)
- [📄 License](#-license)

---

## ⚡ Why Ognom

- 🆓 **Free and open source.** No license keys, no locked "premium" tabs, no account, no telemetry.
- 🪶 **Native and lightweight.** Built with Tauri (Rust + your OS webview) - a tiny binary and a fraction of the memory an Electron app burns.
- 🗂️ **Many connections at once.** Every saved connection is a tile on the rail; open several as live workspaces and switch in one click - each keeps its own tabs, picker and query state.
- 🛡️ **Knows what production is.** Mark a connection as production and it opens read-only. Writes are blocked at the API layer until you switch to edit mode from the status bar - and Ognom asks first.
- 🔐 **Secure by default.** Credentials are encrypted at rest with AES-256-GCM; one toggle moves the key into your OS keychain. Passwords are never sent back to the UI.
- 🎯 **No AI, no chat, no fluff.** Ognom 2.0 is a focused console for developers. Everything is a query, a table, a document or an index.

---

## 🖥️ The console

Ognom 2.0 is a single window built on the Ognom design system:

| Region | What lives there |
|---|---|
| **Titlebar** | The breadcrumb (`collection · db · connection · host`), find anything (⌘K), themes, settings. |
| **Rail** | Connection tiles first (colour tag, live dot, dashed border = read-only, red border = production), then Data / Server / Operations / Help, and Appearance / Settings at the bottom. |
| **Picker** | The database button, one search across collections, then **Open** tabs, **Pinned** collections, **Collections** with counts, and **Saved queries**. |
| **Canvas** | Collection title and stat strip (data, avg doc, indexes, storage), the view row (**Table · Documents · Schema · Aggregate · Indexes · Shell**), the results, and the **dock**. |
| **Dock** | Find and Aggregate share one transport. Matched count, timing and the winning plan sit above the input, so a query never hides its cost. Build, sort/projection, explain, save, run. |
| **Drawer** | Click any row: **Fields** (inline editing that preserves BSON types), **JSON** (full editor in shell syntax) and **Diff** against the loaded document. Save with ⌘S. |
| **Status bar** | Connection and replica set, the current page and timing, the **write-mode switch**, timezone and version. |

Every empty pane is the same component: the outline mark as a watermark, a message, and the version block pinned to the bottom.

---

## ✨ Features

- **Table and Documents views** with BSON-aware colouring, type hints in table headers, multi-select with bulk delete, click-to-inspect nested values.
- **Query dock** with mongosh-flavoured filters (`ObjectId()`, `ISODate()`, `$regex`, unquoted keys), sort and projection, a visual query builder, explain plans with suggested indexes, saved queries per collection, and pagination.
- **Aggregation builder** with stage snippets, enable/disable, reorder, run-to-stage previews, per-stage stats (docs out, drop-off, cumulative time), explain, copy as shell, open in shell.
- **Schema analysis** (field coverage and types from a sample) and an **Indexes** pane (stats, usage counts, unused hints, a create form with templates: single, compound, text, geo, hashed, TTL).
- **Shell (advanced)** for one statement at a time with real shell syntax, history and completions.
- **Import and export** as JSON, NDJSON, CSV or BSON (mongodump-compatible), streamed with progress and cancel.
- **Copy a collection to another workspace**, **diff two collections** and sync the differences, duplicate, clear, drop.
- **Server details** and an **operations panel** (currentOp, profiler, live stats).
- **Connections**: URI or fields, colour tags, session mode, keychain toggle, encrypted export/import.

---

## 🛡️ Production, read-only and backups

- Each saved connection has a **session mode**: **Read & write**, **Read-only**, or **Production**.
- Read-only and production connections open with writes blocked. The status bar shows `read-only` (or `production · read-only`); click it to switch to **edit mode** for the session. Production asks you to acknowledge first, and paints its tile and title dot red so you always know where you are.
- The block is enforced in one place - the API layer - so no menu, shortcut, shell statement or `$out` stage can write to a read-only workspace.
- **Destructive actions ask properly.** Drop and clear require typing the collection name and offer an export first (BSON dump / JSON backup). Deleting several documents offers a JSON backup of exactly those documents before it runs.

---

## 🎨 Themes and density

Nine themes from the theme kit - **Mongo dark** (default), **Mongo light**, **Bloom**, **Bloom noir**, **Midnight**, **Mono**, **Contrast**, **Solar**, and **Follow OS** - and three densities (compact / comfortable / roomy). ⌘⇧T cycles themes. A theme is one CSS block of the same 30 tokens; components never see a literal colour, so a new theme cannot break a component.

---

## 📦 Installation

Grab the build for your OS from the **[latest release ⬇️](https://github.com/sunilksamanta/ognom/releases/latest)**. Installed apps **update themselves** from GitHub releases (signature‑verified) - so you only do this once.

| Platform | File |
|---|---|
| 🍎 **macOS** (Apple Silicon) | `Ognom_x.y.z_aarch64.dmg` |
| 🍎 **macOS** (Intel) | `Ognom_x.y.z_x64.dmg` |
| 🪟 **Windows** | `Ognom_x.y.z_x64-setup.exe` (or the `.msi`) |
| 🐧 **Linux** | `.AppImage`, `.deb`, or `.rpm` |

### 🍎 macOS

**1. Pick the right build.** Apple menu → **About This Mac**. If it says **Apple M1/M2/M3/M4...** (Apple Silicon), download the **`aarch64`** `.dmg`; if it says **Intel**, download the **`x64`** `.dmg`. *(Picked the wrong one? The Intel build also runs on Apple Silicon via Rosetta, but the native `aarch64` build is faster - prefer it.)*

**2. Install.** Open the `.dmg` and drag **Ognom** into your **Applications** folder.

**3. First launch - clear Gatekeeper (one command).** Ognom is open source and distributed outside the App Store, so macOS quarantines it on download. The one step that works on **every Mac** - and is **required on Apple Silicon** - is to remove that quarantine flag. Open **Terminal** and run:

```bash
xattr -dr com.apple.quarantine /Applications/Ognom.app
```

Then double‑click **Ognom** in Applications. That's it - you only do this once. ✅

<details>
<summary><b>Why is this needed? (and why right‑click → Open isn't enough on Apple Silicon)</b></summary>

macOS adds a `com.apple.quarantine` flag to anything you download. Because Ognom isn't signed with a paid Apple Developer certificate, Gatekeeper blocks the quarantined app - but the message differs by chip:

- **Apple Silicon (M‑series):** macOS shows *"Ognom is damaged and can't be opened."* There is **no** right‑click → Open or "Open Anyway" escape for the *damaged* verdict - Apple Silicon strictly enforces code signatures, so the quarantine flag **must** be removed with the command above.
- **Intel:** macOS shows the gentler *"unidentified developer"* warning, which right‑click → Open *can* bypass.

The `xattr` command simply strips the download flag so macOS treats the app like one you built yourself. Notarized apps from a paid Developer account skip all of this - Ognom is free and open source, and the code is right here for you to read or build yourself.
</details>

<details>
<summary><b>Intel Mac alternative - right‑click → Open (no Terminal)</b></summary>

On an **Intel** Mac you can skip the command:

1. In **Finder**, open **Applications**.
2. **Right‑click** (or Control‑click) **Ognom** → **Open**.
3. Click **Open** in the dialog. macOS remembers your choice.

If you instead see a *"damaged"* message (typical on Apple Silicon), use the `xattr` command above - right‑click → Open won't clear it.
</details>

### 🪟 Windows

1. Download **`Ognom_x.y.z_x64-setup.exe`** (NSIS installer) - or the **`.msi`** if your org prefers MSI.
2. Run it. Because the app isn't code‑signed with a paid certificate, **SmartScreen** may show *"Windows protected your PC."* Click **More info → Run anyway**.
3. Follow the installer. Launch **Ognom** from the Start menu. Updates install automatically going forward.

### 🐧 Linux

Pick the package that matches your distro. You may need GTK/WebKit runtime libraries (`libwebkit2gtk-4.1`, `libgtk-3`) - most desktops already have them.

<details>
<summary><b>AppImage (works almost everywhere)</b></summary>

```bash
chmod +x Ognom_x.y.z_amd64.AppImage
./Ognom_x.y.z_amd64.AppImage
```

If it won't start, install FUSE (`sudo apt install libfuse2` on Debian/Ubuntu).
</details>

<details>
<summary><b>Debian / Ubuntu (.deb)</b></summary>

```bash
sudo apt install ./Ognom_x.y.z_amd64.deb
# or: sudo dpkg -i Ognom_x.y.z_amd64.deb && sudo apt -f install
```
</details>

<details>
<summary><b>Fedora / RHEL (.rpm)</b></summary>

```bash
sudo dnf install ./Ognom-x.y.z-1.x86_64.rpm
# or: sudo rpm -i Ognom-x.y.z-1.x86_64.rpm
```
</details>

---

## 🚀 Getting started

1. Click **+** on the rail (or press ⌘K and pick *New connection*). Paste a URI or fill in host and credentials, give it a name and a colour tag, choose the session mode, **Test**, then **Connect**.
2. Pick a database in the picker and click a collection. It opens in the **Table** view with the query dock underneath.
3. Type a filter in the dock (`{ status: "paid", total: { $gt: 100 } }`) and press ⌘⏎. Sort and project with **Sort**, inspect the plan with **Explain**, keep it with **Save**.
4. Click a row to open it in the drawer. Edit a value inline (types are preserved), or switch to **JSON**. **Diff** shows exactly what will change. ⌘S saves.
5. Right-click a collection in the picker for pin, duplicate, copy to another workspace, diff, clear or drop.

---

## ⌨️ Shortcuts

| Keys | Action |
|---|---|
| ⌘K | Find anything: collections, databases, connections, actions |
| ⌘O | Open a collection |
| ⌘N | Insert a document (opens the drawer) |
| ⌘⏎ | Run the query or pipeline |
| ⌘S | Save the document in the drawer |
| ⌘W | Close the active tab |
| ⌘B | Toggle the picker |
| ⌘, | Settings |
| ⌘⇧T | Cycle themes |
| Esc | Close overlays |

---

## 🔐 Security model

- Connection profiles live in your OS app-data directory as JSON; **secrets are AES-256-GCM encrypted**.
- The 256-bit master key is generated on first run and stored in a private (`0600`) key file by default - no permission prompts, ever. Flip **"Encryption key in the OS keychain"** (Settings > Safety) to move it into the **macOS Keychain / Windows Credential Manager / Secret Service** (saved connections keep working). If the keychain becomes unreachable, Ognom falls back to the key file and **tells you so in the status bar** - no silent downgrades.
- The UI never receives stored secrets back; editing a connection keeps the stored password unless you type a new one.
- **Exports are honest about secrets.** A *no-passwords* export is plain, portable metadata - safe to share. A *full backup* re-encrypts credentials under a **passphrase you choose** (Argon2id then AES-256-GCM); the master key never leaves your machine, so a naive copy of the on-disk file cannot be decrypted elsewhere.
- The webview runs with a strict Content-Security-Policy and no remote content - fonts, Monaco and every asset are bundled locally, so the app works fully offline.
- Your queries go to **your** MongoDB server and nowhere else. There is no AI, no telemetry, no account.

---

## 🔌 Connect to anything

Standard and `mongodb+srv`, replica sets, all SCRAM mechanisms, X.509, LDAP, TLS with custom CA / client certificates, read preferences, timeouts - all under *Advanced options*. Or just paste a connection string.

---

## 🔧 Build from source

**Prerequisites:** [Rust](https://rustup.rs), Node 20+, and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```bash
git clone https://github.com/sunilksamanta/ognom.git
cd ognom
npm install
npm run tauri dev      # run in development
npm run tauri build    # produce a bundle for your OS
```

---

## 📚 Docs and more

- **Design system** - the theme kit and component layer this UI is built on live in the sibling `ognom-design-system` folder; `src/styles/` holds the in-repo copies.
- **Shell syntax** - [MONGODB_SHELL_SYNTAX.md](MONGODB_SHELL_SYNTAX.md), everything the embedded shell understands.
- **Releasing** - [RELEASING.md](RELEASING.md), how builds are signed and shipped.
- **In-app Help** - the `?` on the rail.

### Developing in a browser

`npm run dev` outside the desktop shell installs an in-memory Tauri shim (`src/dev/mockTauri.ts`) with a fake server, so the whole UI can be exercised and screenshotted in a normal browser. It is never part of a production bundle.

---

## 📄 License

[MIT](LICENSE) - free for everyone, forever.

<p align="center"><sub>Built with Rust 🦀, Tauri and React. Made for the people who query.</sub></p>
