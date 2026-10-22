import { BrowserWindow, ipcMain } from 'electron'
import type { InvokeApi, InvokeChannel, IpcResult } from '../shared/api'
import { EVENT_CHANNEL } from '../shared/api'
import type { VaultEvent } from '../shared/types'
import { vault } from './vault/vault'
import { settingsStore } from './settings'
import { checkStrength, healthReport, summarize } from './strength'
import { generatePassword } from './generator'
import { clearSecret, copySecret } from './clipboard'
import {
  cancelImport,
  commitImport,
  pickImportFile,
  previewImport,
  saveExport
} from './import-export'
import { sync } from './sync/sync'
import { listTailscalePeers } from './sync/tailscale'
import { updater } from './updater'
import { browserBridge } from './browser'
import { setOpenAtLogin } from './login-item'

type Handlers = {
  [C in InvokeChannel]: (
    window: BrowserWindow | null,
    ...args: Parameters<InvokeApi[C]>
  ) => ReturnType<InvokeApi[C]> | Promise<ReturnType<InvokeApi[C]>>
}

const handlers: Handlers = {
  'vault:status': () => vault.status(),
  'vault:create': (_, password) => vault.create(password),
  'vault:unlock': (_, password) => vault.unlock(password),
  'vault:lock': () => vault.lock(),
  'vault:change-master-password': (_, current, next) => vault.changeMasterPassword(current, next),
  'vault:join': async (_, host, port, code, password) => {
    const pairing = await sync.fetchPairing(host, port, code)
    // Also handles a device that already has the vault and is pairing again
    const status = await vault.join(pairing.vaultId, pairing.header, password)
    const peer = await sync.addPeer({ name: pairing.deviceName, host, port })
    await sync.syncAll(peer.id)
    return status
  },
  'vault:adopt-pending-key': (_, password) => vault.adoptPendingKey(password),
  'vault:discard-pending-key': () => vault.discardPendingKey(),
  'vault:revoke-other-devices': (_, password) => vault.revokeOtherDevices(password),

  'entries:list': () => summarize(vault.list(), settingsStore.get().oldPasswordDays),
  'entries:get': (_, id) => vault.get(id),
  'entries:create': (_, input) => vault.createEntry(input),
  'entries:update': (_, id, input) => vault.updateEntry(id, input),
  'entries:delete': (_, id) => vault.deleteEntry(id),
  'entries:copy': (_, id, field) => copySecret(vault.get(id)[field]),

  'health:report': () => healthReport(vault.list(), settingsStore.get().oldPasswordDays),
  'strength:check': (_, password) => checkStrength(password),
  'generator:generate': (_, options) => generatePassword(options),
  'clipboard:copy-secret': (_, text) => copySecret(text),

  'settings:get': () => settingsStore.get(),
  'settings:update': (_, patch) => {
    if (patch.openAtLogin !== undefined) setOpenAtLogin(patch.openAtLogin)
    return settingsStore.update(patch)
  },

  'import:pick-file': (window) => {
    requireUnlocked()
    return pickImportFile(window)
  },
  'import:preview': (_, token, format, password) => previewImport(token, format, password),
  'import:commit': (_, token, skipDuplicates) => commitImport(token, skipDuplicates),
  'import:cancel': (_, token) => cancelImport(token),
  'export:save': (window, format, password) => {
    requireUnlocked()
    return saveExport(window, format, password)
  },

  'sync:status': () => sync.status(),
  'sync:add-peer': (_, peer) => sync.addPeer(peer),
  'sync:remove-peer': (_, id) => sync.removePeer(id),
  'sync:now': (_, peerId) => sync.syncAll(peerId),
  'sync:start-pairing': () => sync.startPairing(),
  'sync:stop-pairing': () => sync.stopPairing(),
  'sync:tailscale-peers': () => listTailscalePeers(),

  'update:status': () => updater.status(),
  'update:check': () => updater.check(),
  'update:install': () => updater.install(),

  'browser:status': () => browserBridge.status(),
  'browser:revoke': (_, id) => browserBridge.revoke(id),
  'browser:check-extension': () => browserBridge.checkExtension(),
  'browser:reveal-extension': () => browserBridge.revealExtension()
}

function requireUnlocked(): void {
  if (!vault.isUnlocked) throw new Error('Vault is locked')
}

export function registerIpc(
  isTrustedSender: (event: Electron.IpcMainInvokeEvent) => boolean
): void {
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (event, ...args): Promise<IpcResult<unknown>> => {
      if (!isTrustedSender(event)) return { ok: false, error: 'Untrusted sender' }
      try {
        const window = BrowserWindow.fromWebContents(event.sender)
        const data = await (handler as (...a: unknown[]) => unknown)(window, ...args)
        return { ok: true, data }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    })
  }
}

export function broadcast(event: VaultEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(EVENT_CHANNEL, event)
  }
}

export function wireEvents(): void {
  vault.on('locked', () => {
    clearSecret()
    broadcast('locked')
  })
  vault.on('changed', () => broadcast('changed'))
  sync.on('status', () => broadcast('sync-status'))
  updater.on('status', () => broadcast('update-status'))
  settingsStore.onChange(() => {
    void sync.reconcile()
  })
}
