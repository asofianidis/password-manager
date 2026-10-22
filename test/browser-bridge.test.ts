import { afterAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { build } from 'esbuild'
import type { BridgeRequest } from '../src/shared/browser-protocol'
import type { BrowserClient, VaultEntry, VaultState } from '../src/shared/types'
import { matchLevel } from '../src/main/browser/match'
import { FrameDecoder, encodeFrame } from '../src/main/browser/framing'
import { BridgeServer, createBridgeHandler, hashToken } from '../src/main/browser/bridge'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

describe('matchLevel', () => {
  it('matches the same host, ignoring www and bare-domain URLs', () => {
    expect(matchLevel('https://example.com/login', 'https://example.com/')).toBe(2)
    expect(matchLevel('example.com', 'https://www.example.com/signin')).toBe(2)
    expect(matchLevel('https://WWW.Example.com', 'https://example.com')).toBe(2)
  })

  it('matches subdomains of the saved host but not the other way round', () => {
    expect(matchLevel('example.com', 'https://login.example.com')).toBe(1)
    expect(matchLevel('login.example.com', 'https://example.com')).toBe(0)
  })

  it('rejects lookalike and unrelated hosts', () => {
    expect(matchLevel('example.com', 'https://notexample.com')).toBe(0)
    expect(matchLevel('example.com', 'https://example.com.evil.io')).toBe(0)
    expect(matchLevel('com', 'https://example.com')).toBe(0)
    expect(matchLevel('10.0.0.1', 'https://1.10.0.0.1')).toBe(0)
  })

  it('never sends an https login to a plain http page, except on localhost', () => {
    expect(matchLevel('https://example.com', 'http://example.com')).toBe(0)
    expect(matchLevel('example.com', 'http://example.com')).toBe(0)
    expect(matchLevel('http://example.com', 'http://example.com')).toBe(2)
    expect(matchLevel('localhost:3000', 'http://localhost:3000')).toBe(2)
  })

  it('requires the port when the saved URL has one', () => {
    expect(matchLevel('localhost:3000', 'http://localhost:4000')).toBe(0)
    expect(matchLevel('https://example.com', 'https://example.com:8443')).toBe(2)
  })

  it('ignores non-web URLs and empty saved URLs', () => {
    expect(matchLevel('', 'https://example.com')).toBe(0)
    expect(matchLevel('example.com', 'chrome://settings')).toBe(0)
    expect(matchLevel('example.com', 'file:///etc/passwd')).toBe(0)
  })
})

describe('native messaging frames', () => {
  it('round-trips messages split across chunks', () => {
    const bytes = Buffer.concat([encodeFrame({ a: 1 }), encodeFrame({ b: 'é' })])
    const decoder = new FrameDecoder()
    expect(decoder.push(bytes.subarray(0, 5))).toEqual([])
    expect(decoder.push(bytes.subarray(5))).toEqual([{ a: 1 }, { b: 'é' }])
  })

  it('rejects oversized frames', () => {
    const header = Buffer.alloc(4)
    header.writeUInt32LE(64 * 1024 * 1024)
    expect(() => new FrameDecoder().push(header)).toThrow(/too large/)
  })
})

const entry = (id: string, url: string, extra: Partial<VaultEntry> = {}): VaultEntry => ({
  id,
  title: id,
  username: `${id}-user`,
  password: `${id}-pass`,
  url,
  notes: '',
  totp: '',
  folder: '',
  favorite: false,
  createdAt: 0,
  updatedAt: 0,
  passwordUpdatedAt: 0,
  ...extra
})

interface Fake {
  state: VaultState
  clients: BrowserClient[]
  prompts: number
  shown: number
  entries: VaultEntry[]
}

type Handle = ReturnType<typeof createBridgeHandler>

function setup(options: { state?: VaultState; approve?: boolean } = {}): {
  fake: Fake
  handle: Handle
} {
  const fake: Fake = {
    state: options.state ?? ('unlocked' as VaultState),
    clients: [] as BrowserClient[],
    prompts: 0,
    shown: 0,
    entries: [
      entry('sub', 'https://example.com'),
      entry('exact', 'https://login.example.com'),
      entry('fav', 'example.com', { favorite: true }),
      entry('other', 'https://other.org'),
      entry('empty', 'https://example.com', { username: '', password: '' })
    ]
  }
  const handle = createBridgeHandler({
    vault: {
      status: () => ({ state: fake.state, vaultId: 'v' }),
      list: () => fake.entries
    },
    clients: () => fake.clients,
    addClient: async (client) => {
      fake.clients.push(client)
    },
    touchClient: () => {},
    confirmPair: async () => {
      fake.prompts++
      return options.approve ?? true
    },
    showApp: () => fake.shown++,
    extensionVersion: () => '1.2.3'
  })
  return { fake, handle }
}

async function paired(
  options?: Parameters<typeof setup>[0]
): Promise<{ fake: Fake; handle: Handle; token: string }> {
  const ctx = setup(options)
  const response = await ctx.handle({ type: 'pair', browser: 'Test\u0000 Browser' })
  if (!response.ok) throw new Error(response.error)
  return { ...ctx, token: (response.result as { token: string }).token }
}

describe('bridge handler', () => {
  it('pairs after approval and stores only a hash of the token', async () => {
    const { fake, handle, token } = await paired()
    expect(fake.prompts).toBe(1)
    expect(fake.clients).toHaveLength(1)
    expect(fake.clients[0].name).toBe('Test Browser')
    expect(fake.clients[0].tokenHash).toBe(hashToken(token))
    expect(JSON.stringify(fake.clients)).not.toContain(token)
    expect(await handle({ type: 'status', token })).toEqual({
      ok: true,
      result: { state: 'unlocked', paired: true, extensionVersion: '1.2.3' }
    })
  })

  it('refuses to pair when the user denies', async () => {
    const { fake, handle } = setup({ approve: false })
    expect(await handle({ type: 'pair', browser: 'x' })).toEqual({ ok: false, error: 'denied' })
    expect(fake.clients).toHaveLength(0)
  })

  it('reports status without a token but nothing else', async () => {
    const { handle } = setup()
    expect(await handle({ type: 'status' })).toEqual({
      ok: true,
      result: { state: 'unlocked', paired: false, extensionVersion: '1.2.3' }
    })
    for (const request of [
      { type: 'logins', token: 'nope', url: 'https://example.com' },
      { type: 'fill', token: 'nope', url: 'https://example.com', entryId: 'sub' }
    ] as BridgeRequest[]) {
      expect(await handle(request)).toEqual({ ok: false, error: 'not-paired' })
    }
  })

  it('lists matching logins without passwords, best match first', async () => {
    const { handle, token } = await paired()
    const response = await handle({ type: 'logins', token, url: 'https://login.example.com/x' })
    expect(response).toEqual({
      ok: true,
      result: [
        { id: 'exact', title: 'exact', username: 'exact-user' },
        { id: 'fav', title: 'fav', username: 'fav-user' },
        { id: 'sub', title: 'sub', username: 'sub-user' }
      ]
    })
    expect(JSON.stringify(response)).not.toContain('-pass')
  })

  it('fills only logins that match the page', async () => {
    const { handle, token } = await paired()
    expect(
      await handle({ type: 'fill', token, url: 'https://example.com', entryId: 'sub' })
    ).toEqual({ ok: true, result: { username: 'sub-user', password: 'sub-pass' } })
    expect(
      await handle({ type: 'fill', token, url: 'https://example.com', entryId: 'other' })
    ).toEqual({ ok: false, error: 'no-match' })
    expect(await handle({ type: 'fill', token, url: 'https://evil.io', entryId: 'sub' })).toEqual({
      ok: false,
      error: 'no-match'
    })
  })

  it('refuses logins and fills while the vault is locked', async () => {
    const { fake, handle, token } = await paired()
    fake.state = 'locked'
    expect(await handle({ type: 'logins', token, url: 'https://example.com' })).toEqual({
      ok: false,
      error: 'locked'
    })
    expect(
      await handle({ type: 'fill', token, url: 'https://example.com', entryId: 'sub' })
    ).toEqual({ ok: false, error: 'locked' })
  })

  it('rejects malformed requests', async () => {
    const { handle, token } = await paired()
    expect(await handle({ type: 'nope' } as unknown as BridgeRequest)).toEqual({
      ok: false,
      error: 'bad-request'
    })
    expect(
      await handle({ type: 'logins', token, url: 42 } as unknown as BridgeRequest)
    ).toMatchObject({ ok: false, error: 'bad-request' })
  })
})

describe('native host relay', () => {
  /** Bundles the real host and runs it with Node, the way a browser would launch it. */
  type Message = Record<string, unknown>

  async function startHost(
    socketPath: string,
    dir: string
  ): Promise<{
    child: ChildProcessWithoutNullStreams
    next: (match: (m: Message) => boolean) => Promise<Message>
    send: (message: unknown) => void
  }> {
    const outfile = join(dir, 'native-host.js')
    await build({
      entryPoints: [join(__dirname, '../src/main/browser/native-host.ts')],
      outfile,
      bundle: true,
      platform: 'node',
      logLevel: 'silent'
    })
    const child = spawn(process.execPath, [outfile], {
      env: { ...process.env, PM_SOCKET: socketPath }
    }) as ChildProcessWithoutNullStreams
    const decoder = new FrameDecoder()
    const messages: unknown[] = []
    const waiters: (() => void)[] = []
    child.stdout.on('data', (chunk: Buffer) => {
      messages.push(...decoder.push(chunk))
      waiters.splice(0).forEach((wake) => wake())
    })
    const next = async (match: (m: Message) => boolean): Promise<Message> => {
      for (;;) {
        const index = messages.findIndex((m) => match(m as Message))
        if (index >= 0) return messages.splice(index, 1)[0] as Message
        await new Promise<void>((wake) => waiters.push(wake))
      }
    }
    const send = (message: unknown): void => void child.stdin.write(encodeFrame(message))
    return { child, next, send }
  }

  it('relays requests to the app and reports when the app is not running', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pm-bridge-'))
    dirs.push(dir)
    const socketPath =
      process.platform === 'win32' ? `\\\\.\\pipe\\pm-test-${process.pid}` : join(dir, 's.sock')
    const { handle, token } = await paired()

    const host = await startHost(socketPath, dir)
    try {
      // No app listening yet
      host.send({ id: 1, type: 'status' })
      expect(await host.next((m) => m.id === 1)).toEqual({
        id: 1,
        ok: false,
        error: 'not-running'
      })

      const server = new BridgeServer(socketPath, handle)
      await server.start()
      await host.next((m) => m.event === 'connected')

      host.send({ id: 2, type: 'fill', token, url: 'https://example.com', entryId: 'sub' })
      expect(await host.next((m) => m.id === 2)).toEqual({
        id: 2,
        ok: true,
        result: { username: 'sub-user', password: 'sub-pass' }
      })

      server.notify()
      await host.next((m) => m.event === 'status')

      await server.stop()
      await host.next((m) => m.event === 'disconnected')
    } finally {
      host.child.kill()
    }
  })
})
