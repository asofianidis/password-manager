# Security policy

Password Manager holds your passwords, cards, IDs and documents, so security reports are handled
before any feature work.

## Supported versions

Only the latest release receives fixes. The desktop app and the Android app update themselves, so
a fix ships to everyone as a new release. The iOS app is built from source; rebuild it from `main`.

## Reporting a vulnerability

**Please don't open a public issue.** Report privately through GitHub:
[Security → Report a vulnerability](https://github.com/asofianidis/password-manager/security/advisories/new).

Include what you found, how to reproduce it, the version and platform, and the impact you expect.
You can expect an acknowledgement within a few days and a fix or a plan within 30 days for
confirmed issues. Once a fix is released, the advisory is published and you're credited unless
you'd rather not be.

Password Manager is a free, volunteer-maintained project and has no bug bounty.

## Scope

In scope:

- **Vault encryption** (`src/main/vault/`, [docs/VAULT_FORMAT.md](docs/VAULT_FORMAT.md), and the
  Android and iOS implementations): anything that lets someone without the master password read
  or undetectably change vault data, attachments or exports; weaknesses in key derivation
  (Argon2id), AES-GCM use or its additional data; key rotation that leaves later data readable
  with an old key or a revoked device; secrets left on disk or in logs unencrypted.
- **Peer-to-peer sync** (`src/main/sync/`, [docs/SYNC_PROTOCOL.md](docs/SYNC_PROTOCOL.md)):
  reading, forging or replaying sync messages without the vault key; getting a vault key header
  through pairing without the pairing code; a revoked device receiving new data; a malicious
  peer corrupting another device's vault or crashing its app.
- **The browser extension and its bridge** (`extension/`, `src/main/browser/`): a web page
  obtaining a login, card or note it shouldn't; filling a password into a site that doesn't match
  the saved login, or into plain http for a login saved as https; an extension other than ours
  starting the native messaging host; using a revoked browser's token.
- **The desktop app** (`src/`): the renderer escaping its sandbox or the preload's allow-listed
  API, remote content loading in the app window, the vault staying readable after it locks.
- **The release and update pipeline**: anything that could get an unsigned, unnotarized or
  tampered build to users. This includes the GitHub workflows, `electron-builder.yml`, the
  entitlements in `build/`, the in-app updater (`src/main/updater.ts`), the browser extension
  update channel (`extension-latest`), and `scripts/install-mac.sh`.

Out of scope:

- Programs already running as your user account. They can read the app's memory and files, and
  any program you approve as a browser can request logins (see the README's browser extension
  section). That is a limit of the design, not a vulnerability.
- Someone with physical access to an unlocked device, or who knows your master password.
- Sync's plain HTTP transport and the unauthenticated `GET /v1/hello` discovery response, which
  are documented. Payloads are sealed with the vault key; run sync over Tailscale or a LAN you
  trust.
- Vulnerabilities in Electron, the browsers, Tailscale or the operating system. Report those
  upstream; if the app is affected, tell us too so we can ship the fix.

## Verifying downloads

Every release file is listed in `SHA256SUMS.txt` and has a GitHub build-provenance attestation:

```sh
shasum -a 256 -c SHA256SUMS.txt --ignore-missing
gh attestation verify <file> --repo asofianidis/password-manager
```

`scripts/install-mac.sh` checks the download against `SHA256SUMS.txt` before installing. See
[docs/RELEASING.md](docs/RELEASING.md) for how releases are built and approved.
