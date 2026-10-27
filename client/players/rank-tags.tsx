import { TFunction } from 'i18next'
import styled, { css } from 'styled-components'
import { LadderRank } from '../../common/games/ladder'
import { bahnschrift, labelMedium, labelSmall } from '../styles/typography'

/** Bahnschrift capitals centered by their own height, for letters in a small box. */
export const bahnschriftCapCentered = css`
  ${bahnschrift};
  line-height: 1;
  text-box: trim-both cap alphabetic;
  padding-top: 1px;
`

/**
 * A ladder league's letter the way StarCraft: Remastered draws it: a square outlined in the
 * league's color over a dark tint of it. For a player's Battle.net rank and the rank their eSkill
 * falls in, which is a ladder rank too.
 */
export const LeagueTag = styled.span<{ $rank: LadderRank }>`
  ${labelMedium};
  width: 20px;
  height: 20px;
  flex-shrink: 0;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  background-color: rgb(from var(--theme-league-${props => props.$rank}) r g b / 0.18);
  border: 1.5px solid var(--theme-league-${props => props.$rank});
  border-radius: 2px;
  color: var(--theme-league-${props => props.$rank});
  font-size: 13px;
  font-weight: 700;
  ${bahnschriftCapCentered};
  /* At this size its capitals need a pixel more, measured at 4x. */
  padding-top: 2px;
`

/** Where a rating is from, ShieldBattery or Battle.net, in its colors, explained on hover. */
export const SourceTag = styled.span<{ $source: 'shieldBattery' | 'battleNet' }>`
  ${labelSmall};
  ${bahnschriftCapCentered};
  height: 18px;
  padding-inline: 6px;

  display: inline-flex;
  align-items: center;

  background-color: ${props =>
    props.$source === 'shieldBattery'
      ? 'var(--theme-source-shieldbattery-container)'
      : 'var(--theme-source-battlenet-container)'};
  border-radius: var(--radius-sm);
  color: ${props =>
    props.$source === 'shieldBattery'
      ? 'var(--theme-source-shieldbattery)'
      : 'var(--theme-source-battlenet)'};
  font-weight: 800;
  letter-spacing: 0.04em;
  cursor: help;
`

/** ShieldBattery's own icon for a division, from its repository. */
export const DivisionIcon = styled.img`
  width: 22px;
  height: 22px;
  flex-shrink: 0;
`

/** A ShieldBattery division's name, like Gold 1, in its metal's color. */
export const DivisionName = styled.span<{ $tier: string }>`
  ${labelMedium};
  color: var(--theme-division-${props => props.$tier});
  font-weight: 700;
`

/** A ShieldBattery division's metal or gem, like `gold` for `gold1`, if it's one this knows. */
const DIVISION_TIERS: ReadonlySet<string> = new Set([
  'bronze',
  'silver',
  'gold',
  'platinum',
  'diamond',
  'champion',
])

export function getDivisionTier(division: string) {
  const tier = /^[a-z]+/.exec(division)?.[0]
  return tier && DIVISION_TIERS.has(tier) ? tier : undefined
}

/** A ShieldBattery division like `platinum1`, as ShieldBattery writes it: Platinum 1. */
export function getDivisionLabel(division: string, t: TFunction) {
  const [, tier = division, level] = /^([a-z]+)(\d*)$/.exec(division) ?? []
  let name: string
  switch (tier) {
    case 'bronze':
      name = t('liveGame.division.bronze', 'Bronze')
      break
    case 'silver':
      name = t('liveGame.division.silver', 'Silver')
      break
    case 'gold':
      name = t('liveGame.division.gold', 'Gold')
      break
    case 'platinum':
      name = t('liveGame.division.platinum', 'Platinum')
      break
    case 'diamond':
      name = t('liveGame.division.diamond', 'Diamond')
      break
    case 'champion':
      name = t('liveGame.division.champion', 'Champion')
      break
    default:
      return undefined
  }
  return level ? `${name} ${level}` : name
}
