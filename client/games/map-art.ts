import { atom, useAtomValue } from 'jotai'
import { useEffect } from 'react'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { getMinimapUrl } from '../../common/games/game-stats'
import { TypedIpcRenderer } from '../../common/ipc'
import { getMapKey, TilesetId } from '../../common/maps'
import { jotaiStore } from '../jotai-store'

const ipcRenderer = new TypedIpcRenderer()

export interface MapArt {
  url: string
  /** Whether it's the map itself, rather than a sample of its tileset's terrain. */
  isMap: boolean
}

/** The pictures of maps the game has saved, by `getMapKey`. */
const minimapsByMapAtom = atom<Readonly<Record<string, string>>>({})

let listening = false

function loadMinimaps() {
  ipcRenderer
    .invoke('gameStatsMinimapsByMap')
    ?.then(minimaps => jotaiStore.set(minimapsByMapAtom, minimaps))
    .catch(swallowNonBuiltins)
}

/** Loads the pictures, and again after each game, which may have saved a new one. */
function startLoadingMinimaps() {
  if (listening) {
    return
  }
  listening = true
  loadMinimaps()
  ipcRenderer.on('activeGameStats', loadMinimaps)
}

/**
 * A picture to show behind a map's name: the map itself if any game on it saved one, otherwise a
 * sample of its tileset's terrain, or undefined if neither is known.
 */
export function useMapArt(mapName: string, tileset: TilesetId | undefined): MapArt | undefined {
  useEffect(() => {
    startLoadingMinimaps()
  }, [])
  const minimap = useAtomValue(minimapsByMapAtom)[getMapKey(mapName)]
  if (minimap) {
    return { url: getMinimapUrl(minimap), isMap: true }
  }
  return tileset
    ? { url: `ggstats://app/assets/minimaps/${tileset}.webp`, isMap: false }
    : undefined
}
