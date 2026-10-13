/**
 * Lowercase, file/URL-safe identifiers for the tilesets that have dedicated preview art (the
 * team-color settings' minimap previews, `client/settings/game/team-color-preview.tsx`).
 * Installation is excluded: it only appears in the campaign and rare UMS maps, so no preview art is
 * maintained for it.
 */
export type TilesetId = 'jungle' | 'badlands' | 'desert' | 'ice' | 'space' | 'twilight' | 'ashworld'

/** Every preview {@link TilesetId}, in the order they should be offered/cycled in the UI. */
export const ALL_TILESET_IDS: ReadonlyArray<TilesetId> = [
  'jungle',
  'badlands',
  'desert',
  'ice',
  'space',
  'twilight',
  'ashworld',
]

/**
 * The tileset each value of a map's `ERA ` section names, in StarCraft's order. Installation is
 * `undefined`, since it has no {@link TilesetId}.
 */
const ERA_TILESETS: ReadonlyArray<TilesetId | undefined> = [
  'badlands',
  'space',
  undefined,
  'ashworld',
  'jungle',
  'desert',
  'ice',
  'twilight',
]

/** The tileset a map's `ERA ` value names. StarCraft only reads its low 3 bits. */
export function tilesetFromEra(era: number | null | undefined): TilesetId | undefined {
  return era === null || era === undefined ? undefined : ERA_TILESETS[era & 7]
}

/**
 * Flat fallback colors for each preview tileset, sampled from their terrain. Used before a minimap
 * render has loaded, or if one fails to load.
 */
export const TILESET_PLACEHOLDER_COLORS: Readonly<Record<TilesetId, string>> = {
  jungle: '#081208',
  badlands: '#1b1310',
  desert: '#1a1206',
  ice: '#0c1218',
  space: '#05070d',
  twilight: '#0d0a14',
  ashworld: '#120a08',
}

/**
 * What a map is told apart by when matching its games: its name, without color codes, case or the
 * spaces around it, since replays and the game spell it a little differently.
 */
export function getMapKey(mapName: string): string {
  return filterColorCodes(mapName).trim().toLowerCase()
}

/**
 * Filters out unprintable characters used for color codes in BW (we don't utilize these in our
 * client, and they just show up as tofu).
 */
export function filterColorCodes(str: string): string {
  return Array.from(str)
    .filter(c => {
      const code = c.charCodeAt(0)
      return (
        code > 0x1f ||
        /** newline */
        code === 0x0a ||
        /** carriage return */
        code === 0x0d
      )
    })
    .join('')
}
