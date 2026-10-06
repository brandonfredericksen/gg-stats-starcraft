import { css } from 'styled-components'
import { standardEasing } from './curve-constants'

// Only movement animates. Colors, borders and shadows change at once on hover and press, since
// fading them makes the UI feel like it lags the mouse.
export const fastOutSlowInShort = css`
  transition: opacity, transform;
  transition-duration: 250ms;
  transition-timing-function: ${standardEasing};
`

export const fastOutSlowInNormal = css`
  transition: opacity, transform;
  transition-duration: 400ms;
  transition-timing-function: ${standardEasing};
`
