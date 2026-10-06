import { WebUtils } from 'electron'

// NOTE(tec27): This should match the preload.js file's definition
interface GgStatsElectronApi {
  ipcRenderer: {
    invoke(channel: string, ...args: any[]): Promise<any>
    send(channel: string, ...args: any[]): void
    on(channel: string, listener: (event: any, ...args: any[]) => void): void
    once(channel: string, listener: (event: any, ...args: any[]) => void): void
    removeAllListeners(channel: string): void
    removeListener(channel: string, listener: (event: any, ...args: any[]) => void): void
  }
  env: Record<string, string | undefined>
  webUtils: WebUtils
}

declare global {
  interface Window {
    GGSTATS_ELECTRON_API?: GgStatsElectronApi
  }
}
