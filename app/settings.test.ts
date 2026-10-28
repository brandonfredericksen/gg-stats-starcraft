import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { LocalSettings } from '../common/settings/local-settings'
import { migrateLocalSettings, readSettingsFile, StarcraftSettings } from './settings'

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
    runAppAtSystemStart: false,
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

    expect(migrated).toEqual({ ...VERSION_24, version: 29 })
  })

  test('drops the minimap terrain toggle from version 25 settings', async () => {
    const migrated = await migrateLocalSettings({
      ...VERSION_24,
      version: 25,
      minimapTerrainHidden: true,
    } as any)

    expect(migrated).toEqual({ ...VERSION_24, version: 29 })
  })

  test('drops the gameplay defaults preset from version 26 settings', async () => {
    const migrated = await migrateLocalSettings({
      ...VERSION_24,
      version: 26,
      gameDefaultsPreset: 'legacy',
    } as any)

    expect(migrated).toEqual({ ...VERSION_24, version: 29 })
  })

  test('turns starting with Windows off, to be asked about once', async () => {
    const migrated = await migrateLocalSettings({
      ...VERSION_24,
      version: 27,
      runAppAtSystemStart: true,
      startWithWindowsOffered: true,
    })

    expect(migrated).toEqual({ ...VERSION_24, version: 29 })
  })

  test('drops the settings for changing how replays play from version 28 settings', async () => {
    const migrated = await migrateLocalSettings({
      ...VERSION_24,
      version: 28,
      startingFog: 'transparent',
      minimapColorMode: 0,
      teamColorPreset: 'coolVsWarm',
      customTeamColors: { self: '#ffffff', allies: [], enemies: [] },
      legacyCursorSizing: false,
      grabPanSensitivity: 40,
    } as any)

    expect(migrated).toEqual({ ...VERSION_24, version: 29 })
  })

  test('leaves current settings as they are', async () => {
    const current = { ...VERSION_24, version: 29 }

    expect(await migrateLocalSettings(current)).toEqual(current)
  })
})

describe('app/settings StarcraftSettings', () => {
  test("hands the game the user's own settings, under the names it reads", async () => {
    const file = path.join(dir, 'CSettings.json')
    await writeFile(
      file,
      JSON.stringify({
        WindowMode: 2,
        Gamma: 110,
        selectedSkin: 'carbot',
        skinsEnabled: true,
        HDPreferences: false,
        sfx: 70,
      }),
    )

    expect(await new StarcraftSettings(file, dir).forGame()).toEqual({
      displayMode: 2,
      gamma: 110,
      selectedSkin: 'carbot',
      showBonusSkins: true,
      hdGraphicsOn: false,
    })
  })

  test('writes a silent, windowed copy and leaves the user file alone', async () => {
    const file = path.join(dir, 'CSettings.json')
    const own = { WindowMode: 1, MusicEnabled: true, music: 80, SfxEnabled: true, sfx: 70, x: 1 }
    await writeFile(file, JSON.stringify(own))

    const silentFile = await new StarcraftSettings(file, dir).writeSilentFile()

    expect(silentFile).not.toBe(file)
    expect(JSON.parse(await readFile(silentFile, 'utf8'))).toEqual({
      WindowMode: 0,
      MusicEnabled: false,
      music: 0,
      SfxEnabled: false,
      sfx: 0,
      x: 1,
    })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(own)
  })

  test('reads nothing when StarCraft has no settings file yet', async () => {
    const settings = new StarcraftSettings(path.join(dir, 'CSettings.json'), dir)

    expect(await settings.read()).toEqual({})
  })
})
