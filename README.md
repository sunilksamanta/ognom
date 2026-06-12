<p align="center">
  <img src="public/icon.svg" width="96" alt="Ognom" />
</p>

<h1 align="center">Ognom</h1>

<p align="center"><b>The free, no-nonsense MongoDB client.</b></p>

<p align="center">
  MongoDB GUIs are either expensive, bloated, or both. Ognom is neither:
  a native desktop app that opens fast, stays light, and does the things
  you actually do all day — browse, query, aggregate, edit.
</p>

---

## Why Ognom

- **Free & open source.** No license keys, no locked "premium" tabs, no account, no telemetry.
- **Lightweight.** Built with Tauri (Rust + your OS webview) — a tiny binary and a fraction of the memory an Electron app burns.
- **Secure by default, frictionless by default.** Connection credentials are encrypted at rest with AES-256-GCM. The encryption key lives in a private local key file (`0600`) — zero prompts on every platform — and one toggle moves it into the **macOS Keychain / Windows Credential Manager / Secret Service** for extra hardening. Passwords are never sent back to the UI after saving.
- **For developers *and* managers.** Connecting takes host + user + password. Reading data takes zero query knowledge. The sharp tools are there — behind one *Advanced* toggle.

## What it does

| | |
|---|---|
| **Browse** | Databases & collections sidebar with sizes, search filter, and a ⌘K jump-to-collection palette. |
| **Two views, done well** | Documents render as **JSON** (collapsible, type-colored, ObjectId/date aware) or a **table** (typed cells, sticky `_id`). That's it — no chart-builder bloat. |
| **Query** | Filter/sort/projection bar with shell syntax — `{ age: { $gte: 21 }, _id: ObjectId("…") }` — pagination, counts, and execution time. |
| **Edit** | Insert, edit, duplicate, and delete documents in a Monaco editor with mongosh-style syntax and JSON5 comfort (unquoted keys, single quotes, comments). |
| **Aggregate** | A stage-by-stage pipeline builder: enable/disable stages, reorder, run-to-stage previews, copy the pipeline as shell syntax, or eject it into the shell. |
| **Shell** *(advanced)* | A real query editor: `db.students.find({}).sort({ gpa: -1 }).limit(5)` with proper highlighting for `db`, collection names, methods, and `$operators`. Supports find/aggregate/insert/update/delete/distinct/indexes, `show dbs`, `use`, `db.runCommand`, and helpers like `ObjectId()`, `ISODate()`, `NumberLong()`. |
| **Indexes** | List, create (unique/TTL), and drop indexes; collection storage stats. |
| **Connect to anything** | Standard & `mongodb+srv`, replica sets, all SCRAM mechanisms, X.509, LDAP, TLS with custom CA / client certificates, read preferences, timeouts — all under *Advanced*. Or just paste a connection string. |

## Install

Grab the build for your OS from the [latest release](https://github.com/sunilksamanta/ognom/releases/latest) — macOS (Apple Silicon & Intel), Windows, and Linux (AppImage/deb/rpm). Installed apps **update themselves** from GitHub releases (signature-verified); see [RELEASING.md](RELEASING.md) for how releases are cut.

## Build from source

Prerequisites: [Rust](https://rustup.rs), Node 20+, and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```bash
npm install
npm run tauri dev      # run in development
npm run tauri build    # produce a signed-ready bundle for your OS
```

## Security model

- Connection profiles live in your OS app-data directory as JSON; **secrets (passwords or pasted URIs) are AES-256-GCM encrypted**.
- The 256-bit master key is generated on first run and stored in a private (`0600`) key file by default — no permission prompts, ever. Flip **“Guard the encryption key with the OS keychain”** in the connection manager to move the key into the macOS Keychain / Windows Credential Manager / Secret Service instead (the key itself is unchanged, so saved connections keep working). If the keychain stops being reachable, Ognom falls back to the key file **and tells you so in the UI** — no silent downgrades.
- The UI never receives stored secrets back; editing a connection keeps the stored password unless you type a new one.
- The webview runs with a strict Content-Security-Policy and no remote content — Monaco and every asset are bundled locally, so Ognom works fully offline.
- Queries you run are sent to *your* MongoDB server and nowhere else.

## Shell syntax

See [MONGODB_SHELL_SYNTAX.md](MONGODB_SHELL_SYNTAX.md) for everything the embedded shell understands.

## License

[MIT](LICENSE) — free for everyone, forever.
