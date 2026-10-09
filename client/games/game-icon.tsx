import { atom, useAtomValue } from 'jotai'
import { useEffect } from 'react'
import styled from 'styled-components'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { GAME_ICONS_SHEET_URL, GameIconsManifest, getGameIconIndex } from '../../common/game-icons'
import { TypedIpcRenderer } from '../../common/ipc'
import { jotaiStore } from '../jotai-store'

const ipcRenderer = new TypedIpcRenderer()

/** The icons saved from the player's StarCraft, or undefined until a game has saved them. */
const gameIconsAtom = atom<GameIconsManifest | undefined>(undefined)

let listening = false

function loadGameIcons() {
  ipcRenderer
    .invoke('gameIconsGet')
    ?.then(manifest => jotaiStore.set(gameIconsAtom, manifest))
    .catch(swallowNonBuiltins)
}

/**
 * Loads the icons, and again after each game, since the first game that runs is what saves them,
 * and a later one can swap SD icons for HD. Only the first call does anything.
 */
function startLoadingGameIcons() {
  if (listening) {
    return
  }
  listening = true
  loadGameIcons()
  ipcRenderer.on('activeGameStats', loadGameIcons)
}

function useGameIcons() {
  useEffect(() => {
    startLoadingGameIcons()
  }, [])
  return useAtomValue(gameIconsAtom)
}

const Icon = styled.span<{ $size: number }>`
  width: ${props => props.$size}px;
  height: ${props => props.$size}px;
  flex: none;
  display: inline-block;
  vertical-align: middle;
  background-color: currentColor;
  mask-repeat: no-repeat;
`

/**
 * The game's own command card icon for a unit, building, tech or upgrade, by its build key (`u65`,
 * `t5`, `g3.1`), in the color of the text around it unless given one, the way the game tints its
 * icons. Shows nothing until a game has saved the icons from the player's install.
 */
export function GameIcon({
  buildKey,
  size = 20,
  color,
  className,
}: {
  buildKey: string
  size?: number
  color?: string
  className?: string
}) {
  const manifest = useGameIcons()
  const index = manifest ? getGameIconIndex(manifest, buildKey) : undefined
  if (!manifest || index === undefined) {
    return null
  }
  const column = index % manifest.columns
  const row = Math.floor(index / manifest.columns)
  return (
    <Icon
      className={className}
      $size={size}
      aria-hidden={true}
      style={{
        backgroundColor: color,
        maskImage: `url("${GAME_ICONS_SHEET_URL}?v=${manifest.version}-${manifest.hd}")`,
        maskSize: `${manifest.columns * size}px auto`,
        maskPosition: `${-column * size}px ${-row * size}px`,
      }}
    />
  )
}
