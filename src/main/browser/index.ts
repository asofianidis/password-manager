import { dialog, type BrowserWindow } from 'electron'
import type { BrowserBridgeStatus } from '../../shared/types'
import { settingsStore } from '../settings'
import { vault } from '../vault/vault'
import { BridgeServer, createBridgeHandler } from './bridge'
import { bridgeSocketPath, registerNativeHost } from './install'

/** Lets the browser extension fill logins: see src/shared/browser-protocol.ts */
class BrowserBridge {
  private server: BridgeServer | null = null
  private state: BrowserBridgeStatus = { listening: false, error: null, registered: [] }

  async start(showWindow: () => BrowserWindow): Promise<void> {
    if (this.server) return
    const handle = createBridgeHandler({
      vault,
      clients: () => settingsStore.get().browser.clients,
      addClient: async (client) => {
        await settingsStore.setBrowserClients((clients) => [...clients, client])
      },
      touchClient: (id) =>
        void settingsStore.setBrowserClients((clients) =>
          clients.map((c) => (c.id === id ? { ...c, lastUsedAt: Date.now() } : c))
        ),
      confirmPair: async (browser) => {
        const { response } = await dialog.showMessageBox(showWindow(), {
          type: 'question',
          buttons: ['Allow', 'Deny'],
          defaultId: 1,
          cancelId: 1,
          message: `Allow ${browser} to fill your logins?`,
          detail:
            'The Password Manager extension is asking to connect. While your vault is unlocked, ' +
            'it can fill logins that match the site you are on.\n\n' +
            'Only allow this if you just clicked "Connect" in your browser. You can revoke ' +
            'access in Settings.'
        })
        return response === 0
      },
      showApp: () => void showWindow()
    })

    const socketPath = bridgeSocketPath()
    const server = new BridgeServer(socketPath, handle)
    try {
      await server.start()
      this.server = server
      this.state = { ...this.state, listening: true, error: null }
    } catch (error) {
      this.state = { ...this.state, error: error instanceof Error ? error.message : String(error) }
      return
    }

    for (const event of ['locked', 'unlocked', 'changed'] as const) {
      vault.on(event, () => server.notify())
    }

    try {
      this.state = { ...this.state, registered: await registerNativeHost(socketPath) }
    } catch (error) {
      this.state = { ...this.state, error: error instanceof Error ? error.message : String(error) }
    }
  }

  status(): BrowserBridgeStatus {
    return this.state
  }

  async revoke(id: string): Promise<void> {
    await settingsStore.setBrowserClients((clients) => clients.filter((c) => c.id !== id))
    this.server?.notify()
  }

  async stop(): Promise<void> {
    await this.server?.stop()
    this.server = null
  }
}

export const browserBridge = new BrowserBridge()
