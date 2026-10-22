import { it, vi } from 'vitest'
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * A headless desktop for testing the Android app: the real vault and sync code, serving a demo
 * vault and opening pairing. From an emulator, the computer's address is 10.0.2.2.
 *
 *   npx vitest run --config android/scripts/vitest.config.ts desktop-peer
 *
 * Vitest holds console output until the test ends, so progress also goes to PM_PEER_LOG
 * (default: pm-desktop-peer.log in the temp folder).
 *
 * Env: PM_PEER_PORT (default 47999, so it doesn't clash with a running app), PM_PEER_MINUTES (30).
 */
const PORT = Number(process.env.PM_PEER_PORT ?? 47999)
const MINUTES = Number(process.env.PM_PEER_MINUTES ?? 30)
const LOG = process.env.PM_PEER_LOG ?? join(tmpdir(), 'pm-desktop-peer.log')
const MASTER = 'correct horse battery staple'

function log(line: string): void {
  console.log(line)
  appendFileSync(LOG, line + '\n')
}

const demo = [
  ['GitHub', 'octocat@example.com', 'https://github.com'],
  ['Example', 'me@example.com', 'https://example.com'],
  ['Wikipedia', 'wiki-user', 'https://en.wikipedia.org'],
  ['Hacker News', 'pg', 'https://news.ycombinator.com']
]

it('serves a demo vault', async () => {
  writeFileSync(LOG, '')
  const dir = mkdtempSync(join(tmpdir(), 'pm-desktop-peer-'))
  vi.doMock('electron', () => ({ app: { getPath: () => dir } }))
  const { settingsStore } = await import('../../src/main/settings')
  const { vault } = await import('../../src/main/vault/vault')
  const { sync } = await import('../../src/main/sync/sync')
  await settingsStore.load()
  await settingsStore.update({
    deviceName: 'Test desktop',
    sync: { serverEnabled: true, bindAddress: '0.0.0.0', port: PORT }
  })
  await vault.init()
  await vault.create(MASTER)
  for (const [title, username, url] of demo) {
    await vault.createEntry({
      title,
      username,
      password: `${title.toLowerCase().replace(/\W/g, '')}-pw-123`,
      url,
      notes: '',
      totp: '',
      folder: '',
      favorite: false
    })
  }
  await sync.reconcile()
  const { pairing, listenAddresses } = await sync.startPairing()
  log(`Desktop peer on ${listenAddresses.join(', ')} (emulator: 10.0.2.2:${PORT})`)
  log(`Pairing code: ${pairing!.code}   Master password: ${MASTER}`)

  let last = ''
  const deadline = Date.now() + MINUTES * 60_000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    const now = vault
      .list()
      .map((e) => `${e.title}=${e.username}/${e.password}`)
      .sort()
      .join(', ')
    if (now !== last) log(`[${new Date().toLocaleTimeString()}] entries: ${now}`)
    last = now
  }
  await sync.stop()
  rmSync(dir, { recursive: true, force: true })
})
