import { css } from 'styled-components'

/** A soft drop shadow that grows with depth, plus a hairline so edges show on any surface. */
function shadowDef(offset: number, blur: number, opacity: number) {
  return `
    0px ${offset}px ${blur}px rgb(0 0 0 / ${opacity}),
    0px 0px 0px 1px var(--theme-outline-variant)
  `
}

export const shadowDef1dp = shadowDef(1, 3, 0.12)
export const shadowDef3dp = shadowDef(4, 12, 0.16)
export const shadowDef6dp = shadowDef(8, 24, 0.2)
export const shadowDef8dp = shadowDef(12, 32, 0.24)
export const shadowDef12dp = shadowDef(16, 48, 0.28)

export type ShadowLevel = 0 | 1 | 3 | 6 | 8 | 12

const shadowsByDepth: Readonly<Record<ShadowLevel, string>> = {
  0: 'none',
  1: shadowDef1dp,
  3: shadowDef3dp,
  6: shadowDef6dp,
  8: shadowDef8dp,
  12: shadowDef12dp,
}

function shadow(depth: ShadowLevel) {
  return css`
    box-shadow: ${shadowsByDepth[depth]};
    z-index: ${depth};
  `
}

export const elevationZero = shadow(0)
export const elevationPlus1 = shadow(1)
export const elevationPlus2 = shadow(3)
export const elevationPlus3 = shadow(6)
export const elevationPlus4 = shadow(8)
export const elevationPlus5 = shadow(12)
