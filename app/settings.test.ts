import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { LocalSettings } from '../common/settings/local-settings'
import { migrateLocalSettings, readSettingsFile } from './settings'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
vi.mock('@shieldbattery/windows-registry', () => ({
  HKCU: 'HKCU',
  HKLM: 'HKLM',
  REG_SZ: 'REG_SZ',
  WindowsRegistry: class {},
}))
vi.mock('./logger', () => ({
  default: { verbose: () => {}, info: () => {}, warning: () => {}, error: () => {} },
}))

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'gg-stats-settings-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('app/settings', () => {
  test('reads the settings file when it can', async () => {
    const file = path.join(dir, 'settings.json')
    await writeFile(file, JSON.stringify({ myPlayerNames: ['mezee'] }))
    await writeFile(path.join(dir, 'settings.backup.json'), JSON.stringify({ myPlayerNames: [] }))

    expect(await readSettingsFile(file)).toEqual({ myPlayerNames: ['mezee'] })
  })

  test('falls back on the backup when the settings file is missing', async () => {
    const file = path.join(dir, 'settings.json')
    await writeFile(path.join(dir, 'settings.backup.json'), JSON.stringify({ version: 24 }))

    expect(await readSettingsFile(file)).toEqual({ version: 24 })
  })

  test('sets an unreadable settings file aside and falls back on the backup', async () => {
    const file = path.join(dir, 'settings.json')
    await writeFile(file, '{"myPlayerNames": ["mez')
    await writeFile(path.join(dir, 'settings.backup.json'), JSON.stringify({ version: 24 }))

    expect(await readSettingsFile(file)).toEqual({ version: 24 })
    const files = await readdir(dir)
    const setAside = files.find(name => name.startsWith('settings.unreadable-'))
    expect(setAside).toBeDefined()
    expect(await readFile(path.join(dir, setAside!), 'utf8')).toBe('{"myPlayerNames": ["mez')
  })

  test('reads nothing on a first run, with no file and no backup', async () => {
    expect(await readSettingsFile(path.join(dir, 'settings.json'))).toBeUndefined()
  })
})

describe('app/settings migrateLocalSettings', () => {
  const VERSION_24: Partial<LocalSettings> = {
    version: 24,
    starcraftPath: 'C:\\StarCraft',
    runAppAtSystemStart: true,
    runAppAtSystemStartMinimized: true,
    myPlayerNames: ['mezee'],
    themeMode: 'dark',
    winWidth: 1280,
  }

  test('drops the settings for online play from version 24 settings and keeps the rest', async () => {
    const migrated = await migrateLocalSettings({
      ...VERSION_24,
      masterVolume: 50,
      gameServerRegion: 'us-west',
      visualizeNetworkStalls: true,
    } as any)

    expect(migrated).toEqual({ ...VERSION_24, version: 26 })
  })

  test('drops the minimap terrain toggle from version 25 settings', async () => {
    const migrated = await migrateLocalSettings({
      ...VERSION_24,
      version: 25,
      minimapTerrainHidden: true,
    } as any)

    expect(migrated).toEqual({ ...VERSION_24, version: 26 })
  })

  test('leaves current settings as they are', async () => {
    const current = { ...VERSION_24, version: 26 }

    expect(await migrateLocalSettings(current)).toEqual(current)
  })
})
