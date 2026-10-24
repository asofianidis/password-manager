# Password Manager

A local-first password manager built with Electron, React, TanStack Router, TanStack Query,
and Tailwind CSS. Your vault is encrypted on disk and never leaves your devices.
Sync is peer-to-peer (ideally over Tailscale) with no cloud server.

## Install

### macOS

Download the `.dmg` for your Mac from the
[latest release](https://github.com/asofianidis/password-manager/releases/latest) (`arm64` for
Apple Silicon, `x64` for Intel), open it, and drag Password Manager to Applications. Releases are
signed with a Developer ID and notarized by Apple, so the app opens like any other.

Or install from the Terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/asofianidis/password-manager/main/scripts/install-mac.sh | bash
```

It downloads the right build for your Mac, checks it against the release's `SHA256SUMS.txt`,
refuses an app that isn't signed with this project's Developer ID (team `YLGZDPWZ2X`) and
notarized, then quits the app if it's running, replaces `/Applications/Password Manager.app`, and
opens it. From a clone of this repo, `bash scripts/install-mac.sh` does the same.

After that the app updates itself: when a new version is out, an update button appears in the
bottom-left corner. Your vault and settings live in
`~/Library/Application Support/password-manager`, so updating never touches them.

**Upgrading from 1.0.19 or earlier:** those versions weren't signed with a Developer ID, so they
can't install a signed update; their update button opens the release page instead. Install the
new version once by hand, with the `.dmg` or the command above. Updates after that install in
place. macOS may ask again for Local Network access.

To keep a copy of your vault before an update:

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

### Android

Download `password-manager-<version>.apk` from the
[releases](https://github.com/asofianidis/password-manager/releases) and open it on your phone
(allow your browser to install apps when asked). Then see [Android app](#android-app). After that
the app updates itself.

### iPhone and iPad

There's no download: build it with Xcode on a Mac and run it on your device. See
[iPhone and iPad app](#iphone-and-ipad-app).

## Features

- **Encrypted vault**: Argon2id + AES-256-GCM, unlocked with a master password. It auto-locks
  after inactivity, on sleep, and on screen lock.
- **Dashboard**: a health score plus counts of weak (zxcvbn), reused, and old passwords.
- **Passwords**: search, filter (favorites/weak/reused/old), add/edit/delete, and copy to the
  clipboard with auto-clear.
- **Cards, photo IDs, notes, and documents**: save payment cards, passports and other IDs (with
  photos of them), secure notes, and documents. Any item can have files attached (up to 10 MB
  each); they're encrypted and sync between your devices like everything else.
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
- **Android app**: fills logins in apps and browsers, including from the keyboard's suggestion
  strip (see [Android app](#android-app)).
- **iPhone and iPad app**: fills logins in Safari and apps through iOS AutoFill (see
  [iPhone and iPad app](#iphone-and-ipad-app)).

## Browser extension

The extension in `extension/` adds a **Password Manager** submenu when you right-click an input
field. It lists the saved logins that match the site; picking one fills the username and password.

The same menu has **Notes, cards & IDs**, which works on any site. Pick an item, then either:

- **Fill matching fields**: fills every field in the form whose label, name, or `autocomplete`
  attribute matches one of the item's fields (e.g. "Postal code" fills a `zip` field, and a card's
  expiry fills separate month and year fields).
- **Insert *field***: puts that one value into the field you right-clicked.

A note's fields are its lines of the form `Label: value`, for example:

```
Street: 1 Main St
City: Springfield
Postal code: 90210
Phone: 555-0100
```

A note without such lines can still be inserted whole. Cards offer the cardholder, number, expiry,
and security code (never the PIN), and IDs their name, number, and dates. Only labels appear in
the menu; values are fetched from the app when you pick one.

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
addons.mozilla.org using the `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` secrets of the `release`
environment.

Open the desktop app at least once afterwards: on each launch it registers its native messaging
host with every browser it finds. Then right-click a login field and choose **Password Manager →
Connect**; the app asks you to approve the browser. Connected browsers are listed under
**Settings → Browser**, where you can revoke them.

How it works:

- The browser starts the native messaging host (`src/main/browser/native-host.ts`), which is the
  app's own binary run in Node mode. It relays messages to the running app over a Unix socket in
  the app data folder (a named pipe on Windows), so no network port is opened.
- Only the extension's IDs may start the host. The Chrome Web Store assigns its own; unpacked
  installs get the one pinned by the `key` in the manifest, so it is the same for every unpacked
  install. The store build (`extension/dist/chrome-store`) leaves the `key` out, as the store
  requires.
- Each approved browser gets a random token; the app stores only its SHA-256 hash.
- The extension only receives titles and usernames for the menu. A password is sent only when you
  pick a login, and only if that login's domain matches the frame being filled (subdomains of the
  saved domain count, unless it is a public suffix such as `github.io`). A login saved as https is
  never filled into a plain http page.
- The URL check guards against extension bugs, not against other programs: the page URL comes
  from the caller, and the approval prompt can't tell which program is asking. Any program running
  as your user that you approve, or that steals a token, can request any login. As with the vault
  file itself, programs running as your user are trusted.
- Nothing is filled while the vault is locked; the menu offers to open the app instead.
- Browsers installed as Snap or Flatpak packages on Linux can't run native messaging hosts.

## Android app

The app in `android/` (Kotlin, Jetpack Compose) holds a copy of the same vault and syncs it with
your computers. It can't create a vault: you pair it with the desktop app, which keeps the vault
key.

**Setup.** On the computer, open **Sync** and click **Pair a new device** (this also turns on
listening for the 5-minute window). On the phone, enter one of the addresses it shows, the port,
the 6-digit code, and your master password. The phone has to reach the computer: the same Wi-Fi,
or Tailscale on both (use the `100.x.y.z` address or MagicDNS name). To keep syncing afterwards,
turn on **Accept sync connections** on the computer.

**Cards, IDs, notes, and documents** work on the phone too, attached files included; files added
on one device are fetched by the others when they sync. Update the phone along with your
computers: Android app versions from before these items existed drop their details when they save
the vault.

**Autofill.** Under **Settings → Autofill**, tap **Turn on autofill** and pick Password Manager.
That one setting covers both apps and browsers; there is no keyboard to install.

- Tapping a login field shows matching logins in the autofill dropdown, or, on Android 11+ with a
  keyboard that supports it (Gboard, Samsung Keyboard), in the keyboard's suggestion strip. When
  the vault is locked it offers **Unlock to fill**, and fills straight away if one login matches.
- **Search vault…** picks any login. Filling one that wasn't saved for that site or app asks for
  confirmation first. For apps, you can have it offered there from then on (kept on the phone).
- Typing a new login offers to save it; changing a saved password offers to update it.
- **Chrome** (135+) needs **Settings → Autofill services → Autofill using another service**, then
  a restart. Firefox uses the autofill service directly; other browsers vary.

**Which logins match.** Websites use the same rules as the browser extension (same host, or a
subdomain of it unless it's a public suffix; an https login never fills a plain http page). The
page's domain is only trusted from known browsers: any app can claim any domain, so a login form
in another app (or its WebView) only gets logins saved for that app (`androidapp://<package>`, the
URL the app saves them under) or ones you chose for it before.

**Locking.** Unlock with the master password or, after turning it on, a fingerprint or face. The
vault key is then sealed by an Android Keystore key that needs a strong biometric and is destroyed
when a new one is enrolled. The vault locks after inactivity (5 minutes by default), optionally
when the screen turns off, and whenever Android stops the app. The app is excluded from
screenshots and backups, and from other autofill services, so they can't save your master password.

**Sync.** The phone is a client only: it syncs with every computer you added when you unlock it,
shortly after each change, and from the sync button. A master password change or device revoke on
a computer reaches the phone on its next sync; it then asks for the new master password.

**Updates.** The app checks the GitHub releases every 6 hours and when opened (at most hourly), and
offers a newer version in the vault list and under **Settings → Updates**. Installing needs a
one-time **Allow installs** (Android's _Install unknown apps_ for this app). With **Install updates
automatically** on, it installs in the background while the app is closed and the vault is locked;
on Android 12+ that happens without a prompt, and older versions ask for each one. Otherwise it
posts a notification. Before installing, the app checks the APK's SHA-256 against the release, and
that it's this app, the advertised version, and signed with the same key (Android checks the key
again). Debug builds don't update themselves.

### Building

Open `android/` in Android Studio, or with JDK 17 and the Android SDK:

```bash
cd android
./gradlew :app:testDebugUnitTest   # unit tests, including checks against the desktop's own output
./gradlew :app:assembleDebug       # app/build/outputs/apk/debug/app-debug.apk
```

The debug build installs as `com.asofianidis.passwordmanager.debug`, next to a release install.
`app/src/test/resources/interop.json` is written by the desktop code; after changing the vault
format, the merge rule, or URL matching, regenerate it with
`npx vitest run --config android/scripts/vitest.config.ts fixtures`. To try pairing and sync
against a real desktop without the GUI, run
`npx vitest run --config android/scripts/vitest.config.ts desktop-peer`. It serves a demo vault on
port 47999 (from an emulator, the computer is `10.0.2.2`) and writes the pairing code to
`pm-desktop-peer.log` in the temp folder.

## iPhone and iPad app

The app in `ios/` (Swift, SwiftUI) does what the Android app does: it holds a copy of the vault,
pairs with the desktop app (it can't create a vault), and syncs as a client. Logins, cards, photo
IDs, notes, and documents work, attached files included. On iPad the vault list and the open item
sit side by side.

**Setup** is the same as on Android: on the computer, open **Sync** and click **Pair a new
device**; on the iPhone or iPad, enter an address it shows, the port, the 6-digit code, and your
master password. The first sync asks to find devices on your local network; allow it (or turn on
Password Manager later under **Settings → Privacy & Security → Local Network**). Over Tailscale,
use the `100.x.y.z` address or MagicDNS name.

**AutoFill.** Under **Settings → AutoFill** in the app, tap **Turn on AutoFill** (or open
**Settings → General → AutoFill & Passwords** and turn on Password Manager).

- Tapping the key icon above the keyboard in Safari or an app opens Password Manager: unlock, then
  pick one of the logins saved for that site, or search the vault. Filling a login that isn't saved
  for the site asks first. Websites match by the same rules as the browser extension.
- With **Suggest logins above the keyboard** on (the default), iOS shows matching usernames in the
  QuickType bar. iOS gets each login's site and username, never its password; picking one still
  unlocks the vault first.
- Unlock AutoFill with Face ID or Touch ID when you can. Unlocking with the master password runs
  Argon2 with 64 MiB of memory inside the extension, which iOS limits; it works on current devices,
  but Face ID is faster.

**Locking.** Unlock with the master password or, after turning it on, Face ID or Touch ID. The
vault key is then stored in the keychain under an access control that needs the current biometric
enrollment, so adding a face or fingerprint turns it off. The vault locks after inactivity (5
minutes by default) and optionally when you leave the app; the app switcher shows a cover instead
of the vault. The vault file is unreadable while the device is locked and isn't backed up. Copied
passwords stay on the device (no Universal Clipboard) and expire after 30 seconds by default.

**Sync** works as on Android: on unlock, shortly after each change, and when you pull to refresh
or tap the sync button. A master password change on a computer reaches the device on its next sync;
it then asks for the new master password.

### Building

You need a Mac with Xcode 16 or later, and [XcodeGen](https://github.com/yonaskolb/XcodeGen),
which writes the Xcode project from `ios/project.yml`:

```bash
brew install xcodegen
cd ios
xcodegen               # writes PasswordManager.xcodeproj
open PasswordManager.xcodeproj
```

In `ios/project.yml`, set `DEVELOPMENT_TEAM` to your team ID, and `PM_BUNDLE_ID` to a bundle ID
your team can register (the default belongs to this repo's owner). Run `xcodegen` again after
changing it. A free Apple ID works but its builds expire after 7 days; a paid developer account's
last a year. Then pick your iPhone or iPad and press Run. The app group and keychain group the app
shares with the AutoFill extension are set up from `PM_BUNDLE_ID` when Xcode signs it.

The vault, crypto, sync, and URL matching are a Swift package in `ios/Core` with no UIKit
dependency, so its tests run on macOS or Linux:

```bash
cd ios/Core
swift test     # includes the checks against the desktop's own output, shared with Android
```

On a machine without Swift, Docker works:
`docker run --rm -v "$PWD:/src" -w /src/ios/Core swift:6.0-jammy swift test` from the repo root.
To try pairing and sync against a real desktop, start the headless peer described under
[Android app → Building](#building), then run
`PM_PEER_HOST=127.0.0.1 PM_PEER_CODE=<code> swift test --filter LivePeerTests` (from Docker, use
`host.docker.internal`).

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

Without a Developer ID certificate in your keychain, sign a local Mac build ad hoc so macOS
doesn't report it as damaged: `npm run build:mac -- -c.mac.identity=- -c.mac.hardenedRuntime=false`.

## CI and releases

`.github/workflows/build.yml` lints, typechecks, and tests every push and pull request. It then
builds only what the changed files affect:

- **Desktop app** (`src/`, `build/`, `resources/`, build config): packaged on native runners.
- **Browser extension** (`extension/`, its build scripts, `src/shared/browser-protocol.ts`):
  built, and on releases the Firefox add-on signed by Mozilla and the `extension-latest` update
  feed refreshed. Every desktop build also bundles the current extension.
- **Android app** (`android/`): unit tests, then an APK. Releases need the signing secrets below.
- **iOS app** (`ios/`): the core package's tests on macOS, then an unsigned build of the app and
  its AutoFill extension. Nothing is released; you build it yourself from Xcode.
- `package.json`, `package-lock.json`, and the workflow itself rebuild both. Tag pushes, manual
  runs, and new branches also build both. Changes elsewhere (docs, tests) only run the checks.

| Platform          | Artifacts                                                                  |
| ----------------- | -------------------------------------------------------------------------- |
| macOS             | `.dmg` and `.zip` for x64 and arm64                                        |
| Windows           | NSIS installer `.exe` (x64)                                                |
| Linux             | `.AppImage` and `.deb` (x64)                                               |
| Browser extension | Chromium `.zip` (unpacked and Web Store builds), Firefox `.xpi` and `.zip` |
| Android           | `.apk`                                                                     |

Download the builds from the run's **Artifacts** section. Every push to `main` that changes the app
or the extension publishes a GitHub release once the maintainer approves the run: the version is `package.json`'s if it's ahead of the
latest tag, otherwise the latest tag with the patch bumped. Pushing a `v*` tag releases that
version. A release without desktop changes is titled "(browser extension)", "(Android)", or both, and not
marked **Latest**, so the app's updater and the install script keep using the last desktop
release.
Releases that include a Mac build start their notes with the [macOS install](#macos) section of
this README, followed by the generated changelog.

Each release also carries the `latest*.yml` update feeds. Installed apps check GitHub releases on
launch and every 4 hours (or via **Check for Updates** in the command palette). When a newer
version exists, an update button appears in the bottom-left corner. On Windows and Linux it
downloads the update and then offers to restart and install it. On macOS, Squirrel.Mac only
installs an update signed by the same Developer ID as the running app, so ad-hoc signed builds
(1.0.19 and earlier, or your own builds) open the release page instead.

macOS releases are signed with a Developer ID and notarized: electron-builder notarizes and
staples the apps, and the workflow then notarizes and staples the `.dmg` files. Pull request and
fork builds have no access to the signing secrets and produce ad-hoc signed apps. Windows builds
aren't code signed yet, so SmartScreen warns on first launch.

Releases wait for the maintainer's approval in the protected `release` environment, are
published only once every file is uploaded, and carry `SHA256SUMS.txt` and build-provenance
attestations. [docs/RELEASING.md](docs/RELEASING.md) covers the approval step, the secrets, and
signing. See [SECURITY.md](SECURITY.md) to report a vulnerability.

Android only installs an update signed with the same key as the installed app. Create a keystore
once (`keytool -genkeypair -v -keystore release.jks -keyalg RSA -keysize 4096 -validity 10000 -alias pm`),
keep it safe, and add the `release` environment secrets `ANDROID_KEYSTORE_BASE64`
(`base64 -w0 release.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and
`ANDROID_KEY_PASSWORD` if it differs from the keystore password. Only release runs use them. Other
builds, and releases without them, get a debug APK signed with a throwaway key, which can't
update an earlier install.

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
ios/              iPhone and iPad app (Swift, SwiftUI); project.yml generates the Xcode project
  Core/           Swift package: vault and crypto, merge, sync client, URL matching (no UIKit)
  App/            The app's SwiftUI screens
  AutoFill/       AutoFill credential provider extension
  Shared/         Code both use: settings, biometric unlock, the unlock form
android/          Android app (Kotlin, Compose)
  app/src/main/java/com/asofianidis/passwordmanager/
    vault/        Vault file and crypto, a port of src/main/vault
    sync/         Sync client (the phone never listens)
    match/        Which logins belong to a site or app
    autofill/     Android autofill service and its unlock/pick/save screen
    ui/           Compose screens
  scripts/        Desktop-side helpers: interop fixtures and a headless sync peer
docs/             Vault format and sync protocol for other clients
test/             Vitest suites
```

The renderer never holds the vault key. It receives entry summaries for lists and fetches
an entry's secrets only when it is opened.

## Other clients

[docs/VAULT_FORMAT.md](docs/VAULT_FORMAT.md) and [docs/SYNC_PROTOCOL.md](docs/SYNC_PROTOCOL.md)
describe everything another client needs; the Android and iOS apps are two.
