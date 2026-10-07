import { getKnownMapName } from './map-names'

/**
 * Maps that are played so differently they need their own benchmarks: money maps, where income is
 * so high that spending decides games, rather than worker counts.
 */
export type MapFamily = 'fastest' | 'bgh' | 'standard'

/**
 * Groups a map by its name. Money maps are uploaded under many names and versions ("Fastest
 * Possible Map ver 1.4", "Fastest 2v2", "Fastest3v3", "Big Game Hunters", "BGH3v3", "Big Hunters"
 * with Korean notes after it), so the name is matched loosely, even inside a longer word. Big
 * Hunters is played as Big Game Hunters, so it's grouped with it. Korean uploads go by 빠른무한
 * (Fastest) and 빅헌터 (Big Hunters), and Fastest is often spelled with a section sign for each S.
 */
export function getMapFamily(mapName: string): MapFamily {
  const name = mapName.toLowerCase().replaceAll('§', 's')
  if (name.includes('fastest') || /빠른\s*무한|빠무|빨무/.test(name)) {
    return 'fastest'
  }
  if (name.includes('bgh') || /big\s*(game\s*)?hunters?|빅\s*(게임\s*)?헌터/.test(name)) {
    return 'bgh'
  }
  return 'standard'
}

/**
 * A map's own name, without what one upload of it adds: versions ("Polypoid 1.65", "Fighting
 * Spirit ver 1.3"), tags ("| iCCup |", "[AI]", "(2)"), a "Remastered" that's sometimes cut short,
 * and the color codes StarCraft map names can carry. A name that's nothing but those stays as it is.
 */
export function getMapBaseName(mapName: string): string {
  const visible = Array.from(mapName)
    .filter(char => {
      const code = char.charCodeAt(0)
      return code >= 0x20 && code !== 0x7f
    })
    .join('')
  const base = visible
    .replace(/_/g, ' ')
    .replace(/\[[^\]]*\]|\([^)]*\)|\|[^|]*\|/g, ' ')
    .replace(/\biccup\b/gi, ' ')
    .replace(/\bremaster\w*/gi, ' ')
    .replace(/\b(ver|v)\.?\s*\d+(\.\d+)*[a-z]?\b/gi, ' ')
    .replace(/(^|\s)\d+(\.\d+)*[a-z]?(?=\s|$)/gi, ' ')
    .replace(/[_\-:.,!|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return base || visible.trim()
}

/**
 * The name to show for a map: the one it goes by in English when it's a known map, uploaded in
 * Korean or tagged by a league, and otherwise its own name without what one upload adds.
 */
export function getMapDisplayName(mapName: string): string {
  const baseName = getMapBaseName(mapName)
  return getKnownMapName(baseName) ?? baseName
}

/** The map a name is a version of, to group by. See `getMapDisplayName`. */
export function getMapKey(mapName: string): string {
  return getMapDisplayName(mapName).toLowerCase()
}
