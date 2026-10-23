# Sync protocol (v1)

Devices sync **directly with each other**; there is no server. The transport is plain
HTTP, and every payload is AES-256-GCM sealed with the shared vault key, so a device
that does not hold the vault can neither read nor forge messages. Run it over
**Tailscale** (WireGuard-encrypted, reachable only from your tailnet) or a trusted LAN.

Reference implementation: `src/main/sync/`. Default port: **47821**. Read
[VAULT_FORMAT.md](./VAULT_FORMAT.md) first for the crypto primitives.

## Endpoints

All bodies are JSON. Errors return a non-2xx status with `{ "error": "message" }`.

### `GET /v1/hello`

Unauthenticated discovery.

```json
{ "app": "pm", "protocol": 1, "deviceName": "MacBook", "vaultId": "uuid or null" }
```

### `POST /v1/pair`

Used once by a new device to obtain the key header. It only works while the user has
pressed **Start pairing** on the serving device. That window lasts 5 minutes, accepts one
successful pairing, and closes after 5 wrong codes.

```jsonc
// request
{ "code": "123456" }
// response 200
{ "vaultId": "uuid", "header": { /* key header */ }, "deviceName": "MacBook" }
```

The joining device then unwraps the vault key with the master password the user types,
writes a `vault.json` with no entries, and immediately syncs with that device.

### `POST /v1/sync`

```jsonc
// request
{
  "vaultId": "uuid",
  "keyId": "key id of the vault key that sealed payload", // optional for old clients
  "nonce": "≥16 chars, random (base64url of 18 bytes)",
  "payload": "seal(vaultKey, SyncMessage, AAD = pm:sync-req:v1:<vaultId>)"
}
// response 200, sealed with the same key as the request
{ "payload": "seal(vaultKey, SyncMessage, AAD = pm:sync-res:v1:<vaultId>:<nonce>)" }
```

```jsonc
// SyncMessage
{
  "deviceId": "uuid",
  "deviceName": "Pixel 9",
  "sentAt": 1739999999999, // ms epoch
  "nonce": "same as outer nonce",
  "header": {/* sender's key header */},
  "entries": [/* ALL VaultEntry records, including tombstones */]
}
```

The server:

1. Returns `423` if its vault is locked, and `409` if `vaultId` differs.
2. Picks the key named by `keyId` (no `keyId`: its current key). If that is neither its
   current key nor one of its retired keys, returns `409` when it matches its pending
   header's key (the user hasn't entered the new password there yet), else `401`.
3. Opens the payload and returns `401` if decryption fails (the sender doesn't hold that key).
4. Rejects the request if the inner `nonce` doesn't match the outer one, if `|now - sentAt| > 5 min`,
   or if the nonce was seen in the last 10 minutes (replay).
5. If the key is **retired**: returns `403` if it is revoked. Otherwise it ignores the
   sender's entries (anyone with an old copy of the vault holds that key) and responds with
   its header and **no** entries, so the sender can switch once the new password is entered.
6. Otherwise merges `entries` into its vault (see the merge rule), and keeps `header` as
   pending if it is newer (see [Headers from other devices](./VAULT_FORMAT.md#headers-from-other-devices)).
7. Responds with its full post-merge record set and header, bound to the request nonce.

The client merges the response in the same way. After one round trip both devices hold
identical data. The client then exchanges attachment files (below).

If the server answers `401` and the client has non-revoked retired keys, the server may
still be on one of them. The client retries with each (newest first, up to 3), sending its
header and no entries, and ignores the entries in the reply.

### `POST /v1/attachments`

Moves attachment files (see [Attachments](./VAULT_FORMAT.md#attachments)) between devices.
A client calls it after each successful `/v1/sync`, when both sides refer to the same
attachments. Servers that predate attachments answer `404`; skip the exchange then.

```jsonc
// request
{
  "vaultId": "uuid",
  "keyId": "key id of the current vault key",
  "nonce": "≥16 chars, random",
  "payload": "seal(vaultKey, AttachmentRequest, AAD = pm:att-req:v1:<vaultId>)"
}
// response 200
{ "payload": "seal(vaultKey, AttachmentResponse, AAD = pm:att-res:v1:<vaultId>:<nonce>)" }
```

```jsonc
// AttachmentRequest
{
  "nonce": "same as outer nonce",
  "sentAt": 1739999999999,
  "want": ["id", …], // files the client lacks and wants sent (≤ 1000)
  "check": ["id", …], // files the client has; the server lists the ones it lacks (≤ 10000)
  "put": [{ "id": "…", "data": "the attachment file's contents" }] // files the server asked for
}
// AttachmentResponse
{
  "attachments": [{ "id": "…", "data": "the attachment file's contents" }],
  "missing": ["id", …], // ids in `want` the server can't send
  "need": ["id", …] // ids in `check` the server lacks
}
```

The server checks the request like `/v1/sync` (423 locked, 409 vault mismatch, nonce, clock
and replay checks), except that only the **current** vault key is accepted (`401` otherwise).
It only sends, accepts, or asks for files that a live entry in its vault refers to. Before
storing a file it opens it with that entry's attachment key and drops it if that fails.

`attachments` holds the wanted files in order until their total size passes 12 MiB (at
least one file is sent). Wanted ids that are in neither `attachments` nor `missing` were
held back for size: ask again. Likewise, send `put` in batches of at most 12 MiB (a single
file may exceed that), with empty `want` and `check`. Allow up to 2 minutes per request.

A client's exchange is therefore:

1. Collect the attachment ids of all live entries. `want` = the ones whose file is missing
   locally, `check` = the rest.
2. Send `want` + `check`. Store each returned file after opening it with its key. Repeat with
   the remaining `want` while the server keeps sending files.
3. Send the files listed in `need` with `put`, in batches.

## Android implementation notes

The Android app (`android/`, reference: `sync/SyncClient.kt`) follows these:

- A phone usually can't keep a listener running, so it acts as a **client only**: pair, then
  `POST /v1/sync` to a desktop on the tailnet. The desktop must have **Accept sync
  connections** on and be unlocked.
- Use the Tailscale Android app for connectivity; address the desktop by its
  `100.x.y.z` IP or MagicDNS name.
- Android blocks cleartext HTTP by default, and `network_security_config` can't allow an IP
  range such as `100.64.0.0/10`, so the app allows cleartext everywhere except GitHub (its only
  other requests are update checks and downloads, which must use HTTPS). Confidentiality comes from the vault-key encryption plus WireGuard, not from TLS.
- The merge tie-break compares `JSON.stringify` output, so a client in another language must
  serialize entries with the desktop's key order and JavaScript's string escaping
  (`canonicalJson` in `vault/Merge.kt`).
- Keep device clocks synced (the 5-minute window).
