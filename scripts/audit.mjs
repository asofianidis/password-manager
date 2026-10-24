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
  // 'GHSA-xxxx-xxxx-xxxx': { until: 'YYYY-MM-DD', reason: 'why it does not apply' }
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
