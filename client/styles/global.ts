import { createGlobalStyle } from 'styled-components'
import { LIGHT_THEME_CSS, THEME_CSS } from './colors'
import { bodyMedium, segoeUi } from './typography'

const GlobalStyle = createGlobalStyle`
  /**
    Helper property that can be used to resolve things like vw, cqw, etc. into usable values. Just
    assign your value to the property, then use the property in whatever calculatons you need.
  */
  @property --resolved-length {
    syntax: '<length>';
    inherits: false;
    initial-value: 0;
  }

  *, *::before, *::after {
    box-sizing: border-box;
    /**
      Generally allowing selection feels "un-app-like". For certain components, selection makes
      sense (e.g. predominantly text-based things, like text fields), but those are in the minority
      for us, so we make them specifically note themselves as exceptions to the rule.
    */
    user-select: none;
  }

  :root {
    ${THEME_CSS};
    --scrollbar-width: 12px;

    --radius-sm: 6px;
    --radius-md: 10px;
    --radius-lg: 14px;
    --radius-full: 999px;

    /*
     * Spacing by role: 4 and 8 inside a component, 12 between items in a group, 16 between
     * sibling blocks, 20 for panel padding, and 24 between sections.
     */
    --space-1: 4px;
    --space-2: 8px;
    --space-3: 12px;
    --space-4: 16px;
    --space-5: 20px;
    --space-6: 24px;
    --space-8: 32px;
  }

  @media (prefers-color-scheme: light) {
    :root:not([data-theme='dark']) {
      ${LIGHT_THEME_CSS};
    }
  }

  :root[data-theme='light'] {
    ${LIGHT_THEME_CSS};
  }

  html {
    ${segoeUi};
    ${bodyMedium};

    accent-color: var(--theme-amber);
    font-optical-sizing: auto;
    font-weight: normal;
    font-variant-numeric: tabular-nums;
    color: var(--theme-on-surface);
    font-size: 14px;
    line-height: 1.42857;

    background-color: var(--theme-surface);
    --gg-color-background: var(--theme-surface);

    /** This will be overridden on the body styles in Electron */
    --gg-system-bar-height: 0px;

    /**
      Values to adjust for if centering content so that the content's edges don't end up on
      half pixels.
    */
    // NOTE(tec27): Rounding seems very weird here, I know, BUT... Chrome seems to implement vw/vh
    // extremely literally from the spec, which defines them as e.g. "1vw = 1% of viewport width."
    // Thus, they pre-divide them by 100, and for some values (such as 954px):
    //  954 / 100 * 100 => 953.9999999
    // When this occurs, rem and mod by 2px can return 2px instead of the 0px they should. Other
    // browsers (e.g. Firefox) don't seem to have this issue.
    --pixel-shove-x: rem(round(100dvw, 0.25px), 2px);
    --pixel-shove-y: rem(round(100dvh, 0.25px), 2px);
  }

  html, body, #app {
    -webkit-text-size-adjust: 100%;
    -webkit-tap-highlight-color: rgba(0, 0, 0, 0);
    -webkit-touch-callout: none;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    position: relative;
    overflow: hidden;
  }

  a:link, a:visited {
    color: var(--theme-on-surface);
    text-decoration: underline;
    text-decoration-color: var(--theme-outline);
    text-underline-offset: 3px;
  }

  a:hover, a:active {
    color: var(--theme-on-surface);
    text-decoration: underline;
    text-decoration-color: currentColor;
  }

  svg {
    fill: currentColor;
  }

  *:focus-visible {
    outline-color: var(--theme-grey-blue);
    outline-offset: 2px;
    outline-width: 3px;
  }

  input:-webkit-autofill {
    box-shadow: 0 0 0px 1000px var(--theme-container-highest) inset !important;
    -webkit-text-fill-color: var(--theme-on-surface) !important;
    caret-color: var(--theme-amber) !important;
  }

  /** Style default scrollbar (at least in Webkit-based browsers) */
  *::-webkit-scrollbar {
    box-sizing: border-box;
    width: 12px;
    height: 12px;
  }

  *::-webkit-scrollbar-track {
    box-sizing: border-box;
    background-color: transparent;
    border: none;
  }

  /* Most scrolling surfaces have rounded corners, which would cut off the ends of the thumb */
  *::-webkit-scrollbar-track:vertical {
    margin-block: var(--radius-md);
  }

  *::-webkit-scrollbar-track:horizontal {
    margin-inline: var(--radius-md);
  }

  *::-webkit-scrollbar-thumb {
    box-sizing: border-box;
    width: 100%;
    border: 3px solid transparent;
    margin-left: auto;
    margin-right: auto;
    background-color: var(--theme-outline-variant);
    background-clip: padding-box;
    border-radius: var(--radius-full);

    &:hover, &:active {
      background-color: var(--theme-outline);
    }
  }

  *::-webkit-scrollbar-button:start:decrement,
  *::-webkit-scrollbar-button:end:increment {
    height: 0px;
  }
  /** End scrollbar styling */
`

export default GlobalStyle
