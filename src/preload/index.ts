import { contextBridge, ipcRenderer } from 'electron'
import { EVENT_CHANNEL, INVOKE_CHANNELS, type IpcResult, type RendererApi } from '../shared/api'
import type { VaultEvent } from '../shared/types'

const allowed = new Set<string>(INVOKE_CHANNELS)

const api: RendererApi = {
  async invoke(channel, ...args) {
    if (!allowed.has(channel)) throw new Error(`Unknown channel: ${channel}`)
    const result = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<never>
    if (!result.ok) throw new Error(result.error)
    return result.data
  },
  onEvent(listener) {
    const handler = (_: Electron.IpcRendererEvent, event: VaultEvent): void => listener(event)
    ipcRenderer.on(EVENT_CHANNEL, handler)
    return () => ipcRenderer.removeListener(EVENT_CHANNEL, handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
