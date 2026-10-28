import fs, { promises as fsPromises } from 'fs'
import debounce from 'lodash/debounce'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import swallowNonBuiltins from '../common/async/swallow-non-builtins'
import { DEV_INDICATOR } from '../common/flags'
import { DisplayMode } from '../common/settings/blizz-settings'
import { DEFAULT_LOCAL_SETTINGS } from '../common/settings/default-settings'
import { LocalSettings } from '../common/settings/local-settings'
import { findInstallPath } from './find-install-path'
import log from './logger'

const VERSION = 29

/**
 * Where StarCraft is installed, or an empty path when it can't be found, so Settings asks for it
 * rather than reporting a problem with a folder the user never picked.
 */
async function findStarcraftPath() {
  const starcraftPath = await findInstallPath()
  if (!starcraftPath) {
    log.warning("Couldn't find where StarCraft is installed")
  }
  return starcraftPath ?? ''
}

function jsonify(settings: unknown) {
  return JSON.stringify(settings, null, 2)
}

type SettingsEvents<T> = {
  change: [settings: Readonly<Partial<T>>]
}

function getBackupFilepath(filepath: string) {
  return filepath.replace(/\.json$/, '') + '.backup.json'
}

/**
 * Reads a settings file, falling back on its backup when the file is missing or can't be parsed.
 * A file that can't be parsed is set aside rather than deleted, so nothing in it is thrown away.
 * Returns undefined when neither can be read, like on the first run.
 */
export async function readSettingsFile<T>(filepath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fsPromises.readFile(filepath, { encoding: 'utf8' })) as T
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      log.error(`Error reading the settings file ${filepath}, trying its backup: ${err}`)
      await fsPromises
        .rename(filepath, filepath.replace(/\.json$/, '') + `.unreadable-${Date.now()}.json`)
        .catch(swallowNonBuiltins)
    }
  }
  try {
    const restored = JSON.parse(
      await fsPromises.readFile(getBackupFilepath(filepath), { encoding: 'utf8' }),
    ) as T
    log.info(`Restored the settings file ${filepath} from its backup`)
    return restored
  } catch {
    return undefined
  }
}

abstract class SettingsManager<T> extends EventEmitter<SettingsEvents<T>> {
  protected abstract settings: Partial<T>
  protected initialized: Promise<void>
  protected settingsDirty = false

  constructor(
    private settingsName: string,
    protected filepath: string,
    initializeFunc: () => Promise<void>,
  ) {
    super()

    this.initialized = initializeFunc.apply(this).catch(err => {
      log.error(`Error initializing the ${this.settingsName} settings file: ${err.stack ?? err}`)
    })
    this.initialized
      .then(() => {
        this.emitChange()
      })
      .catch(swallowNonBuiltins)
  }

  untilInitialized(): Promise<void> {
    return this.initialized
  }

  async get(): Promise<Partial<T>> {
    await this.initialized
    return this.settings
  }

  /** A copy of the settings file from the last save, to restore from if the file is lost. */
  protected get backupFilepath() {
    return getBackupFilepath(this.filepath)
  }

  /** Saves the settings, then keeps a copy of them to fall back on. */
  protected async writeToDisk(): Promise<void> {
    const contents = jsonify(this.settings)
    await fsPromises.writeFile(this.filepath, contents, { encoding: 'utf8' })
    await fsPromises.writeFile(this.backupFilepath, contents, { encoding: 'utf8' })
  }

  debouncedFileWrite = debounce(() => {
    if (this.settingsDirty) {
      this.settingsDirty = false
      this.writeToDisk().catch(err => {
        this.settingsDirty = true
        log.error(`Error saving the ${this.settingsName} settings file: ${err.stack ?? err}`)
      })
    }
  }, 400)

  saveSettingsToDiskSync() {
    if (this.settingsDirty) {
      this.settingsDirty = false
      try {
        const contents = jsonify(this.settings)
        fs.writeFileSync(this.filepath, contents, { encoding: 'utf8' })
        fs.writeFileSync(this.backupFilepath, contents, { encoding: 'utf8' })
      } catch (err: any) {
        this.settingsDirty = true
        log.error(`Error saving the ${this.settingsName} settings file: ${err.stack ?? err}`)
      }
    }
  }

  async merge(settings: Readonly<Partial<T>>): Promise<void> {
    await this.initialized
    const merged = { ...this.settings, ...settings }
    if (!isDeepStrictEqual(merged, this.settings)) {
      this.settings = merged
      this.emitChange()

      this.settingsDirty = true
      this.debouncedFileWrite()
    }
  }

  protected onFileChange(event: 'change' | 'rename'): void {
    if (event === 'change') {
      this.readFile().catch(err => {
        log.error(
          `Error reading/parsing the ${this.settingsName} settings file: ${err.stack ?? err}`,
        )
      })
    }
  }

  private async readFile(): Promise<void> {
    await this.initialized
    const contents = await fsPromises.readFile(this.filepath, { encoding: 'utf8' })
    const newData = JSON.parse(contents) as T
    if (!isDeepStrictEqual(newData, this.settings)) {
      this.settings = newData
      this.emitChange()
      log.verbose(
        `Got new ${this.settingsName} settings from file change: ${JSON.stringify(this.settings)}`,
      )
    }
  }

  private emitChange(): void {
    this.emit('change', this.settings)
  }
}

function migrateV1MouseSensitivity(oldSens: number | undefined) {
  if (oldSens === undefined) {
    return undefined
  }

  switch (oldSens) {
    case 0:
      return 0
    case 1:
      return 3
    case 2:
      return 5
    case 3:
      return 8
    case 4:
      return 10
    default:
      return 0
  }
}

export class LocalSettingsManager extends SettingsManager<LocalSettings> {
  protected settings!: Partial<LocalSettings>

  constructor(filepath: string) {
    const initializeFunc = async function (this: LocalSettingsManager) {
      const loaded = await readSettingsFile<Partial<LocalSettings>>(this.filepath)
      if (loaded) {
        this.settings = loaded
      }

      if (!this.settings) {
        this.settings = await this.createDefaults()
        await this.writeToDisk()
      } else if (this.settings.version !== VERSION) {
        this.settings = await migrateLocalSettings(this.settings)
        await this.writeToDisk()
      } else {
        // Puts back a settings file restored from its backup, and keeps the backup current for
        // settings saved before there were backups.
        await this.writeToDisk()
      }

      fs.watch(this.filepath, event => this.onFileChange(event))
    }

    super('local', filepath, initializeFunc)
  }

  private async createDefaults(): Promise<LocalSettings> {
    return {
      ...DEFAULT_LOCAL_SETTINGS,
      version: VERSION,
      starcraftPath: await findStarcraftPath(),
      winX: -1,
      winY: -1,
      winWidth: -1,
      winHeight: -1,
      winMaximized: false,
    }
  }

  override async get(): Promise<Partial<LocalSettings>> {
    const settings = await super.get()
    // Remove settings gated by flags, so that you don't have to start a dev client to reset them if
    // they were left on.
    if (!DEV_INDICATOR) {
      delete settings.disableHd
    }
    return settings
  }
}

/** Brings local settings saved by an older version up to the current one. */
// TODO(tec27): Type the old settings files
export async function migrateLocalSettings(
  settings: Partial<LocalSettings>,
): Promise<Partial<LocalSettings>> {
  const newSettings = { ...settings }
  if (!settings.starcraftPath) {
    log.verbose('Migrating old local settings, finding starcraft path')
    newSettings.starcraftPath = await findStarcraftPath()
  }
  if (!settings.version || settings.version < 2) {
    log.verbose('Found settings version 1, migrating to version 2')
    delete (newSettings as any).bwPort
    ;(newSettings as any).mouseSensitivity = migrateV1MouseSensitivity(
      (settings as any).mouseSensitivity,
    )
  }
  if (!settings.version || settings.version < 3) {
    log.verbose('Found settings version 2, migrating to version 3')
    newSettings.winX = -1
    newSettings.winY = -1
    newSettings.winWidth = -1
    newSettings.winHeight = -1
    newSettings.winMaximized = false
  }
  if (!settings.version || settings.version < 4) {
    log.verbose('Found settings version 3, migrating to version 4')
    delete (newSettings as any).renderer
  }
  if (!settings.version || settings.version < 6) {
    log.verbose('Found settings version 5, migrating to version 6')
    newSettings.gameWinWidth = (settings as any).width
    newSettings.gameWinHeight = (settings as any).height

    delete (newSettings as any).width
    delete (newSettings as any).height
    delete (newSettings as any).displayMode
    delete (newSettings as any).maintainAspectRatio
    delete (newSettings as any).mouseSensitivity
  }

  if (!settings.version || settings.version < 7) {
    log.verbose('Found settings version 6, migrating to version 7')
    newSettings.runAppAtSystemStart = true
  }

  if (!settings.version || settings.version < 8) {
    log.verbose('Found settings version 7, migrating to version 8')
    newSettings.runAppAtSystemStartMinimized = false
  }

  // NOTE(tec27): Settings version 9 was reverted in 10, so there's no migration from 8 to 10
  if (settings.version === 9) {
    log.verbose('Found settings version 9, migrating to version 10')
    delete (newSettings as any).trustedDomains
  }

  if (!settings.version || settings.version < 11) {
    log.verbose('Found settings version 10, migrating to version 11')
    newSettings.quickOpenReplays = false
  }

  if (!settings.version || settings.version < 13) {
    log.verbose('Found settings version 12, migrating to version 13')
    // NOTE(tec27): These settings still exist, but the tracking for them before this version
    // was not good, and tracked fullscreen positions as well, so we clear them out now that the
    // tracking is improved.
    delete newSettings.gameWinX
    delete newSettings.gameWinY
    delete newSettings.gameWinWidth
    delete newSettings.gameWinHeight
  }

  if (!settings.version || settings.version < 15) {
    log.verbose('Found settings version 14, migrating to version 15')
    newSettings.winX = -1
    newSettings.winY = -1
    newSettings.winWidth = -1
    newSettings.winHeight = -1
  }

  if (!settings.version || settings.version < 18) {
    log.verbose('Found settings version 17, migrating to version 18')
    // Builds before this version wrote an empty array to mean "use the default replay folder",
    // so it must not be read as "index nothing" now that an empty array is a durable user
    // choice. Dropping the key falls back to the default folder.
    const { replayLibraryFolders } = newSettings
    if (Array.isArray(replayLibraryFolders) && replayLibraryFolders.length === 0) {
      delete newSettings.replayLibraryFolders
    }
  }

  if (!settings.version || settings.version < 20) {
    log.verbose('Found settings version 19, migrating to version 20')
    // The 64-bit client is the default now. The old dev-only 64-bit opt-in flag is dropped
    // rather than carried over, so every install starts on the 64-bit path.
    delete (newSettings as any).launch64Bit
    newSettings.launch32Bit = DEFAULT_LOCAL_SETTINGS.launch32Bit
  }

  if (!settings.version || settings.version < 24) {
    log.verbose('Found settings version 23, migrating to version 24')
    // Games are only analyzed while the app runs, so it now starts with Windows, in the tray.
    // Earlier installs saved the old defaults of off without anyone choosing them.
    newSettings.runAppAtSystemStart = true
    newSettings.runAppAtSystemStartMinimized = true
  }

  if (!settings.version || settings.version < 25) {
    log.verbose('Found settings version 24, migrating to version 25')
    // The app plays no sounds, so it has no volume of its own, and it never plays online, so it has
    // no game server region or network stalls to show.
    delete (newSettings as any).masterVolume
    delete (newSettings as any).gameServerRegion
    delete (newSettings as any).visualizeNetworkStalls
  }

  if (!settings.version || settings.version < 26) {
    log.verbose('Found settings version 25, migrating to version 26')
    // The game doesn't keep the minimap terrain toggle, so there is nothing to store.
    delete (newSettings as any).minimapTerrainHidden
  }

  if (!settings.version || settings.version < 27) {
    log.verbose('Found settings version 26, migrating to version 27')
    // The gameplay defaults presets were removed. Each setting they set is kept as it is.
    delete (newSettings as any).gameDefaultsPreset
  }

  if (!settings.version || settings.version < 28) {
    log.verbose('Found settings version 27, migrating to version 28')
    // Version 24 turned starting with Windows on for everyone. It's off until the user says yes,
    // which the Library asks once.
    newSettings.runAppAtSystemStart = false
    delete newSettings.startWithWindowsOffered
  }

  if (!settings.version || settings.version < 29) {
    log.verbose('Found settings version 28, migrating to version 29')
    // Replays play the way they do in StarCraft itself, so the game's own colors, fog, cursor and
    // camera panning stay as StarCraft has them.
    for (const removed of [
      'colorPreset',
      'startingFog',
      'minimapColorMode',
      'teamColorPreset',
      'ffaColorPreset',
      'teamColorUsage',
      'shuffleColors',
      'customTeamColors',
      'customFfaColors',
      'teamSelfColor',
      'ffaSelfColor',
      'legacyCursorSizing',
      'useCustomCursorSize',
      'customCursorSize',
      'grabPanSensitivityOn',
      'grabPanSensitivity',
      'grabPanInverted',
    ]) {
      delete (newSettings as any)[removed]
    }
  }

  newSettings.version = VERSION
  return newSettings
}

/** The few settings from StarCraft's own file that the game DLL reads, under the names it uses. */
export interface GameScrSettings {
  displayMode?: DisplayMode
  gamma?: number
  selectedSkin?: string
  showBonusSkins?: boolean
  hdGraphicsOn?: boolean
}

/**
 * The user's own StarCraft settings file (`CSettings.json`), which a replay being watched reads and
 * writes like any other StarCraft would. A replay being analyzed gets a copy of it instead, see
 * `writeSilentFile`.
 */
export class StarcraftSettings {
  /**
   * @param filepath the game's normal settings file
   * @param silentDir the folder the copy for analyses is written to
   */
  constructor(
    readonly filepath: string,
    private silentDir: string,
  ) {}

  /** The settings file's contents, or nothing when it doesn't exist yet or can't be read. */
  async read(): Promise<Record<string, unknown>> {
    try {
      const contents = JSON.parse(await fsPromises.readFile(this.filepath, { encoding: 'utf8' }))
      return contents && typeof contents === 'object' ? contents : {}
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        log.error(`Error reading the StarCraft settings file: ${err.stack ?? err}`)
      }
      return {}
    }
  }

  /** What the game DLL reads from the settings file. */
  async forGame(): Promise<GameScrSettings> {
    const settings = await this.read()
    return {
      displayMode: settings.WindowMode as DisplayMode | undefined,
      gamma: settings.Gamma as number | undefined,
      selectedSkin: settings.selectedSkin as string | undefined,
      showBonusSkins: settings.skinsEnabled as boolean | undefined,
      hdGraphicsOn: settings.HDPreferences as boolean | undefined,
    }
  }

  /**
   * Writes the user's settings with every sound turned off and in a window, for a game that runs
   * unseen in the background, and returns where they were written. The game writes its changes to
   * this copy, so none of them reach the user's own file.
   */
  async writeSilentFile(): Promise<string> {
    // Namespaced by GGSTATS_SESSION (like the app's own settings files) so concurrent dev instances
    // don't write over each other's.
    const sessionName = process.env.GGSTATS_SESSION
    const silentFilepath = path.join(
      this.silentDir,
      sessionName ? `CSettings.silent-${sessionName}.json` : 'CSettings.silent.json',
    )
    const silent = {
      ...(await this.read()),
      MusicEnabled: false,
      music: 0,
      SfxEnabled: false,
      sfx: 0,
      WindowMode: DisplayMode.Windowed,
    }
    await fsPromises.writeFile(silentFilepath, jsonify(silent), { encoding: 'utf8' })
    return silentFilepath
  }
}
