import { meetsContrastGuidelines } from 'polished'
import { css } from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { RaceChar } from '../../common/races'

export const blue10 = '#071a22'
export const blue20 = '#0b2c3a'
export const blue30 = '#0f4257'
export const blue40 = '#135c7a'
export const blue50 = '#1a7fa6'
export const blue60 = '#22a3d3'
export const blue70 = '#38c6f4'
export const blue80 = '#74d8f8'
export const blue90 = '#a5e6fb'
export const blue95 = '#cff2fd'
export const blue99 = '#eefafe'

export const amber10 = '#161d05'
export const amber20 = '#2a3809'
export const amber30 = '#44590f'
export const amber40 = '#6a8a16'
export const amber50 = '#9cc21e'
export const amber60 = '#c8f03c'
export const amber70 = '#d4f46a'
export const amber80 = '#e0f792'
export const amber90 = '#eaf9b4'
export const amber95 = '#f3fcd6'
export const amber99 = '#fafef0'

export const purple10 = '#1f0b05'
export const purple20 = '#3a1508'
export const purple30 = '#5c210c'
export const purple40 = '#8a3212'
export const purple50 = '#c24a1c'
export const purple60 = '#ff6b3d'
export const purple70 = '#ff8a63'
export const purple80 = '#ffab8f'
export const purple90 = '#ffc6b3'
export const purple95 = '#ffe0d6'
export const purple99 = '#fff3ef'

export const greyBlue10 = '#0f0f11'
export const greyBlue20 = '#18181b'
export const greyBlue30 = '#222226'
export const greyBlue40 = '#2e2e33'
export const greyBlue50 = '#4a4a51'
export const greyBlue60 = '#6b6b74'
export const greyBlue70 = '#85858e'
export const greyBlue80 = '#a1a1aa'
export const greyBlue90 = '#c4c4ca'
export const greyBlue95 = '#dedee2'
export const greyBlue99 = '#f4f4f5'

export const grey10 = '#141416'
export const grey20 = '#222225'
export const grey30 = '#333337'
export const grey40 = '#4c4c52'
export const grey50 = '#66666d'
export const grey60 = '#8e8e95'
export const grey70 = '#b0b0b6'
export const grey80 = '#cfcfd4'
export const grey90 = '#e0e0e4'
export const grey95 = '#ececef'
export const grey99 = '#f6f6f7'

export const colorContainerLowest = '#121214'
export const colorContainerLow = '#17171a'
export const colorContainer = '#1c1c20'
export const colorContainerHigh = '#212125'
export const colorContainerHighest = '#27272b'
// Colors that aren't intended to be used directly, but will be added to the container elevation
// hierarchy when inside a container (to ensure we can basically always e.g. put a card in a
// container and still have its bounds visible)
const colorContainerHighestPlus1 = '#2c2c31'
const colorContainerHighestPlus2 = '#313136'
const colorContainerHighestPlus3 = '#36363b'

const colorError = '#ff6e6e'
const colorSuccess = '#66bb6a'

/** Color used to indicate that a user is currently live-streaming. */
const colorLive = '#e01d3c'
/** A translucent variant of the live color, for filled backgrounds/banners. */
const colorLiveContainer = 'rgba(224, 29, 60, 0.16)'

/** Color used to indicate something positive (e.g. winning). */
const colorPositive = '#4ade80'
const colorPositiveInvert = '#0d2a17'
/** Color used to indicate something negative (e.g. losing). */
const colorNegative = '#f0a3a5'
const colorNegativeInvert = '#3a1213'

export const colorZerg = '#c1a3f5'
export const colorProtoss = '#ead36d'
export const colorTerran = '#4b8df8'
export const colorRandom = '#f3ab60'

export const dialogScrimOpacity = 0.5

export const THEME_CSS = css`
  color-scheme: dark;

  --color-blue10: ${blue10};
  --color-blue20: ${blue20};
  --color-blue30: ${blue30};
  --color-blue40: ${blue40};
  --color-blue50: ${blue50};
  --color-blue60: ${blue60};
  --color-blue70: ${blue70};
  --color-blue80: ${blue80};
  --color-blue90: ${blue90};
  --color-blue95: ${blue95};
  --color-blue99: ${blue99};

  --color-amber10: ${amber10};
  --color-amber20: ${amber20};
  --color-amber30: ${amber30};
  --color-amber40: ${amber40};
  --color-amber50: ${amber50};
  --color-amber60: ${amber60};
  --color-amber70: ${amber70};
  --color-amber80: ${amber80};
  --color-amber90: ${amber90};
  --color-amber95: ${amber95};
  --color-amber99: ${amber99};

  --color-purple10: ${purple10};
  --color-purple20: ${purple20};
  --color-purple30: ${purple30};
  --color-purple40: ${purple40};
  --color-purple50: ${purple50};
  --color-purple60: ${purple60};
  --color-purple70: ${purple70};
  --color-purple80: ${purple80};
  --color-purple90: ${purple90};
  --color-purple95: ${purple95};
  --color-purple99: ${purple99};

  --color-grey-blue10: ${greyBlue10};
  --color-grey-blue20: ${greyBlue20};
  --color-grey-blue30: ${greyBlue30};
  --color-grey-blue40: ${greyBlue40};
  --color-grey-blue50: ${greyBlue50};
  --color-grey-blue60: ${greyBlue60};
  --color-grey-blue70: ${greyBlue70};
  --color-grey-blue80: ${greyBlue80};
  --color-grey-blue90: ${greyBlue90};
  --color-grey-blue95: ${greyBlue95};
  --color-grey-blue99: ${greyBlue99};

  --color-grey10: ${grey10};
  --color-grey20: ${grey20};
  --color-grey30: ${grey30};
  --color-grey40: ${grey40};
  --color-grey50: ${grey50};
  --color-grey60: ${grey60};
  --color-grey70: ${grey70};
  --color-grey80: ${grey80};
  --color-grey90: ${grey90};
  --color-grey95: ${grey95};
  --color-grey99: ${grey99};

  --theme-primary: var(--color-grey-blue99);
  --theme-on-primary: #0f0f11;
  --theme-primary-container: var(--color-grey-blue40);
  --theme-on-primary-container: var(--color-grey-blue99);

  --theme-amber: var(--color-grey-blue99);
  --theme-on-amber: #0f0f11;
  --theme-amber-container: var(--color-grey-blue40);
  --theme-on-amber-container: var(--color-grey-blue99);

  --theme-purple: var(--color-purple60);
  --theme-on-purple: var(--color-purple99);
  --theme-purple-container: var(--color-purple40);
  --theme-on-purple-container: var(--color-purple95);

  --theme-grey-blue: var(--color-blue70);
  --theme-on-grey-blue: var(--color-grey-blue99);
  --theme-grey-blue-container: var(--color-grey-blue40);
  --theme-on-grey-blue-container: var(--color-grey-blue95);

  --theme-surface: #0f0f11;
  --theme-on-surface: var(--color-grey-blue99);
  --theme-on-surface-variant: var(--color-grey-blue80);
  --theme-inverse-surface: var(--color-grey-blue95);
  --theme-inverse-on-surface: var(--color-grey-blue10);
  --theme-inverse-primary: var(--color-blue40);

  --theme-outline: var(--color-grey-blue60);
  --theme-outline-variant: var(--color-grey-blue40);
  /* A stronger divider, for dashed rings and outlines that need to read on a panel. */
  --theme-outline-strong: var(--color-grey-blue50);
  --theme-inverse-outline: var(--color-grey-blue50);
  --theme-inverse-outline-variant: var(--color-grey-blue90);

  --theme-container-lowest: ${colorContainerLowest};
  --theme-container-low: ${colorContainerLow};
  --theme-container: ${colorContainer};
  --theme-container-high: ${colorContainerHigh};
  --theme-container-highest: ${colorContainerHighest};
  /** These are "internal" and shouldn't be used directly. */
  --_theme-container-highest-plus1: ${colorContainerHighestPlus1};
  --_theme-container-highest-plus2: ${colorContainerHighestPlus2};
  --_theme-container-highest-plus3: ${colorContainerHighestPlus3};
  /** End internal */

  --theme-disabled-opacity: 0.38;

  --theme-error: ${colorError};
  --theme-success: ${colorSuccess};
  --theme-live: ${colorLive};
  --theme-live-container: ${colorLiveContainer};

  --theme-positive: ${colorPositive};
  --theme-positive-invert: ${colorPositiveInvert};
  --theme-negative: ${colorNegative};
  --theme-negative-invert: ${colorNegativeInvert};
  /* A loss or danger color that reads on --theme-inverse-surface. */
  --theme-inverse-negative: #b5484c;
  /** Soft fills behind a win or loss label, with the label in the positive or negative color. */
  --theme-positive-container: rgb(74 222 128 / 0.14);
  --theme-negative-container: rgb(240 163 165 / 0.14);
  /** A game that's being analyzed, and one that has been. */
  --theme-info: var(--color-blue70);
  --theme-info-container: rgb(56 198 244 / 0.14);

  --theme-color-zerg: ${colorZerg};
  --theme-color-protoss: ${colorProtoss};
  --theme-color-terran: ${colorTerran};
  --theme-color-random: ${colorRandom};

  --theme-dialog-scrim: var(--color-grey-blue10);
  --theme-dialog-scrim-opacity: ${dialogScrimOpacity};

  --theme-skeleton: var(--color-grey-blue60);

  /** Colors for charts and other data, told apart by lightness as well as hue. */
  --theme-data-minerals: var(--color-blue80);
  --theme-data-gas: #34d399;
  --theme-data-unspent: #c4c4ca;
  --theme-data-supply-blocked: #f87171;
  --theme-data-1: var(--color-blue70);
  --theme-data-2: var(--color-purple60);
  --theme-data-3: #34d399;
  --theme-data-4: #b79cff;
  --theme-data-5: #ffd23f;
  --theme-data-6: #ff8fb1;
  --theme-data-7: #4dd0e1;
  --theme-data-8: var(--color-grey-blue90);

  /**
   * Each player's color in a game's stats. They stay clear of the race colors' hues (Protoss
   * yellow, Terran blue, Zerg purple), so a player's color is never mistaken for their race.
   */
  --theme-player-1: #ff7a59;
  --theme-player-2: #34d399;
  --theme-player-3: #f472b6;
  --theme-player-4: #bef264;
  --theme-player-5: #f4f4f5;
  --theme-player-6: #fdba74;
  --theme-player-7: #2dd4bf;
  --theme-player-8: #94a3b8;

  /** Each top bar section's color: its icon, and a soft tint behind it while it's open. */
  --theme-tab-library: #38c6f4;
  --theme-tab-library-tint: rgb(56 198 244 / 0.14);
  --theme-tab-library-ring: rgb(56 198 244 / 0.28);
  --theme-tab-stats: #a78bfa;
  --theme-tab-stats-tint: rgb(167 139 250 / 0.16);
  --theme-tab-stats-ring: rgb(167 139 250 / 0.3);
  --theme-tab-last-game: #fbbf24;
  /* The best value among players, like the top of a stats column. */
  --theme-best: #fbbf24;
  --theme-tab-last-game-tint: rgb(251 191 36 / 0.14);
  --theme-tab-last-game-ring: rgb(251 191 36 / 0.28);
  --theme-tab-settings: #94a3b8;
  --theme-tab-settings-tint: rgb(148 163 184 / 0.14);
  --theme-tab-settings-ring: rgb(148 163 184 / 0.28);

  /** The logo's tile, behind its bars. */
  --theme-logo-tile: #27272b;

  /**
   * A panel's light source: the top edge of a panel starts this much lighter and fades to its
   * fill, with a hairline highlight along the top.
   */
  --theme-panel-sheen: var(--theme-container);
  --theme-panel-highlight: rgb(255 255 255 / 0.04);

  /** Tooltips stay dark in both themes, a small raised surface lit from the top. */
  --theme-tooltip: #2a2a2f;
  --theme-tooltip-sheen: #323238;
  --theme-tooltip-border: #3d3d44;
  --theme-tooltip-text: #f4f4f5;
  --theme-tooltip-muted: #b4b4bc;
`

/**
 * Overrides for the light theme. Only the `--theme-*` properties change, so anything still using a
 * `--color-*` step directly keeps its dark theme value.
 */
export const LIGHT_THEME_CSS = css`
  color-scheme: light;

  --theme-primary: #1d1d21;
  --theme-on-primary: #ffffff;
  --theme-primary-container: var(--color-grey-blue90);
  --theme-on-primary-container: #1d1d21;

  --theme-amber: #1d1d21;
  --theme-on-amber: #ffffff;
  --theme-amber-container: var(--color-grey-blue90);
  --theme-on-amber-container: #1d1d21;

  --theme-purple: #c43f12;
  --theme-on-purple: #ffffff;
  --theme-purple-container: var(--color-purple95);
  --theme-on-purple-container: var(--color-purple20);

  --theme-grey-blue: #0369a1;
  --theme-on-grey-blue: #ffffff;
  --theme-grey-blue-container: var(--color-grey-blue90);
  --theme-on-grey-blue-container: var(--color-grey-blue20);

  --theme-surface: #e8e8eb;
  --theme-on-surface: #1d1d21;
  --theme-on-surface-variant: #585861;
  --theme-inverse-surface: #27272b;
  --theme-inverse-on-surface: #f4f4f5;
  --theme-inverse-primary: var(--color-blue80);

  --theme-outline: #8a8a93;
  --theme-outline-variant: #d6d6dc;
  --theme-outline-strong: #ababb4;
  --theme-inverse-outline: var(--color-grey-blue60);
  --theme-inverse-outline-variant: var(--color-grey-blue40);

  --theme-container-lowest: #f1f1f3;
  --theme-container-low: #f5f5f7;
  --theme-container: #ececef;
  --theme-container-high: #e6e6ea;
  --theme-container-highest: #dfdfe4;
  --_theme-container-highest-plus1: #d9d9df;
  --_theme-container-highest-plus2: #d3d3d9;
  --_theme-container-highest-plus3: #cdcdd4;

  --theme-error: #c62828;
  --theme-success: #2e7d32;

  --theme-positive: #15803d;
  --theme-positive-invert: #ffffff;
  --theme-negative: #b5484c;
  --theme-negative-invert: #ffffff;
  --theme-inverse-negative: #f0a3a5;
  --theme-positive-container: #dcfce7;
  --theme-negative-container: #f8e5e5;
  --theme-info: #0369a1;
  --theme-info-container: #e0f2fe;

  --theme-color-zerg: #7b4fd0;
  --theme-color-protoss: #8a6d00;
  --theme-color-terran: #1d4ed8;
  --theme-color-random: #b85c12;

  --theme-dialog-scrim: #111113;
  --theme-dialog-scrim-opacity: 0.4;

  --theme-skeleton: var(--color-grey-blue90);

  --theme-data-minerals: #1a7fc0;
  --theme-data-gas: #047857;
  --theme-data-unspent: #6b6b74;
  --theme-data-supply-blocked: #b91c1c;
  --theme-data-1: #1a7fc0;
  --theme-data-2: #d9481a;
  --theme-data-3: #047857;
  --theme-data-4: #7b4fd0;
  --theme-data-5: #a07800;
  --theme-data-6: #c2185b;
  --theme-data-7: #00838f;
  --theme-data-8: #5b5b64;

  --theme-player-1: #d9481a;
  --theme-player-2: #047857;
  --theme-player-3: #c2185b;
  --theme-player-4: #4d7c0f;
  --theme-player-5: #27272a;
  --theme-player-6: #86198f;
  --theme-player-7: #0f766e;
  --theme-player-8: #475569;

  --theme-tab-library: #0369a1;
  --theme-tab-library-tint: #e0f2fe;
  --theme-tab-library-ring: #bae6fd;
  --theme-tab-stats: #6d28d9;
  --theme-tab-stats-tint: #ede9fe;
  --theme-tab-stats-ring: #ddd6fe;
  --theme-tab-last-game: #b45309;
  --theme-best: #b45309;
  --theme-tab-last-game-tint: #fef3c7;
  --theme-tab-last-game-ring: #fde68a;
  --theme-tab-settings: #475569;
  --theme-tab-settings-tint: #f1f5f9;
  --theme-tab-settings-ring: #e2e8f0;

  --theme-logo-tile: #1d1d21;

  --theme-panel-sheen: #f8f8fa;
  --theme-panel-highlight: rgb(255 255 255 / 0.55);

  --theme-tooltip: #27272b;
  --theme-tooltip-sheen: #303035;
  --theme-tooltip-border: #27272b;
  --theme-tooltip-text: #f4f4f5;
  --theme-tooltip-muted: #b4b4bc;
`

export function getRaceColor(race: RaceChar) {
  switch (race) {
    case 'z':
      return 'var(--theme-color-zerg)'
    case 'p':
      return 'var(--theme-color-protoss)'
    case 't':
      return 'var(--theme-color-terran)'
    case 'r':
      return 'var(--theme-color-random)'
    default:
      return assertUnreachable(race)
  }
}

// TODO(tec27): Use APCA instead of WCAG contrast stuff
/** Picks a text color for a given background color that will meet contrast guidelines. */
export function pickTextColor(backgroundColor: string): string {
  return meetsContrastGuidelines(backgroundColor, grey99).AA ? grey99 : grey10
}

export enum ContainerLevel {
  Lowest,
  Low,
  Normal,
  High,
  Highest,
}

export function containerStyles(level: ContainerLevel) {
  switch (level) {
    case ContainerLevel.Lowest:
      return css`
        background-color: var(--theme-container-lowest);
        --gg-color-background: var(--theme-container-lowest);

        --_tc0-lowest: var(--theme-container-low);
        --_tc0-low: var(--theme-container);
        --_tc0-normal: var(--theme-container-high);
        --_tc0-high: var(--theme-container-highest);
        --_tc0-highest: var(--_theme-container-highest-plus1);
        --_tc0-highest-plus1: var(--_theme-container-highest-plus2);
        --_tc0-highest-plus2: var(--_theme-container-highest-plus3);

        & > * {
          --theme-container-lowest: var(--_tc0-lowest);
          --theme-container-low: var(--_tc0-low);
          --theme-container: var(--_tc0-normal);
          --theme-container-high: var(--_tc0-high);
          --theme-container-highest: var(--_tc0-highest);
          --theme-container-highest-plus1: var(--_tc0-highest-plus1);
          --theme-container-highest-plus2: var(--_tc0-highest-plus2);
        }
      `
    case ContainerLevel.Low:
      return css`
        background-color: var(--theme-container-low);
        --gg-color-background: var(--theme-container-low);

        --_tc1-lowest: var(--theme-container);
        --_tc1-low: var(--theme-container-high);
        --_tc1-normal: var(--theme-container-highest);
        --_tc1-high: var(--_theme-container-highest-plus1);
        --_tc1-highest: var(--_theme-container-highest-plus2);
        --_tc1-highest-plus1: var(--_theme-container-highest-plus3);
        --_tc1-highest-plus2: var(--_theme-container-highest-plus3);

        & > * {
          --theme-container-lowest: var(--_tc1-lowest);
          --theme-container-low: var(--_tc1-low);
          --theme-container: var(--_tc1-normal);
          --theme-container-high: var(--_tc1-high);
          --theme-container-highest: var(--_tc1-highest);
          --theme-container-highest-plus1: var(--_tc1-highest-plus1);
          --theme-container-highest-plus2: var(--_tc1-highest-plus2);
        }
      `
    case ContainerLevel.Normal:
      return css`
        background-color: var(--theme-container);
        --gg-color-background: var(--theme-container);

        --_tc2-lowest: var(--theme-container-high);
        --_tc2-low: var(--theme-container-highest);
        --_tc2-normal: var(--_theme-container-highest-plus1);
        --_tc2-high: var(--_theme-container-highest-plus2);
        --_tc2-highest: var(--_theme-container-highest-plus3);
        --_tc2-highest-plus1: var(--_theme-container-highest-plus3);
        --_tc2-highest-plus2: var(--_theme-container-highest-plus3);

        & > * {
          --theme-container-lowest: var(--_tc2-lowest);
          --theme-container-low: var(--_tc2-low);
          --theme-container: var(--_tc2-normal);
          --theme-container-high: var(--_tc2-high);
          --theme-container-highest: var(--_tc2-highest);
          --theme-container-highest-plus1: var(--_tc2-highest-plus1);
          --theme-container-highest-plus2: var(--_tc2-highest-plus2);
        }
      `
    case ContainerLevel.High:
      return css`
        background-color: var(--theme-container-high);
        --gg-color-background: var(--theme-container-high);

        --_tc3-lowest: var(--theme-container-highest);
        --_tc3-low: var(--_theme-container-highest-plus1);
        --_tc3-normal: var(--_theme-container-highest-plus2);
        --_tc3-high: var(--_theme-container-highest-plus3);
        --_tc3-highest: var(--_theme-container-highest-plus3);
        --_tc3-highest-plus1: var(--_theme-container-highest-plus3);
        --_tc3-highest-plus2: var(--_theme-container-highest-plus3);

        & > * {
          --theme-container-lowest: var(--_tc3-lowest);
          --theme-container-low: var(--_tc3-low);
          --theme-container: var(--_tc3-normal);
          --theme-container-high: var(--_tc3-high);
          --theme-container-highest: var(--_tc3-highest);
          --theme-container-highest-plus1: var(--_tc3-highest-plus1);
          --theme-container-highest-plus2: var(--_tc3-highest-plus2);
        }
      `
    case ContainerLevel.Highest:
      return css`
        background-color: var(--theme-container-highest);
        --gg-color-background: var(--theme-container-highest);

        --_tc4-lowest: var(--_theme-container-highest-plus1);
        --_tc4-low: var(--_theme-container-highest-plus2);
        --_tc4-normal: var(--_theme-container-highest-plus3);
        --_tc4-high: var(--_theme-container-highest-plus3);
        --_tc4-highest: var(--_theme-container-highest-plus3);
        --_tc4-highest-plus1: var(--_theme-container-highest-plus3);
        --_tc4-highest-plus2: var(--_theme-container-highest-plus3);

        & > * {
          --theme-container-lowest: var(--_tc4-lowest);
          --theme-container-low: var(--_tc4-low);
          --theme-container: var(--_tc4-normal);
          --theme-container-high: var(--_tc4-high);
          --theme-container-highest: var(--_tc4-highest);
          --theme-container-highest-plus1: var(--_tc4-highest-plus1);
          --theme-container-highest-plus2: var(--_tc4-highest-plus2);
        }
      `
    default:
      return level satisfies never
  }
}
