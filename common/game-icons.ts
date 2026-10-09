/**
 * The list the game DLL saves next to its sheet of StarCraft's command card icons, read from the
 * player's own install: where each icon is on the sheet, and which icon each unit, upgrade and
 * tech uses.
 */
export interface GameIconsManifest {
  version: number
  /** Whether the icons are the HD ones, rather than the small SD ones. */
  hd: boolean
  /** Each icon's square on the sheet, in pixels. */
  cellSize: number
  /** Icons in each row of the sheet. */
  columns: number
  count: number
  /** The icon of each unit and building, by unit id. */
  units: number[]
  /** The icon of each upgrade, by upgrade id. */
  upgrades: number[]
  /** The icon of each tech, by tech id. */
  techs: number[]
}

/** Where the renderer loads the icon sheet from. */
export const GAME_ICONS_SHEET_URL = 'ggstats://app/game-icons/cmdicons.png'

/**
 * The icon on the sheet for a build key (`u111`, `t5` or `g33.1`), if the manifest has one for
 * it.
 */
export function getGameIconIndex(
  manifest: GameIconsManifest,
  buildKey: string,
): number | undefined {
  const [, kind, id] = /^([utg])(\d+)/.exec(buildKey) ?? []
  const list = { u: manifest.units, t: manifest.techs, g: manifest.upgrades }[kind ?? '']
  const index = list?.[Number(id)]
  return index !== undefined && index < manifest.count ? index : undefined
}
