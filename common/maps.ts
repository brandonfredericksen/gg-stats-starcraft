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
