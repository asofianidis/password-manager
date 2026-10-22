import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { strToU8, zipSync } from 'fflate'
import { EXTENSION_CHANNEL_URL, compareVersions } from '../src/shared/browser-protocol'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'pm-ext-'))
  dirs.push(dir)
  return dir
}

const manifest = (version: string): string => JSON.stringify({ manifest_version: 3, version })
const zipOf = (files: Record<string, string>): Uint8Array =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])))
const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const DOWNLOAD = 'https://github.com/asofianidis/password-manager/releases/download/v2.0.0/x.zip'

type Files = typeof import('../src/main/browser/extension-files').extensionFiles

let userData: string
let project: string
let responses: Map<string, Uint8Array | string>

async function load(): Promise<Files> {
  vi.resetModules()
  vi.doMock('electron', () => ({
    app: { getPath: () => userData, isPackaged: false, getAppPath: () => project },
    net: {
      fetch: async (url: string) => {
        const body = responses.get(url)
        return body === undefined
          ? new Response('not found', { status: 404 })
          : new Response(body as BodyInit)
      }
    }
  }))
  return (await import('../src/main/browser/extension-files')).extensionFiles
}

function publish(
  version: string,
  zip: Uint8Array,
  extra: Partial<{ url: string; sha: string }> = {}
): void {
  const url = extra.url ?? DOWNLOAD
  responses.set(url, zip)
  responses.set(
    `${EXTENSION_CHANNEL_URL}/extension.json`,
    JSON.stringify({ version, chrome: { url, sha256: extra.sha ?? sha256(zip) } })
  )
}

const installed = (files: Files): string | null =>
  existsSync(join(files.dir, 'manifest.json'))
    ? JSON.parse(readFileSync(join(files.dir, 'manifest.json'), 'utf8')).version
    : null

beforeEach(() => {
  userData = temp()
  project = temp()
  responses = new Map()
  const bundled = join(project, 'extension', 'dist', 'chrome')
  mkdirSync(bundled, { recursive: true })
  writeFileSync(join(bundled, 'manifest.json'), manifest('1.0.0'))
  writeFileSync(join(bundled, 'background.js'), 'bundled')
})

describe('compareVersions', () => {
  it('compares numerically and treats null as oldest', () => {
    expect(compareVersions('1.0.10', '1.0.9')).toBe(1)
    expect(compareVersions('1.0.9', '1.0.10')).toBe(-1)
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
    expect(compareVersions(null, '0.0.1')).toBe(-1)
    expect(compareVersions('0.0.1', null)).toBe(1)
  })
})

describe('extension files', () => {
  it('installs the bundled copy on first start', async () => {
    const files = await load()
    await files.start()
    expect(installed(files)).toBe('1.0.0')
    expect(readFileSync(join(files.dir, 'background.js'), 'utf8')).toBe('bundled')
    expect(files.status()).toMatchObject({ version: '1.0.0', error: null, path: files.dir })
  })

  it('downloads a newer release, verifies it, and announces the change', async () => {
    const files = await load()
    await files.start()
    const changed = vi.fn()
    files.on('changed', changed)
    publish('2.0.0', zipOf({ 'manifest.json': manifest('2.0.0'), 'js/background.js': 'new' }))

    expect(await files.check()).toMatchObject({ version: '2.0.0', error: null, checking: false })
    expect(installed(files)).toBe('2.0.0')
    expect(readFileSync(join(files.dir, 'js', 'background.js'), 'utf8')).toBe('new')
    // The old bundled file is gone, not merged in
    expect(existsSync(join(files.dir, 'background.js'))).toBe(false)
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('keeps the current files when the download is corrupt', async () => {
    const files = await load()
    await files.start()
    publish('2.0.0', zipOf({ 'manifest.json': manifest('2.0.0') }), { sha: '00'.repeat(32) })
    expect((await files.check()).error).toMatch(/corrupt/)
    expect(installed(files)).toBe('1.0.0')
  })

  it('refuses downloads from outside the repo releases', async () => {
    const files = await load()
    await files.start()
    publish('2.0.0', zipOf({ 'manifest.json': manifest('2.0.0') }), {
      url: 'https://evil.example/ext.zip'
    })
    expect((await files.check()).error).toMatch(/Refusing/)
    expect(installed(files)).toBe('1.0.0')
  })

  it('rejects zips that write outside the folder', async () => {
    const files = await load()
    await files.start()
    publish('2.0.0', zipOf({ 'manifest.json': manifest('2.0.0'), '../escape.js': 'x' }))
    expect((await files.check()).error).toMatch(/Unsafe path/)
    expect(installed(files)).toBe('1.0.0')
    expect(existsSync(join(files.dir, '..', 'escape.js'))).toBe(false)
  })

  it('rejects a zip whose version differs from the feed', async () => {
    const files = await load()
    await files.start()
    publish('2.0.0', zipOf({ 'manifest.json': manifest('1.5.0') }))
    expect((await files.check()).error).toMatch(/expected 2.0.0/)
    expect(installed(files)).toBe('1.0.0')
  })

  it('never downgrades', async () => {
    const files = await load()
    await files.start()
    publish('0.9.0', zipOf({ 'manifest.json': manifest('0.9.0') }))
    expect(await files.check()).toMatchObject({ version: '1.0.0', error: null })
    expect(installed(files)).toBe('1.0.0')
  })

  it('reports a failed check without changing anything', async () => {
    const files = await load()
    await files.start()
    expect((await files.check()).error).toMatch(/HTTP 404/)
    expect(installed(files)).toBe('1.0.0')
  })
})
