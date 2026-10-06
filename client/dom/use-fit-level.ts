import { useLayoutEffect, useState } from 'react'

/**
 * How far a one row bar has to compact to fit: level 0 shows everything, and each level up should
 * give up a little more room. Starts again from 0 whenever the bar's width or `contentKey` changes
 * (anything that changes how wide its contents are, like a label), then steps up while its
 * contents overflow. That all happens before the browser paints, so no step is ever seen.
 *
 * The bar must overflow rather than wrap or shrink its contents away, so its scroll width shows
 * when they don't fit.
 */
export function useFitLevel<T extends HTMLElement>(
  maxLevel: number,
  contentKey: string,
): [ref: React.RefCallback<T>, level: number] {
  const [elem, setElem] = useState<T | null>(null)
  const [width, setWidth] = useState(0)
  const [fit, setFit] = useState({ key: '', level: 0 })

  useLayoutEffect(() => {
    if (!elem) {
      return undefined
    }
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(elem)
    return () => observer.disconnect()
  }, [elem])

  const key = `${width}|${contentKey}`
  const level = fit.key === key ? fit.level : 0

  // Only the browser knows whether a level fits, so each one is measured once it's laid out.
  useLayoutEffect(() => {
    if (elem && level < maxLevel && elem.scrollWidth > elem.clientWidth) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- stepping up has to follow the layout it measured, before the browser paints
      setFit({ key, level: level + 1 })
    }
  }, [elem, key, level, maxLevel])

  return [setElem, level]
}
