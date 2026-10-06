import styled, { css } from 'styled-components'

export const singleLine = css`
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

/**
 * The interface face. Segoe UI Variable ships with Windows 11 and adjusts its shapes to the size
 * it's shown at; Windows 10 falls back to Segoe UI.
 */
export const segoeUi = css`
  font-family:
    'Segoe UI Variable Text', 'Segoe UI Variable', 'Segoe UI', 'Noto Color Emoji', sans-serif;
  font-synthesis: style small-caps;
`

/**
 * The display face for big titles, names and numbers. Bahnschrift ships with Windows 10 and up, and
 * its semi condensed width fits long player names and wide numbers.
 */
export const bahnschrift = css`
  font-family: Bahnschrift, 'Segoe UI Variable Display', 'Segoe UI', 'Noto Color Emoji', sans-serif;
  font-stretch: semi-condensed;
  font-synthesis: style small-caps;
`

// TODO(gg-stats): Switch the remaining users of these names over to `segoeUi` and `bahnschrift`,
// then delete them.
export const inter = segoeUi
export const sofiaSans = segoeUi
export const sofiaSansCondensed = bahnschrift

export const bodySmall = css`
  font-size: 12px;
  font-weight: 400;
  letter-spacing: 0.4px;
  line-height: 16px;
`

export const BodySmall = styled.div`
  ${bodySmall};
`

export const bodyMedium = css`
  font-size: 14px;
  font-weight: 400;
  letter-spacing: 0px;
  line-height: 20px;
`

export const BodyMedium = styled.div`
  ${bodyMedium};
`

export const bodyLarge = css`
  font-size: 16px;
  font-weight: 400;
  letter-spacing: 0px;
  line-height: 24px;
`

export const BodyLarge = styled.div`
  ${bodyLarge};
`

export const labelSmall = css`
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.5px;
  line-height: 16px;
`

export const LabelSmall = styled.div`
  ${labelSmall};
`

export const labelMedium = css`
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.48px;
  line-height: 16px;
`

export const LabelMedium = styled.div`
  ${labelMedium};
`

export const labelLarge = css`
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.3px;
  line-height: 20px;
`

export const LabelLarge = styled.div`
  ${labelLarge};
`

export const titleTiny = css`
  ${segoeUi};
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.4px;
  line-height: 16px;
`

export const TitleTiny = styled.div`
  ${titleTiny};
`

export const titleSmall = css`
  ${segoeUi};
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.4px;
  line-height: 20px;
`

export const TitleSmall = styled.div`
  ${titleSmall};
`

export const titleMedium = css`
  ${segoeUi};
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0.2px;
  line-height: 24px;
`

export const TitleMedium = styled.div`
  ${titleMedium};
`

export const titleLarge = css`
  ${segoeUi};
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0px;
  line-height: 28px;
`

export const TitleLarge = styled.div`
  ${titleLarge};
`

export const headlineSmall = titleLarge
export const HeadlineSmall = TitleLarge

export const headlineMedium = css`
  ${bahnschrift};
  font-size: 34px;
  font-weight: 700;
  letter-spacing: 0px;
  line-height: 36px;
`

export const HeadlineMedium = styled.div`
  ${headlineMedium};
`

export const headlineLarge = css`
  ${bahnschrift};
  font-size: 40px;
  font-weight: 700;
  letter-spacing: 0px;
  line-height: 44px;
`

export const HeadlineLarge = styled.div`
  ${headlineLarge};
`

export const displaySmall = css`
  ${bahnschrift};
  font-size: 44px;
  font-weight: 700;
  line-height: 44px;
  letter-spacing: 0px;
`

export const DisplaySmall = styled.div`
  ${displaySmall};
`

export const displayMedium = css`
  ${bahnschrift};
  font-size: 54px;
  font-weight: 700;
  letter-spacing: 0px;
  line-height: 52px;
`

export const DisplayMedium = styled.div`
  ${displayMedium};
`

export const displayLarge = css`
  ${bahnschrift};
  font-size: 64px;
  font-weight: 700;
  letter-spacing: 0px;
  line-height: 64px;
`

export const DisplayLarge = styled.div`
  ${displayLarge};
`
