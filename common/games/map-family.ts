/**
 * Maps that are played so differently they need their own benchmarks: money maps, where income is
 * so high that spending decides games, rather than worker counts.
 */
export type MapFamily = 'fastest' | 'bgh' | 'standard'

/**
 * Groups a map by its name. Money maps are uploaded under many names and versions ("Fastest
 * Possible Map ver 1.4", "Fastest 2v2", "Fastest3v3", "Big Game Hunters", "BGH3v3", "Big Hunters"
 * with Korean notes after it), so the name is matched loosely, even inside a longer word. Big
 * Hunters is played as Big Game Hunters, so it's grouped with it.
 */
export function getMapFamily(mapName: string): MapFamily {
  const name = mapName.toLowerCase()
  if (name.includes('fastest')) {
    return 'fastest'
  }
  if (name.includes('bgh') || /big\s*(game\s*)?hunters?/.test(name)) {
    return 'bgh'
  }
  return 'standard'
}
