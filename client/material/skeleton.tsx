import styled, { keyframes } from 'styled-components'

const pulse = keyframes`
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
`

/**
 * A gently pulsing bar that stands in for text still loading. It sits inline in the text it
 * replaces, so the line keeps the height the real text will have and nothing moves when it loads.
 */
export const SkeletonText = styled.span<{ $width: string }>`
  display: inline-block;
  width: ${props => props.$width};
  max-width: 100%;
  height: 0.8em;
  vertical-align: middle;

  border-radius: 4px;
  background: rgb(from var(--theme-skeleton) r g b / 0.6);
  animation: ${pulse} 1.4s ease-in-out infinite;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`
