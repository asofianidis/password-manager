# Releasing

Releases are built by [`.github/workflows/build.yml`](../.github/workflows/build.yml):

| Trigger                                                   | Version                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------- |
| Push to `main` that changes the app, extension or Android | `package.json`'s if it's ahead of the latest tag, else latest tag + patch |
| Push a tag `vX.Y.Z`                                       | `X.Y.Z`                                                                   |

Pull requests and other pushes run the same checks and builds but never publish, and never see
the signing secrets.

Each release run lints, typechecks, tests and audits dependencies, then builds what changed:

| Platform          | Runner           | Files                                                     | Signed with                      |
| ----------------- | ---------------- | --------------------------------------------------------- | -------------------------------- |
| macOS             | `macos-latest`   | `.dmg` and `-mac.zip` for x64 and arm64, `latest-mac.yml` | Developer ID, notarized          |
| Windows           | `windows-latest` | NSIS `-setup.exe` (x64), `latest.yml`                     | not signed                       |
| Linux             | `ubuntu-latest`  | `.AppImage`, `.deb`, `latest-linux.yml`                   | not signed (checksums only)      |
| Browser extension | `ubuntu-latest`  | Chromium `.zip` files, Firefox `.xpi` and `.zip`          | Firefox add-on signed by Mozilla |
| Android           | `ubuntu-latest`  | `.apk`                                                    | release keystore                 |

The release job then writes `SHA256SUMS.txt`, creates a build-provenance attestation for every
file, uploads everything to a **draft** release, and only then publishes it. Installed apps and
`scripts/install-mac.sh` read the release marked Latest, so they never see a half-uploaded one.

## Approving a release

The jobs that sign (the macOS build, the browser extension and Android) run in the `release`
environment on release runs. The environment only accepts `main` and `v*` tags and needs the
maintainer's approval, and the signing secrets are stored there.

After a merge to `main` the checks run, then the run stops at **Review deployments**. Approve it
(Actions → the run → **Review deployments** → `release` → **Approve and deploy**) to build, sign
and publish. Reject it, or let it wait, and nothing is published. Merging therefore never ships an
update to installed apps on its own.

The `release` environment must exist with its protection rules **before** a workflow that uses it
runs on `main`: GitHub creates a missing environment on first use, without any protection.

## Secrets

Add these as **secrets of the `release` environment** (Settings → Environments → release), not as
repository secrets. Only approved release jobs can read them.

### macOS: Developer ID signing and notarization

| Secret                        | Value                                                                   |
| ----------------------------- | ----------------------------------------------------------------------- |
| `CSC_LINK`                    | The Developer ID Application certificate and key: `base64 -i devid.p12` |
| `CSC_KEY_PASSWORD`            | The `.p12` export password                                              |
| `APPLE_ID`                    | The Apple Account email of the developer team member                    |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password for that Apple Account, used by `notarytool`   |
| `APPLE_TEAM_ID`               | `YLGZDPWZ2X`                                                            |

```sh
base64 -i devid.p12 | gh secret set CSC_LINK --env release
gh secret set CSC_KEY_PASSWORD --env release
gh secret set APPLE_ID --env release
gh secret set APPLE_APP_SPECIFIC_PASSWORD --env release
gh secret set APPLE_TEAM_ID --env release --body YLGZDPWZ2X
```

`gh secret set` without `--body` prompts for the value, so it doesn't end up in your shell history.

1. **Certificate.** Use the existing _Developer ID Application: ALEXANDER NICHOLAS SOFIANIDIS
   (YLGZDPWZ2X)_ certificate (the same `.p12` dbms-tool uses). To make a new one: Xcode → Settings
   → Accounts → Manage Certificates → **+** → Developer ID Application, then in Keychain Access
   export the certificate _with its private key_ as a `.p12` with a password. Developer ID
   certificates last five years; the signatures stay valid after expiry because they're
   timestamped, but new releases need a new certificate.
2. **App-specific password.** Create one for this project at
   [account.apple.com](https://account.apple.com) → Sign-In and Security → App-Specific
   Passwords. Revoking it only stops notarization, not signing.

How the macOS build uses them:

1. **Configure code signing** exports only the secrets that are set. Without `CSC_LINK` the build
   is ad-hoc signed and the job warns; with `CSC_LINK` but without the three `APPLE_*` secrets
   it's signed but not notarized, and the job warns about that too.
2. **electron-builder** signs the app with the hardened runtime and
   [`build/entitlements.mac.plist`](../build/entitlements.mac.plist), submits it to Apple's notary
   service, staples the ticket to the `.app`, and builds the `.zip` (used by the updater and
   `install-mac.sh`) and the signed `.dmg` from it.
3. **Notarize and staple the dmgs** submits each `.dmg` with
   `xcrun notarytool submit --wait --timeout 2h`, staples it, and checks it with
   `spctl -a -t open --context context:primary-signature`. The dmgs aren't listed in
   `latest-mac.yml`, because stapling changes them after electron-builder has hashed them.
4. **Verify macOS signatures** checks both apps with `codesign --verify --deep --strict`,
   `stapler validate` and `spctl -a -t exec`.

**A team's first notarizations can take an hour or more**; later ones usually finish within
minutes. The dmg step allows two hours per file. If Apple rejects a submission, the job prints
the notary log and fails, and nothing is published.

Entitlements: the app keeps only `com.apple.security.cs.allow-jit`, which V8 needs to compile
JavaScript and WebAssembly (Argon2) at runtime. It was tested with Electron 39 under the hardened
runtime; the other usual Electron exceptions (`allow-unsigned-executable-memory`,
`disable-library-validation`, `allow-dyld-environment-variables`) aren't needed and would weaken
the runtime's protections.

Updates: Squirrel.Mac only installs an update signed by the same Developer ID as the running app.
Apps released before signing (1.0.19 and earlier) can't update in place; their update button opens
the release page, and users install the first signed release by hand.

### Android

| Secret                      | Value                                                       |
| --------------------------- | ----------------------------------------------------------- |
| `ANDROID_KEYSTORE_BASE64`   | `base64 -w0 release.jks` (`base64 -i release.jks` on macOS) |
| `ANDROID_KEYSTORE_PASSWORD` | The keystore password                                       |
| `ANDROID_KEY_ALIAS`         | The key alias                                               |
| `ANDROID_KEY_PASSWORD`      | Optional; defaults to the keystore password                 |

Android only installs an update signed with the same key, so **back the keystore up**; if it's
lost, users have to uninstall and reinstall. Release runs without these build a debug APK.

### Firefox add-on

| Secret           | Value                                   |
| ---------------- | --------------------------------------- |
| `AMO_JWT_ISSUER` | addons.mozilla.org API key (JWT issuer) |
| `AMO_JWT_SECRET` | addons.mozilla.org API secret           |

Without them the release still ships the unsigned Firefox `.zip`, and Firefox keeps the previous
signed add-on.

### Windows

Windows builds aren't code signed, so SmartScreen warns on first download. electron-builder reads
`CSC_LINK` for Windows too, which is why the workflow only exports it on the macOS runner.

## Verifying a release

```sh
gh release download vX.Y.Z --repo asofianidis/password-manager
shasum -a 256 -c SHA256SUMS.txt
gh attestation verify password-manager-X.Y.Z-arm64.dmg --repo asofianidis/password-manager
```

macOS:

```sh
# Disk images: expect "accepted" and "source=Notarized Developer ID"
spctl -a -vvv -t open --context context:primary-signature password-manager-X.Y.Z-arm64.dmg
xcrun stapler validate password-manager-X.Y.Z-arm64.dmg

# Apps: unzip, then expect "accepted" and "source=Notarized Developer ID"
ditto -x -k password-manager-X.Y.Z-arm64-mac.zip out
spctl -a -vvv -t exec "out/Password Manager.app"
xcrun stapler validate "out/Password Manager.app"
codesign -dvv "out/Password Manager.app" 2>&1 | grep -E 'Authority|TeamIdentifier|Runtime'
```

Repeat for the `x64` files.
