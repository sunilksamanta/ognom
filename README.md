<p align="center">
  <img src="public/icon.svg" width="104" alt="Ognom" />
</p>

<h1 align="center">Ognom</h1>

<p align="center">
  <b>The free MongoDB client that speaks to everyone.</b><br/>
  Engineers get a fast, precise workspace. Everyone else gets an AI studio that turns
  plain English into queries, charts, and answers — in the same app.
</p>

<p align="center">
  <a href="https://github.com/sunilksamanta/ognom/releases/latest"><img alt="Download" src="https://img.shields.io/github/v/release/sunilksamanta/ognom?style=for-the-badge&label=Download&color=10b981"></a>
  &nbsp;
  <img alt="Platforms" src="https://img.shields.io/badge/macOS%20·%20Windows%20·%20Linux-private?style=for-the-badge&color=27272a">
  &nbsp;
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge"></a>
</p>

<p align="center">
  <a href="#-install">Install</a> ·
  <a href="#-two-modes-one-app">Two modes</a> ·
  <a href="#-ognom-studio-terminator-mode">Studio</a> ·
  <a href="#-macos-cant-open-the-app-read-this">macOS fix</a> ·
  <a href="#-build-from-source">Build</a>
</p>

---

## Why Ognom

Most database tools force a choice: **powerful but intimidating**, or **friendly but shallow**. Ognom refuses that trade-off.

- 🆓 **Free & open source.** No license keys, no locked "premium" tabs, no account, no telemetry.
- 🪶 **Native & lightweight.** Built with Tauri (Rust + your OS webview) — a tiny binary and a fraction of the memory an Electron app burns.
- 🔐 **Secure by default.** Credentials are encrypted at rest with AES-256-GCM; one toggle moves the key into your OS keychain. Passwords are never sent back to the UI.
- 👥 **For developers *and* the people they work with.** Flip one switch in the header and the whole app changes shape to fit the task in front of you.

---

## 🔀 Two modes, one app

> You don't pick a tool for your skill level — you flip a switch for the task in front of you.

<table>
<tr>
<td width="50%" valign="top">

### 🖥️ Normal Mode
**For developers, DBAs & data engineers.**

A fast, keyboard-driven workspace with everything you expect from a serious MongoDB client — and nothing in the way.

Browse · query · aggregate · edit · index · explain.

</td>
<td width="50%" valign="top">

### 🤖 Terminator Mode — *Ognom Studio*
**For product managers, analysts & founders.**

Describe what you want in plain English. Studio writes the query, runs it, visualizes it, and explains it — no MongoDB knowledge required.

Ask · chart · summarize · optimize · export.

</td>
</tr>
</table>

One connection. One source of truth. The same safety guarantees underneath.

---

## 🖥️ Normal Mode — for people who write queries

| | |
|---|---|
| **Browse** | Databases & collections sidebar with sizes, a search filter, and a ⌘K jump-to-collection palette. Right-click menus everywhere — refresh, copy, edit, delete. |
| **Two views, done well** | Documents render as **JSON** (collapsible, type-colored, ObjectId/date aware) or a **table** (typed cells, sticky `_id`). |
| **Visual Query Builder** | Build filters as `field · operator · value` rows with **autocomplete from your latest 1,000 documents**, Match-ALL / Match-ANY logic, and a deep operator set (between, starts/ends with, regex, in/not-in, type, exists…). Drop to raw JSON anytime. |
| **Aggregate** | A stage-by-stage pipeline builder: enable/disable, reorder, run-to-stage previews, copy as shell, or eject into the shell. |
| **Schema Analyzer** | Sample your data and instantly see every field, its types, fill-rate %, and example values. |
| **Explain Plans** | Index usage, docs-vs-keys examined, timing, and a plain-language verdict (*"collection scan — add an index"*) for find **and** aggregate. |
| **Guided Index Builder** | Templates (single, compound, text, geo, hashed, TTL), a visual key editor, and full options (unique, sparse, hidden, partial filters, collation) — no syntax to memorize. |
| **Export & Import** | Push query results or whole collections to **JSON / CSV**; import JSON / NDJSON. |
| **Shell** *(advanced)* | A real query editor — `db.users.find({}).sort({ gpa: -1 }).limit(5)` — with proper highlighting, history, and helpers like `ObjectId()`, `ISODate()`, `NumberLong()`. |
| **Safety-first** | Destructive actions require an explicit *"I know what I'm doing"* confirmation. |

---

## 🤖 Ognom Studio (Terminator Mode)

Flip the **Terminator** switch in the header and the workspace becomes an AI-powered studio. Two flows:

### ✨ Prompt → Visualization
Type *"count orders by status as a pie chart."* Studio writes the query, runs it, and shows the result as data **and** a chart.

- **High-quality animated charts** — bar, line, pie, donut — with smooth animation, hover tooltips, and a theme-aware look. Switch types in a click.
- **See the query behind the answer** — every result has a *View Query* panel with the exact generated statement, a one-line explanation, and a Copy button. Curious users learn; engineers trust.
- **Suggest questions** — Studio proposes smart, collection-specific questions, so nobody faces a blank box.
- **Summarize** — a plain-language readout of any result set: the headline finding first, then the patterns.
- **Export** — charts as **PNG**, results as **JSON / CSV**.

### 🛠️ Query + AI Optimization
Run a query, then let AI improve it with one click: **Fix errors · Optimize · Explain · Suggest indexes · Add safety limits**. Apply the AI's improved query and re-run instantly. Send any visualized query straight here with **Send to Optimize**.

### 🧠 Your key, your model
- **Two AI modes** — **Normal** (fast, everyday) and **Deep Think** (a reasoning model for hard queries).
- **Bring your own OpenAI key** — stored locally and sent only to OpenAI from the Ognom backend, never through the browser layer.
- **Editable model names** — keep the defaults or point each mode at any model you prefer.
- **Always safe** — AI-generated queries run through Ognom's safe query layer (result caps, automatic limits) and **never execute writes from a prompt**.

> Set it up in **Settings → Prompts & AI**: paste your OpenAI API key under the **OpenAI** provider section.

---

## 📦 Install

Grab the build for your OS from the **[latest release ⬇️](https://github.com/sunilksamanta/ognom/releases/latest)**. Installed apps **update themselves** from GitHub releases (signature-verified).

| Platform | File |
|---|---|
| 🍎 **macOS** (Apple Silicon) | `Ognom_x.y.z_aarch64.dmg` |
| 🍎 **macOS** (Intel) | `Ognom_x.y.z_x64.dmg` |
| 🪟 **Windows** | `Ognom_x.y.z_x64-setup.exe` (or the `.msi`) |
| 🐧 **Linux** | `.AppImage`, `.deb`, or `.rpm` |

---

## 🍎 macOS: can't open the app? Read this

Ognom is an open-source app distributed outside the App Store, so macOS Gatekeeper will warn you the first time. **This is normal and expected** — here's the 10-second fix.

> *"Ognom can't be opened because Apple cannot check it for malicious software."*
> &nbsp;&nbsp;*or* &nbsp; *"Ognom" is damaged and can't be opened.*

**Option A — Right-click to open (easiest)**
1. In **Finder**, open your **Applications** folder.
2. **Right-click** (or Control-click) **Ognom** → **Open**.
3. Click **Open** in the dialog. macOS remembers your choice — you only do this once.

**Option B — Allow it from System Settings**
1. Try to open Ognom once (let the warning appear, then dismiss it).
2. Open  **Apple menu → System Settings → Privacy & Security**.
3. **Scroll to the very bottom** to the **Security** section. You'll see *"Ognom was blocked from use because it is not from an identified developer."*
4. Click **Open Anyway**, then confirm with **Open** / Touch ID.

**Option C — If it says "damaged" (clears the quarantine flag)**

Newer macOS sometimes blocks downloaded apps with a "damaged" message. Remove the quarantine attribute in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Ognom.app
```

Then open Ognom normally. ✅

> Why does this happen? Notarized apps from a paid Apple Developer account skip these prompts. Ognom is free and open source — the code is right here for you to read and build yourself.

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

## 🔐 Security model

- Connection profiles live in your OS app-data directory as JSON; **secrets are AES-256-GCM encrypted**.
- The 256-bit master key is generated on first run and stored in a private (`0600`) key file by default — no permission prompts, ever. Flip **"Guard the encryption key with the OS keychain"** to move it into the **macOS Keychain / Windows Credential Manager / Secret Service** (saved connections keep working). If the keychain becomes unreachable, Ognom falls back to the key file and **tells you so in the UI** — no silent downgrades.
- The UI never receives stored secrets back; editing a connection keeps the stored password unless you type a new one.
- The webview runs with a strict Content-Security-Policy and no remote content — Monaco and every asset are bundled locally, so the core app works fully offline.
- Your queries go to **your** MongoDB server. Studio's AI prompts go only to **your** configured AI provider (OpenAI) using **your** key.

---

## 🔌 Connect to anything

Standard & `mongodb+srv`, replica sets, all SCRAM mechanisms, X.509, LDAP, TLS with custom CA / client certificates, read preferences, timeouts — all under *Advanced*. Or just paste a connection string.

---

## 📚 More

- **Shell syntax** → [MONGODB_SHELL_SYNTAX.md](MONGODB_SHELL_SYNTAX.md) — everything the embedded shell understands.
- **Releasing** → [RELEASING.md](RELEASING.md) — how builds are signed and shipped.

---

## License

[MIT](LICENSE) — free for everyone, forever.

<p align="center"><sub>Built with Rust 🦀, Tauri, and React. Made for the people who query — and the people who just need answers.</sub></p>
