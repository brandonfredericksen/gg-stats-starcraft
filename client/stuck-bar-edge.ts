import { atom, useSetAtom } from 'jotai'
import { useEffect } from 'react'

/** How far below a bar stuck to the top of the content panel its edge reaches. */
export const STUCK_EDGE_PX = 12

/**
 * The edge under a stuck bar, so what scrolls beneath it isn't cut off mid line: a 1px line, then
 * a shadow fading out. `top` is where in the image the edge starts.
 */
export function stuckEdgeGradient(top: string) {
  return `linear-gradient(
    transparent ${top},
    var(--theme-outline-variant) 0 calc(${top} + 1px),
    rgb(0 0 0 / 0.3) 0,
    transparent
  )`
}

/**
 * How far below the content panel's top the bar stuck there ends, while one is. The panel draws
 * the bar's edge across its scrollbar, which the page beneath it can't paint into.
 */
export const stuckBarBottomAtom = atom<number | undefined>(undefined)

/** Tells the content panel where the page's stuck bar ends, or that none is stuck. */
export function useStuckBarBottom(bottom: number | undefined) {
  const setBottom = useSetAtom(stuckBarBottomAtom)
  useEffect(() => {
    setBottom(bottom)
    return () => setBottom(undefined)
  }, [bottom, setBottom])
}
