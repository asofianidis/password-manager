# Vault format (v1)

Everything another client (e.g. the Android app) needs to read and write a vault
compatible with the desktop app. Reference implementation: `src/main/vault/`.

## Primitives

| Purpose        | Algorithm                                                         |
| -------------- | ----------------------------------------------------------------- |
| Key derivation | Argon2id, 32-byte output, params stored in the file               |
| Encryption     | AES-256-GCM, 12-byte random IV, 16-byte tag                       |
| Sealed blob    | `base64( iv[12] ‖ ciphertext ‖ tag[16] )`                         |
| Password input | UTF-8 of the master password after Unicode **NFKC** normalization |

Every sealed blob is bound to its purpose with GCM additional authenticated data (AAD),
a UTF-8 string:

| Blob                  | AAD                                                   |
| --------------------- | ----------------------------------------------------- |
| Wrapped vault key     | `pm:vault-key:v1:<vaultId>`                           |
| Retired vault key     | `pm:prev-key:v1:<vaultId>:<keyId>:<revoked\|forward>` |
| Vault data            | `pm:vault-data:v1:<vaultId>`                          |
| Encrypted export      | `pm:export:v1`                                        |
| Sync request payload  | `pm:sync-req:v1:<vaultId>`                            |
| Sync response payload | `pm:sync-res:v1:<vaultId>:<nonce>`                    |

On Android: Argon2id via `org.bouncycastle.crypto.generators.Argon2BytesGenerator`
(or argon2kt), and AES-GCM via `javax.crypto.Cipher("AES/GCM/NoPadding")`, which
appends the tag to the ciphertext, the same layout as above.

## Key hierarchy

```
master password ──Argon2id(kdf)──▶ KEK ──AES-GCM unwrap──▶ vault key (32 random bytes)
                                                              │
                                                              └─AES-GCM──▶ vault data
```

The **vault key** is shared by every device of the vault. It is **rotated** (replaced with
32 new random bytes, and all data re-encrypted) whenever the master password changes, and
when the user revokes a lost device. So an old `vault.json` or pairing header plus the old
password can't read anything saved afterwards.

Each key has a public **key id**: `base64url(HMAC-SHA256(key = vault key, "pm:key-id:v1"))`,
first 22 characters. Sync uses it to tell which key a message is sealed with.

### Rotation

1. Generate a new vault key and wrap it with the (new) master password and fresh KDF params.
2. Seal each retired key (the previous header's `previousKeys` plus the key being replaced)
   with the **new** vault key. Keep at most 32, oldest first.
   - After a master password change, they keep their `revoked` flag (normally `false`).
     Devices still on them are sent the new header, which needs the new password.
   - After revoking a device, every retired key gets `revoked: true`. Devices still on them
     are refused and must pair again.
3. Set `updatedAt = max(now, previous.updatedAt + 1)` and re-seal `data` with the new key.

## `vault.json`

Stored in the app's user-data directory (`~/Library/Application Support/password-manager`
on macOS).

```jsonc
{
  "format": "pm-vault",
  "version": 1,
  "vaultId": "uuid",
  "key": {
    "kdf": {
      "algorithm": "argon2id",
      "salt": "base64, 16 bytes",
      "memoryKiB": 65536,
      "iterations": 3,
      "parallelism": 1
    },
    "wrappedKey": "sealed vault key",
    "updatedAt": 1739999999999, // ms epoch; when the key or master password last changed
    "keyId": "key id of the vault key", // absent on headers from before rotation existed
    "previousKeys": [
      // optional; retired keys, oldest first
      { "keyId": "…", "wrappedKey": "seal(vault key, old key, AAD above)", "revoked": false }
    ]
  },
  "pendingKey": {/* optional; a newer header from another device, see below */},
  "data": "sealed JSON { entries: VaultEntry[] }", // always sealed with `key`'s vault key
  "savedAt": 1739999999999
}
```

The `key` object is the **key header**. It is safe to share with paired devices,
because it is useless without the master password.

### Headers from other devices

A header received over sync is **never** written over `key` directly, since a buggy peer
could send one the user's password can't open. Instead:

1. Reject it unless it is well-formed and its KDF is at least as strong as the defaults:
   Argon2id, salt ≥ 16 bytes, `memoryKiB` 65536–1048576, `iterations` 3–64,
   `parallelism` 1–16.
2. Keep it as `pendingKey` if its `updatedAt` is newer than both `key` and any existing
   `pendingKey`.
3. On unlock, try the password on both `key` and `pendingKey`. If `pendingKey` opens, make
   it `key` and re-seal `data` with its vault key. If only `pendingKey` opens, find the key
   `data` is sealed with among its `previousKeys`. If only `key` opens, unlock as usual and
   leave `pendingKey` for the user to enter the new password later (or dismiss).

## `VaultEntry`

```jsonc
{
  "id": "uuid",
  "title": "GitHub",
  "username": "me@example.com",
  "password": "…",
  "url": "https://github.com",
  "notes": "",
  "totp": "otpauth://… or base32 secret, may be empty",
  "folder": "",
  "favorite": false,
  "createdAt": 0, // ms epoch
  "updatedAt": 0, // ms epoch, bumped on every change; drives sync
  "passwordUpdatedAt": 0, // ms epoch, bumped only when the password changes
  "deleted": true // present only on tombstones
}
```

Deleting an entry replaces it with a **tombstone**: the same `id`, `deleted: true`, a
new `updatedAt`, and every secret field set to `""`. Tombstones are kept forever so
deletions reach devices that have been offline.

Edits must set `updatedAt = max(now, previous.updatedAt + 1)`.

## Merge rule (used by sync)

For each `id`, keep the record with the greater `updatedAt`. On a tie, prefer the
tombstone; if still tied, prefer the record whose canonical JSON string compares greater.
See `src/shared/merge.ts`. All clients must implement exactly this rule so that devices
converge.

## Encrypted export (`.pmbackup`)

```jsonc
{
  "format": "pm-export",
  "version": 1,
  "encrypted": true,
  "exportedAt": 0,
  "kdf": {/* same shape as above, fresh salt */},
  "data": "sealed JSON { entries: ExportedEntry[] }" // key = Argon2id(backup password)
}
```

A plaintext export has the same shape with `"encrypted": false` and an `entries` array
in place of `kdf`/`data`. Exported entries have no `id`; they get new ids on import.
