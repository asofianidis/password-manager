// Fails when npm reports a high or critical advisory for any installed package (including
// devDependencies such as electron, which ships inside the app), unless the advisory is listed
// in ALLOWED below with a reason and an expiry date. Expired entries fail again, so an exception
// is revisited instead of silently lasting forever.
//
//   node scripts/audit.mjs
import { spawnSync } from 'child_process'

const FAIL_ON = new Set(['high', 'critical'])

/** GHSA id → why it doesn't apply (or why it can wait) and the date it stops being accepted */
const ALLOWED = {
  // extract-zip is only used by electron's install script to unpack the Electron binary it
  // downloads from GitHub (checked against Electron's SHASUMS256). It never handles untrusted
  // archives and isn't part of the app.
  'GHSA-jmr9-qjv8-65gv': { until: '2027-04-30', reason: 'build-time only (electron installer)' },
  'GHSA-7pqw-9j4j-h8q3': { until: '2027-04-30', reason: 'build-time only (electron installer)' },

  // Electron 39 is past end of life. These are fixed in Electron 41.10.6+ and 42.11.16+ and are
  // accepted only until the upgrade lands.
  // The app opens no popups (setWindowOpenHandler sends http(s) links to the browser and denies
  // the rest), uses no <webview> and registers no file/http protocol handlers.
  'GHSA-hq2x-r82h-9wj4': { until: '2026-11-21', reason: 'no popups; upgrade Electron' },
  'GHSA-gr2m-v5gq-v685': { until: '2026-11-21', reason: 'no sandboxed popups; upgrade Electron' },
  'GHSA-j84w-jfhq-vhvj': {
    until: '2026-11-21',
    reason: 'no custom protocol handlers; upgrade Electron'
  },
  'GHSA-9qh4-3jw8-366w': { until: '2026-11-21', reason: 'no <webview>; upgrade Electron' },
  // This one does apply: the app fetches updates and extension files over TLS. Upgrade soon.
  'GHSA-jr5w-w6x2-84p9': { until: '2026-11-21', reason: 'distrusts eMudhra CAs; upgrade Electron' }
}

const result = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 << 20 })
let report
try {
  report = JSON.parse(result.stdout)
} catch {
  console.error(result.stderr || result.stdout)
  console.error('npm audit did not return a report')
  process.exit(1)
}
if (report.error) {
  console.error(`npm audit failed: ${report.error.summary ?? JSON.stringify(report.error)}`)
  process.exit(1)
}

const today = new Date().toISOString().slice(0, 10)
const advisories = new Map()
for (const [name, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of vulnerability.via) {
    // Strings point at another package's entry, which is reported on its own
    if (typeof via !== 'object' || !FAIL_ON.has(via.severity)) continue
    const id = via.url.split('/').pop()
    advisories.set(id, { name, ...via, id })
  }
}

let failed = false
for (const a of advisories.values()) {
  const allowed = ALLOWED[a.id]
  const line = `${a.severity} ${a.name} ${a.range}: ${a.title} (${a.url})`
  if (allowed && allowed.until >= today) {
    console.log(`::warning::Accepted until ${allowed.until} (${allowed.reason}): ${line}`)
  } else {
    failed = true
    const why = allowed ? ` (exception expired on ${allowed.until})` : ''
    console.log(`::error::${line}${why}`)
  }
}
for (const [id, { until }] of Object.entries(ALLOWED)) {
  if (!advisories.has(id))
    console.log(`${id} (accepted until ${until}) no longer applies; remove it`)
}

console.log(
  failed
    ? 'High or critical advisories found. Update the package, or add a documented exception.'
    : `No unaccepted high or critical advisories (${advisories.size} accepted).`
)
process.exit(failed ? 1 : 0)
