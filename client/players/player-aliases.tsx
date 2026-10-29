import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { getErrorStack } from '../../common/errors'
import { AliasConfidence } from '../../common/games/fingerprint-match'
import { TypedIpcRenderer } from '../../common/ipc'
import { PlayerAlias, PlayerAliases } from '../../common/replays-library'
import { urlPath } from '../../common/urls'
import { useMyPlayerNames } from '../games/my-player-names'
import logger from '../logging/logger'
import { buttonReset } from '../material/button-reset'
import { RaceTag } from '../material/race-tag'
import { Tooltip } from '../material/tooltip'
import { push } from '../navigation/routing'
import { bodyMedium, labelLarge, labelMedium, labelSmall, singleLine } from '../styles/typography'

const ipcRenderer = new TypedIpcRenderer()

/** How often to look again while replays are still being read, since they may hold more names. */
const PENDING_REFRESH_MS = 30_000

const Line = styled.div`
  ${bodyMedium};
  min-height: 28px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  color: var(--theme-on-surface-variant);
`

const Chip = styled.button`
  ${buttonReset};
  ${labelLarge};
  height: 28px;
  padding: 0 var(--space-2) 0 6px;

  display: inline-flex;
  align-items: center;
  gap: var(--space-2);

  border-radius: var(--radius-md);
  background-color: var(--theme-container-high);
  box-shadow: inset 0 0 0 1px var(--theme-outline-variant);
  color: var(--theme-on-surface);
  font-weight: 600;
  cursor: pointer;

  &:hover {
    box-shadow: inset 0 0 0 1px var(--theme-outline-strong);
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

const CONFIDENCE_COLORS: Record<AliasConfidence, string> = {
  strong: 'var(--theme-positive)',
  likely: 'var(--theme-info)',
  possible: 'var(--theme-on-surface-variant)',
}

const CONFIDENCE_LEVELS: Record<AliasConfidence, number> = { strong: 3, likely: 2, possible: 1 }

const Confidence = styled.span<{ $color: string }>`
  ${labelSmall};
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  color: ${props => props.$color};
  font-weight: 700;
`

const Dots = styled.span`
  display: inline-flex;
  gap: 2px;
`

const Dot = styled.span<{ $on: boolean }>`
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background-color: currentColor;
  opacity: ${props => (props.$on ? 1 : 0.25)};
`

function AliasChip({ alias, onOpen }: { alias: PlayerAlias; onOpen?: () => void }) {
  const { t } = useTranslation()
  const confidenceLabels: Record<AliasConfidence, string> = {
    strong: t('players.aliases.strong', 'Strong'),
    likely: t('players.aliases.likely', 'Likely'),
    possible: t('players.aliases.possible', 'Possible'),
  }
  const level = CONFIDENCE_LEVELS[alias.confidence]
  return (
    <Tooltip
      tabIndex={-1}
      text={t('players.aliases.chipTooltip', {
        defaultValue:
          'Plays a lot like {{name}}, compared over {{count}} of their games. A lead, not proof.',
        defaultValue_one:
          'Plays a lot like {{name}}, compared over 1 of their games. A lead, not proof.',
        name: alias.name,
        count: alias.games,
      })}>
      <Chip
        type='button'
        onClick={() => {
          push(urlPath`/players/${alias.name}`)
          onOpen?.()
        }}>
        <RaceTag race={alias.race} />
        {alias.name}
        <Confidence $color={CONFIDENCE_COLORS[alias.confidence]}>
          <Dots aria-hidden={true}>
            {[1, 2, 3].map(i => (
              <Dot key={i} $on={i <= level} />
            ))}
          </Dots>
          {confidenceLabels[alias.confidence]}
        </Confidence>
      </Chip>
    </Tooltip>
  )
}

/**
 * The other names whoever plays as `accounts` may play under, from the replays in the library,
 * undefined while they're looked for. Looked for again now and then while replays are still being
 * read.
 */
function usePlayerAliases(
  accounts: ReadonlyArray<string>,
  myNames: ReadonlyArray<string>,
): PlayerAliases | 'error' | undefined {
  const [aliases, setAliases] = useState<PlayerAliases | 'error'>()
  const [refreshes, setRefreshes] = useState(0)
  const accountsKey = accounts.join('\n')
  const namesKey = myNames.join('\n')
  const pending = aliases && aliases !== 'error' ? aliases.pendingReplays : 0

  useEffect(() => {
    let cancelled = false
    Promise.resolve(
      ipcRenderer.invoke(
        'replayLibraryFindAliases',
        accountsKey.split('\n'),
        namesKey ? namesKey.split('\n') : [],
      ),
    )
      .then(found => {
        if (!cancelled && found) {
          setAliases(found)
        }
      })
      .catch(err => {
        logger.error(`Error finding the other names of ${accountsKey}: ${getErrorStack(err)}`)
        if (!cancelled) {
          setAliases('error')
        }
      })
    return () => {
      cancelled = true
    }
  }, [accountsKey, namesKey, refreshes])

  useEffect(() => {
    if (!pending) {
      return undefined
    }
    const timer = setTimeout(() => setRefreshes(n => n + 1), PENDING_REFRESH_MS)
    return () => clearTimeout(timer)
  }, [pending, refreshes])

  return aliases
}

/**
 * The names that play most like a player, found by comparing how they play (their hotkeys, rhythm
 * and habits) with everyone in the user's replays, each with how sure the match is. `onOpen` runs
 * after a name's page is opened from it.
 */
export function PlayerAliasesLine({
  accounts,
  onOpen,
}: {
  accounts: ReadonlyArray<string>
  onOpen?: () => void
}) {
  const { t } = useTranslation()
  const myNames = useMyPlayerNames() ?? []
  const found = usePlayerAliases(accounts, myNames)
  // Held to its height while it loads, so the page doesn't move when it arrives.
  if (!found || found === 'error') {
    return <Line />
  }

  const reading = found.pendingReplays
    ? t('players.aliases.reading', {
        defaultValue: 'Still reading {{count}} replays.',
        defaultValue_one: 'Still reading 1 replay.',
        count: found.pendingReplays,
      })
    : undefined
  if (!found.aliases.length) {
    return (
      <Line>
        <span>
          {found.games
            ? t('players.aliases.none', 'No other name in your replays plays like them.')
            : t(
                'players.aliases.noGames',
                'Not enough of their games in your replays to tell how they play.',
              )}
          {reading ? ` ${reading}` : null}
        </span>
      </Line>
    )
  }
  return (
    <Line>
      <span>{t('players.aliases.playsLike', 'Plays like')}</span>
      {found.aliases.map(alias => (
        <AliasChip key={alias.name} alias={alias} onOpen={onOpen} />
      ))}
      {reading ? <span>{reading}</span> : null}
    </Line>
  )
}

const MiniLine = styled.span`
  ${labelMedium};
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  overflow: hidden;
  white-space: nowrap;
  color: var(--theme-on-surface-variant);
`

const MiniLabel = styled.span`
  ${labelSmall};
  flex-shrink: 0;
`

const MiniAlias = styled.span`
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
`

const MiniName = styled.span`
  ${singleLine};
  min-width: 0;
  color: var(--theme-on-surface);
  font-weight: 600;
`

const MiniDots = styled(Dots)<{ $color: string }>`
  flex-shrink: 0;
  color: ${props => props.$color};
`

/** The most names the short line has room for. */
const MAX_MINI_ALIASES = 3

/**
 * {@link PlayerAliasesLine} on one short line, for places with little room, like a live game's
 * player boxes: each name with its race and how sure the match is, as dots. Nothing in it can be
 * clicked, so it can go inside something that can. Empty while it looks.
 */
export function PlayerAliasesMini({
  accounts,
  className,
}: {
  accounts: ReadonlyArray<string>
  className?: string
}) {
  const { t } = useTranslation()
  const myNames = useMyPlayerNames() ?? []
  const found = usePlayerAliases(accounts, myNames)
  if (!found || found === 'error') {
    return <MiniLine className={className} />
  }
  if (!found.aliases.length) {
    let text: string | undefined
    if (found.pendingReplays) {
      text = t('players.aliases.reading', {
        defaultValue: 'Still reading {{count}} replays.',
        defaultValue_one: 'Still reading 1 replay.',
        count: found.pendingReplays,
      })
    } else if (found.games) {
      text = t('players.aliases.noneShort', 'No other name plays like them.')
    }
    return <MiniLine className={className}>{text}</MiniLine>
  }
  return (
    <MiniLine className={className}>
      <MiniLabel>{t('players.aliases.playsLike', 'Plays like')}</MiniLabel>
      {found.aliases.slice(0, MAX_MINI_ALIASES).map(alias => {
        const level = CONFIDENCE_LEVELS[alias.confidence]
        return (
          <MiniAlias key={alias.name}>
            <RaceTag race={alias.race} />
            <MiniName>{alias.name}</MiniName>
            <MiniDots $color={CONFIDENCE_COLORS[alias.confidence]} aria-hidden={true}>
              {[1, 2, 3].map(i => (
                <Dot key={i} $on={i <= level} />
              ))}
            </MiniDots>
          </MiniAlias>
        )
      })}
    </MiniLine>
  )
}
