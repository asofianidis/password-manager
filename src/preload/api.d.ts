import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface AppInfo {
    name: string
    version: string
    electron: string
    chrome: string
    node: string
  }

  interface Api {
    ping: () => Promise<string>
    getAppInfo: () => Promise<AppInfo>
  }

  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
