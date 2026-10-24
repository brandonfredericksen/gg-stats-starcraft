import { TypedIpcRenderer } from '../common/ipc'
import activeGame from './active-game/ipc-handlers'
import autoCapture from './auto-capture/ipc-handlers'
import { registerReplayStatsStatusHandlers } from './games/replay-stats-status'
import liveGame from './live-game/ipc-handlers'
import replays from './replays/ipc-handlers'
import settings from './settings/ipc-handlers'
import systemBar from './system-bar/ipc-handlers'
import { registerUpdateStatusHandlers } from './updates/update-status'

/** Listens for everything the main process sends the renderer. */
export function registerIpcHandlers() {
  const ipcRenderer = new TypedIpcRenderer()
  for (const register of [activeGame, autoCapture, liveGame, replays, settings, systemBar]) {
    register({ ipcRenderer })
  }
  registerReplayStatsStatusHandlers()
  registerUpdateStatusHandlers()
}
