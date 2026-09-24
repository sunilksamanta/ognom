# Contributing to Ognom

Thanks for helping. Bug reports, feature ideas and pull requests are all welcome.

## Before you start

- **Bugs:** open an [issue](https://github.com/sunilksamanta/ognom/issues/new/choose) with the bug template. Your OS, Ognom version and MongoDB version make it much faster to fix.
- **Ideas and questions:** start a [discussion](https://github.com/sunilksamanta/ognom/discussions). Issues are kept for bugs and agreed work.
- **Security problems:** don't open a public issue. See [SECURITY.md](SECURITY.md).
- **Bigger changes:** open an issue or discussion first so we can agree on the approach before you spend time on it.

## Set up

You need [Rust](https://rustup.rs), Node.js 20+ and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```bash
git clone https://github.com/sunilksamanta/ognom.git
cd ognom
npm install
npm run tauri dev
```

For UI work you can skip the desktop shell: `npm run dev` runs the interface in a browser against an in-memory mock of the backend (`src/dev/mockTauri.ts`). When you add a backend command, add a matching case to the mock so the UI keeps working there.

## Where things live

| Path | What |
|---|---|
| `src/components/` | React UI: rail, picker, canvas, dock, drawer, dialogs |
| `src/stores/` | zustand stores |
| `src/lib/` | API client (`api.ts`), BSON helpers, type generator, Monaco setup |
| `src/styles/` | theme kit and app styles |
| `src-tauri/src/commands.rs` | Tauri commands |
| `src-tauri/src/` | profiles, crypto, SSH, shell parser, schema inference |

## Guidelines

- **Match the surrounding code.** Naming, comment density and structure should look like the file you're editing.
- **Use design tokens, never literal colours.** Components read `--bg`, `--panel`, `--accent` and friends from `src/styles/theme-kit.css`, so every theme keeps working.
- **Keep writes safe.** Anything that changes data must respect read-only and production workspaces (the backend write guard) and confirm destructive actions.
- **No em dashes.** Use a plain hyphen, comma or colon in code, comments, UI text and docs.
- **No AI or LLM features.** Ognom is a focused MongoDB client.

## Before you open a pull request

```bash
npm run typecheck
npm test                       # frontend tests (Vitest)
cd src-tauri && cargo test     # backend tests
```

- Keep each PR to one change, and explain what and why in the description.
- Add or update tests for logic changes.
- Include a screenshot for UI changes.
- CI runs the same checks on every PR.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
