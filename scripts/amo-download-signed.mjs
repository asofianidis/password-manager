/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JS, no annotations */
// Downloads a version of the Firefox add-on that addons.mozilla.org has already signed. AMO signs
// each version only once, so when a release run is re-run after signing succeeded, `web-ext sign`
// fails with "Version X already exists" and the signed file has to be fetched instead.
//
//   WEB_EXT_API_KEY=… WEB_EXT_API_SECRET=… node scripts/amo-download-signed.mjs <guid> <version> <out.xpi>
import { createHash, createHmac, randomUUID } from 'crypto'
import { writeFile } from 'fs/promises'

const API = 'https://addons.mozilla.org/api/v5'

/**
 * A short-lived JWT for the AMO API (https://mozilla.github.io/addons-server/topics/api/auth.html).
 * The HMAC is the JWT's HS256 signature, not a password hash.
 */
export function amoToken(issuer, secret, now = Math.floor(Date.now() / 1000)) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iss: issuer, jti: randomUUID(), iat: now, exp: now + 60 })}`
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`
}

async function get(url, issuer, secret) {
  const response = await fetch(url, {
    headers: { Authorization: `JWT ${amoToken(issuer, secret)}` }
  })
  if (!response.ok) throw new Error(`${url}: ${response.status} ${await response.text()}`)
  return response
}

export async function main() {
  const [guid, version, out] = process.argv.slice(2)
  const issuer = process.env.WEB_EXT_API_KEY
  const secret = process.env.WEB_EXT_API_SECRET
  if (!guid || !version || !out || !issuer || !secret) {
    console.error(
      'Usage: WEB_EXT_API_KEY=… WEB_EXT_API_SECRET=… amo-download-signed.mjs <guid> <version> <out.xpi>'
    )
    process.exit(2)
  }
  // The v prefix makes AMO look the version up by number rather than by id
  const url = `${API}/addons/addon/${encodeURIComponent(guid)}/versions/v${encodeURIComponent(version)}/`
  const info = await (await get(url, issuer, secret)).json()
  if (info.version !== version || !info.file?.url) {
    throw new Error(`AMO returned version ${info.version} without a file for ${version}`)
  }
  const [algorithm, expected] = String(info.file.hash).split(':')
  if (algorithm !== 'sha256' || !expected) {
    throw new Error(`AMO returned no sha256 hash for ${version} (${info.file.hash})`)
  }
  const file = Buffer.from(await (await get(info.file.url, issuer, secret)).arrayBuffer())
  // Only write a file that matches the hash AMO reported for this version
  const actual = createHash('sha256').update(file).digest('hex')
  if (actual !== expected) throw new Error(`Download doesn't match AMO's hash for ${version}`)
  await writeFile(out, file)
  console.log(
    `Downloaded signed ${guid} ${version} (${info.channel}, ${file.length} bytes) to ${out}`
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
