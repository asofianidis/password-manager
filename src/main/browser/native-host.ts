/**
 * Native messaging host. The browser starts this (via the wrapper script written by install.ts,
 * which runs the app binary with ELECTRON_RUN_AS_NODE) and talks to it over stdin/stdout. It
 * relays each message to the running app over a local socket and relays replies back.
 *
 * It must not import electron: it runs in plain Node mode.
 */
import { connect, type Socket } from 'net'
import { spawn } from 'child_process'
import { dirname } from 'path'
import type { BridgeEnvelope, BridgeEvent, BridgeReply } from '../../shared/browser-protocol'
import { FrameDecoder, LineDecoder, encodeFrame, encodeLine } from './framing'

const SOCKET_PATH = process.env['PM_SOCKET']
/** What to launch when the extension asks to show the app and it isn't running */
const APP_PATH = process.env['PM_APP']
const RECONNECT_MS = 2000

let socket: Socket | null = null
let launched = false
/** Requests that arrive before the first connection attempt settles */
let queued: BridgeEnvelope[] | null = []
/** Requests sent to the app that haven't been answered, failed if the app goes away */
const inFlight = new Set<number>()

function send(message: BridgeReply | BridgeEvent): void {
  process.stdout.write(encodeFrame(message))
}

function launchApp(): void {
  if (!APP_PATH || launched) return
  launched = true
  const env = { ...process.env }
  delete env['ELECTRON_RUN_AS_NODE']
  delete env['PM_SOCKET']
  delete env['PM_APP']
  // On macOS, go through Launch Services so the app starts as a normal app bundle
  const [command, args] =
    process.platform === 'darwin' && APP_PATH.endsWith('.app')
      ? ['open', ['-a', APP_PATH]]
      : [APP_PATH, []]
  spawn(command, args, { detached: true, stdio: 'ignore', env, cwd: dirname(APP_PATH) }).unref()
}

/** Answers requests while the app isn't reachable. */
function handleOffline(request: BridgeEnvelope): void {
  if (request.type === 'show' && APP_PATH) {
    launchApp()
    send({ id: request.id, ok: true, result: null })
  } else {
    send({ id: request.id, ok: false, error: 'not-running' })
  }
}

function flushQueue(): void {
  const requests = queued ?? []
  queued = null
  for (const request of requests) dispatch(request)
}

function dispatch(request: BridgeEnvelope): void {
  if (queued) queued.push(request)
  else if (socket) {
    inFlight.add(request.id)
    socket.write(encodeLine(request))
  } else handleOffline(request)
}

function connectToApp(): void {
  if (!SOCKET_PATH) return flushQueue()
  const attempt = connect(SOCKET_PATH)
  const lines = new LineDecoder()
  attempt.on('connect', () => {
    socket = attempt
    send({ event: 'connected' })
    flushQueue()
  })
  attempt.on('data', (chunk) => {
    for (const message of lines.push(chunk) as (BridgeReply | BridgeEvent)[]) {
      if ('id' in message) inFlight.delete(message.id)
      send(message)
    }
  })
  attempt.on('error', () => attempt.destroy())
  attempt.on('close', () => {
    if (socket === attempt) {
      socket = null
      launched = false
      for (const id of inFlight) send({ id, ok: false, error: 'not-running' })
      inFlight.clear()
      send({ event: 'disconnected' })
    }
    flushQueue()
    setTimeout(connectToApp, RECONNECT_MS).unref()
  })
}

const frames = new FrameDecoder()
process.stdin.on('data', (chunk: Buffer) => {
  let messages: unknown[]
  try {
    messages = frames.push(chunk)
  } catch {
    process.exit(1)
  }
  for (const message of messages) dispatch(message as BridgeEnvelope)
})
// The browser closes stdin when the extension disconnects
process.stdin.on('end', () => process.exit(0))

connectToApp()
