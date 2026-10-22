// Packs the built extension (run build:extension first) into release files in extension/release:
// a signed .crx and a .zip for Chromium browsers, and a .zip for Firefox.
// The .crx is signed with the private key in CHROME_EXTENSION_KEY; without it only zips are made.
import { createHash, createPublicKey } from 'crypto'
import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = join(root, 'extension', 'dist')
const out = join(root, 'extension', 'release')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const crx3 = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'crx3.cmd' : 'crx3')

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

// The ID the app's native messaging host allows (src/shared/browser-protocol.ts)
const protocol = readFileSync(join(root, 'src', 'shared', 'browser-protocol.ts'), 'utf8')
const pinnedId = protocol.match(/CHROME_EXTENSION_ID = '([a-p]{32})'/)?.[1]
if (!pinnedId) throw new Error('CHROME_EXTENSION_ID not found in browser-protocol.ts')

const base = join(out, `password-manager-extension-${version}`)
const key = process.env.CHROME_EXTENSION_KEY?.trim()
if (key) {
  // A different key would give a different ID, which the app would refuse to talk to
  // Chrome derives an extension's ID from the SHA-256 of its public key, written in a-p
  const der = createPublicKey(key).export({ type: 'spki', format: 'der' })
  const hex = createHash('sha256').update(der).digest('hex').slice(0, 32)
  const id = [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('')
  if (id !== pinnedId) throw new Error(`CHROME_EXTENSION_KEY gives ID ${id}, expected ${pinnedId}`)
  const dir = mkdtempSync(join(tmpdir(), 'pm-crx-'))
  const keyPath = join(dir, 'key.pem')
  writeFileSync(keyPath, `${key}\n`, { mode: 0o600 })
  try {
    execFileSync(
      crx3,
      ['-p', keyPath, '-o', `${base}-chrome.crx`, '-z', `${base}-chrome.zip`, join(dist, 'chrome')],
      { stdio: 'inherit', shell: process.platform === 'win32' }
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  console.log(`Signed ${base}-chrome.crx (ID ${id})`)
} else {
  console.warn('CHROME_EXTENSION_KEY is not set: skipping the signed .crx')
  execFileSync('zip', ['-qr', `${base}-chrome.zip`, '.'], { cwd: join(dist, 'chrome') })
}
execFileSync('zip', ['-qr', `${base}-firefox.zip`, '.'], { cwd: join(dist, 'firefox') })
console.log(`Packed extension zips in ${out}`)
