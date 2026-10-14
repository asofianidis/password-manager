# Password Manager

A local-first password manager built with Electron, React, TanStack Router, TanStack Query,
and Tailwind CSS. Your vault is encrypted on disk and never leaves your devices.
Sync is peer-to-peer (ideally over Tailscale) with no cloud server.

## Features

- **Encrypted vault**: Argon2id + AES-256-GCM, unlocked with a master password. It auto-locks
  after inactivity, on sleep, and on screen lock.
- **Dashboard**: a health score plus counts of weak (zxcvbn), reused, and old passwords.
- **Passwords**: search, filter (favorites/weak/reused/old), add/edit/delete, and copy to the
  clipboard with auto-clear.
- **Generator**: random characters or EFF-diceware passphrases, with a strength estimate.
- **Import**: Dashlane (CSV or ZIP), Chrome/Edge/Brave, Firefox, Safari/Apple Passwords,
  Bitwarden (CSV/JSON), 1Password (CSV/1PUX), LastPass, KeePass/KeePassXC, Proton Pass, and
  generic CSV. The format is auto-detected and duplicates are skipped.
- **Export**: an encrypted backup (`.pmbackup`), CSV, or JSON.
- **Sync**: pair devices with a 6-digit code, then sync directly. All sync messages are
  end-to-end encrypted with the vault key.

## Keyboard shortcuts

| Shortcut       | Action                                  |
| -------------- | --------------------------------------- |
| ⌘K / ⌘P        | Go to password (command palette)        |
| ⌘⇧P            | Show all commands                       |
| ⌘N             | New password                            |
| ⌘E             | Edit the open password                  |
| ⌘S / Esc       | Save / cancel while editing             |
| ⌘L             | Lock vault                              |
| ⌘⇧E ⌘⇧M ⌘⇧G ⌘, | Explorer, Problems, Generator, Settings |

In the palette, ⌘↵ on a password copies it instead of opening it.

## Development

```bash
npm install
npm run dev        # run the app with HMR
npm test           # unit + two-device sync integration tests
npm run typecheck
npm run lint
npm run build:mac  # or build:win / build:linux
```

## CI and releases

`.github/workflows/build.yml` lints, typechecks, and tests every push and pull request. It then
packages the app on native runners:

| Platform | Artifacts                           |
| -------- | ----------------------------------- |
| macOS    | `.dmg` and `.zip` for x64 and arm64 |
| Windows  | NSIS installer `.exe` (x64)         |
| Linux    | `.AppImage` and `.deb` (x64)        |

Download the builds from the run's **Artifacts** section. To publish a release, push a version tag:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

The version in the tag is stamped into the app, and a **draft** GitHub release is created with every
installer attached. Review it, then publish.

Builds are **unsigned**. macOS will say the app is from an unidentified developer (right-click →
Open), and Windows SmartScreen will warn on first launch. To sign, add electron-builder's signing
secrets (`CSC_LINK`/`CSC_KEY_PASSWORD`, plus `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`
for notarization), pass them to the package step, and remove `CSC_IDENTITY_AUTO_DISCOVERY: false`.

## Layout

```
src/
  main/           Electron main process: all crypto, storage, and sync live here
    vault/        Vault file, key wrapping, AES-GCM/Argon2id
    sync/         Peer-to-peer HTTP sync server/client, Tailscale discovery
  preload/        Exposes a typed, allow-listed `window.api` to the renderer
  renderer/       React UI (TanStack Router file routes in src/routes)
  shared/         Types, IPC contract, CSV/importers, sync merge (pure, portable)
docs/             Vault format and sync protocol for other clients (Android)
test/             Vitest suites
```

The renderer never holds the vault key. It receives entry summaries for lists and fetches
an entry's secrets only when it is opened.

## Building the Android app

See [docs/VAULT_FORMAT.md](docs/VAULT_FORMAT.md) and
[docs/SYNC_PROTOCOL.md](docs/SYNC_PROTOCOL.md). The logic in `src/shared/` is plain
TypeScript with no Node or Electron dependencies, so a React Native app can reuse the
importers and merge logic directly.
