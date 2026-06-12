# Releasing Ognom

Releases are fully automated: **push to the `production` branch** and GitHub
Actions builds macOS (Apple Silicon + Intel), Windows, and Linux bundles,
creates a `v<version>` GitHub release, and publishes the signed updater
manifest (`latest.json`) that running apps poll for self-updates.

## One-time setup (repo secrets)

The updater artifacts must be signed. The keypair was generated locally with
`tauri signer generate` (with a password — GitHub cannot store an empty
secret, so passwordless keys do not work in CI):

- **Private key**: `~/.tauri/ognom.key` *(on the machine that generated it — never commit this file)*
- **Key password**: `~/.tauri/ognom.key.password`
- **Public key**: already embedded in `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`

Add two secrets under **GitHub repo → Settings → Secrets and variables →
Actions**:

| Secret | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | The full contents of `~/.tauri/ognom.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The contents of `~/.tauri/ognom.key.password` |

```bash
# convenient way to add them with the GitHub CLI
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/ognom.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD < ~/.tauri/ognom.key.password
```

> ⚠️ Back up both the private key **and its password** somewhere safe
> (password manager). If either is lost, existing installs can no longer
> verify updates — you'd have to ship a new pubkey and users would need to
> reinstall manually once.

## Cutting a release

1. Bump the version in **`src-tauri/tauri.conf.json`** (this is the version
   the release tag uses), and keep `package.json` + `src-tauri/Cargo.toml`
   in sync.
2. Merge / push to `production`:

   ```bash
   git checkout production || git checkout -b production
   git merge main
   git push origin production
   ```

3. The **Release** workflow runs tests first, then builds all four targets
   and publishes the release. Existing installs see the update on next
   launch (or via *Settings → Check for updates…*) and self-update from the
   GitHub release.

## How the updater works

- `createUpdaterArtifacts` makes the bundler emit update packages plus
  `.sig` files signed with your private key.
- `tauri-apps/tauri-action` aggregates them into `latest.json` on the
  release.
- The app checks
  `https://github.com/sunilksamanta/ognom/releases/latest/download/latest.json`
  on startup (production builds only), verifies the signature against the
  embedded pubkey, downloads, installs, and relaunches.

## Local release builds

`createUpdaterArtifacts` means even local `tauri build` runs want the signing
key. Either export it:

```bash
TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.tauri/ognom.key) \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD=$(cat ~/.tauri/ognom.key.password) \
npm run tauri build
```

…or temporarily set `"createUpdaterArtifacts": false` if you just need an
unsigned local bundle to test.

## Notes

- Builds are unsigned by Apple/Microsoft (fine for an OSS tool; macOS users
  may need right-click → Open on first launch). Apple notarization can be
  added later by setting the `APPLE_*` secrets and uncommenting nothing —
  tauri-action picks them up automatically when present.
- Manual run: the workflow also has a `workflow_dispatch` trigger, so you can
  fire it from the Actions tab without pushing.
