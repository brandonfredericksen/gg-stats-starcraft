import styled from 'styled-components'
import { ContainerLevel, containerStyles } from '../styles/colors'

export const Card = styled.div`
  ${containerStyles(ContainerLevel.Low)}
  border: 1px solid var(--theme-outline-variant);
  border-radius: var(--radius-lg);
  /* TODO(tec27): there's probably places we don't want 16px padding (full bleed images), */
  /* figure out a good way to handle that */
  padding: 16px;
`
