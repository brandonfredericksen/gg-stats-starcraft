import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * Ends the StarCraft this app launched for `gameId`. It's found by the game id the app put on its
 * command line, so a StarCraft the app didn't start is never touched. Does nothing if it already
 * exited.
 */
export async function stopLaunchedGame(gameId: string) {
  // The id goes into a query, so only ids made of the characters the app's ids use are allowed.
  if (!/^[\w-]+$/.test(gameId)) {
    throw new Error(`Not stopping game ${gameId}, since its id can't be matched safely`)
  }
  const filter = `Name = 'StarCraft.exe' AND CommandLine LIKE '%${gameId}%'`
  await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "${filter}" | ` +
        'ForEach-Object { Stop-Process -Id $_.ProcessId -Force }',
    ],
    { windowsHide: true },
  )
}
