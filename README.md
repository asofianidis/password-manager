# Password Manager

A local-first password manager built with Electron, React, TanStack Router, TanStack Query,
and Tailwind CSS. Your vault is encrypted on disk and never leaves your devices.
Sync is peer-to-peer (ideally over Tailscale) with no cloud server.

## Install

### macOS

Install or update to the latest release with one command:

```bash
curl -fsSL https://raw.githubusercontent.com/asofianidis/password-manager/main/scripts/install-mac.sh | bash
```

Run the same command again to update. It downloads the right build for your Mac (Apple Silicon
or Intel), quits the app if it's running, replaces `/Applications/Password Manager.app`, and
opens it. Your vault and settings live in `~/Library/Application Support/password-manager`, so
updating never touches them.

From a clone of this repo, the same script works without `curl`:

```bash
bash scripts/install-mac.sh
```

The script downloads with `curl`, which doesn't mark the app as quarantined, so Gatekeeper
doesn't block it even though builds aren't notarized. To keep a copy of your vault before an
update:

```bash
cp ~/Library/Application\ Support/password-manager/vault.json ~/vault-backup.json
```

The first time you sync, macOS asks to let Password Manager find devices on your local network;
click **Allow**. If sync fails with `EHOSTUNREACH`, turn Password Manager on in **System Settings
→ Privacy & Security → Local Network**.

### Windows and Linux

Download the installer (`.exe`), `.AppImage`, or `.deb` from the
[latest release](https://github.com/asofianidis/password-manager/releases/latest). Installed apps
offer updates themselves; see [CI and releases](#ci-and-releases).

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
- **Browser fill**: right-click a login field in Chrome, Edge, Brave, Arc, Vivaldi, or Firefox
  and pick a saved login to fill it (see [Browser extension](#browser-extension)).
- **Runs in the background**: on Windows and macOS, closing the window keeps the app running in
  the system tray / menu bar so the browser can still fill logins. Quit from the tray icon's menu
  (or Cmd+Q on macOS).
- **Sync**: pair devices with a 6-digit code, then sync directly. All sync messages are
  end-to-end encrypted with the vault key.

## Browser extension

The extension in `extension/` adds a **Password Manager** submenu when you right-click an input
field. It lists the saved logins that match the site; picking one fills the username and password.

- **Chrome, Edge, Brave, Arc, Vivaldi**: in the app, open **Settings → Browser** and click **Open
  folder**. In the browser, open `chrome://extensions`, turn on Developer mode, click **Load
  unpacked**, and pick that folder. Chrome only installs `.crx` files from the Chrome Web Store, so
  there is no installer to download.
- **Firefox**: install the Mozilla-signed
  [add-on](https://github.com/asofianidis/password-manager/releases/download/extension-latest/password-manager-extension-firefox.xpi)
  (the link on **Settings → Browser** goes to the same file).

**Updates.** Chrome doesn't update unpacked extensions, so the app does: the folder starts with the
copy bundled in the app, and the app checks GitHub every 4 hours (or on **Check for updates**) for
a newer one. It downloads it, checks its SHA-256, and swaps the folder; the extension then sees the
newer version on disk and reloads itself. If it ever doesn't, click the reload icon on the
extension's card in `chrome://extensions`. Firefox updates the signed add-on itself through its
`update_url`.

Both read the `extension-latest` release, a pre-release that CI updates whenever the extension is
released. It holds `extension.json` (version, Chromium zip URL, and hash, read by the app),
`updates.json` (Firefox's update manifest), and fixed-name copies of the latest zip and `.xpi`.
Being a pre-release, it never becomes the **Latest** release the app's own updater reads.

For development, `npm run build:extension` writes `extension/dist/chrome` and
`extension/dist/firefox`; load the first unpacked, or the second as a temporary add-on from
`about:debugging#/runtime/this-firefox`. CI signs the Firefox add-on as unlisted on
addons.mozilla.org using the `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` repository secrets.

Open the desktop app at least once afterwards: on each launch it registers its native messaging
host with every browser it finds. Then right-click a login field and choose **Password Manager →
Connect**; the app asks you to approve the browser. Connected browsers are listed under
**Settings → Browser**, where you can revoke them.

How it works:

- The browser starts the native messaging host (`src/main/browser/native-host.ts`), which is the
  app's own binary run in Node mode. It relays messages to the running app over a Unix socket in
  the app data folder (a named pipe on Windows), so no network port is opened.
- Only the extension's ID may start the host. The Chrome ID is pinned by the `key` in the manifest
  so it is the same for every unpacked install.
- Each approved browser gets a random token; the app stores only its SHA-256 hash.
- The extension only receives titles and usernames for the menu. A password is sent only when you
  pick a login, and only if that login's domain matches the frame being filled (subdomains of the
  saved domain count). A login saved as https is never filled into a plain http page.
- Nothing is filled while the vault is locked; the menu offers to open the app instead.
- Browsers installed as Snap or Flatpak packages on Linux can't run native messaging hosts.

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
builds only what the changed files affect:

- **Desktop app** (`src/`, `build/`, `resources/`, build config): packaged on native runners.
- **Browser extension** (`extension/`, its build scripts, `src/shared/browser-protocol.ts`):
  built, and on releases the Firefox add-on signed by Mozilla and the `extension-latest` update
  feed refreshed. Every desktop build also bundles the current extension.
- `package.json`, `package-lock.json`, and the workflow itself rebuild both. Tag pushes, manual
  runs, and new branches also build both. Changes elsewhere (docs, tests) only run the checks.

| Platform          | Artifacts                                  |
| ----------------- | ------------------------------------------ |
| macOS             | `.dmg` and `.zip` for x64 and arm64        |
| Windows           | NSIS installer `.exe` (x64)                |
| Linux             | `.AppImage` and `.deb` (x64)               |
| Browser extension | Chromium `.zip`, Firefox `.xpi` and `.zip` |

Download the builds from the run's **Artifacts** section. Every push to `main` that changes the app
or the extension publishes a GitHub release: the version is `package.json`'s if it's ahead of the
latest tag, otherwise the latest tag with the patch bumped. Pushing a `v*` tag releases that
version. A release that only changed the extension is titled "(browser extension)" and not marked
**Latest**, so the app's updater and the install script keep using the last desktop release.

Each release also carries the `latest*.yml` update feeds. Installed apps check GitHub releases on
launch and every 4 hours (or via **Check for Updates** in the command palette). When a newer
version exists, an update button appears in the bottom-left corner. On Windows and Linux it
downloads the update and then offers to restart and install it. On macOS, Squirrel.Mac only
installs signed builds, so the button opens the release page until signing is set up.

Builds are **not notarized**. On macOS the easiest way to install is the one-line script under
[Install](#macos).

If you download the `.dmg` in a browser instead, the app is ad-hoc signed, so on first launch macOS
will say it can't verify the developer: open **System Settings → Privacy & Security** and click
**Open Anyway** (or run `xattr -dr com.apple.quarantine "/Applications/Password Manager.app"`).
Windows SmartScreen
will also warn on first launch. To sign properly, add electron-builder's signing secrets
(`CSC_LINK`/`CSC_KEY_PASSWORD`, plus `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` for
notarization), pass them to the package step, remove `CSC_IDENTITY_AUTO_DISCOVERY: false`, and drop
`identity: '-'` from `electron-builder.yml`.

## Layout

```
src/
  main/           Electron main process: all crypto, storage, and sync live here
    vault/        Vault file, key wrapping, AES-GCM/Argon2id
    sync/         Peer-to-peer HTTP sync server/client, Tailscale discovery
    browser/      Browser extension bridge: native messaging host, socket server, host registration
  preload/        Exposes a typed, allow-listed `window.api` to the renderer
  renderer/       React UI (TanStack Router file routes in src/routes)
  shared/         Types, IPC contract, CSV/importers, sync merge (pure, portable)
extension/        Browser extension (Chrome-family and Firefox), built by scripts/build-extension.mjs
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
