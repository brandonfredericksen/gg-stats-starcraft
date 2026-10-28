import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { useMyPlayerNames } from '../games/my-player-names'
import { relativeTimeFormat, useFormat } from '../i18n/locale-formats'
import { useScouts } from '../live-game/live-game-data'
import { TextButton } from '../material/button'
import { RaceMix } from '../material/race-mix'
import { PlayerAliasesLine } from '../players/player-aliases'
import { usePlayerRecord } from '../players/player-record-hooks'
import { useCurrentMinuteMs } from '../react/date-hooks'
import { useAppDispatch } from '../redux-hooks'
import { bodyMedium, headlineMedium } from '../styles/typography'
import { RecordText } from './my-stats-panels'

const Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
`

const TitleRow = styled.div`
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-3);
`

const Title = styled.h1`
  ${headlineMedium};
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const AlsoPlays = styled.span`
  ${bodyMedium};
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--theme-on-surface-variant);
`

const Spacer = styled.span`
  flex: 1;
`

const Line = styled.div`
  ${bodyMedium};
  min-height: 20px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-4);
  color: var(--theme-on-surface-variant);
`

const Figure = styled.span`
  color: var(--theme-on-surface);
  font-weight: 600;
`

const TIME_AGO_FORMAT = relativeTimeFormat({ numeric: 'auto' })

/** The user's record with them, so it's clear at a glance whose stats these are. */
function YouAndThem({ accounts }: { accounts: ReadonlyArray<string> }) {
  const { t } = useTranslation()
  const myNames = useMyPlayerNames() ?? []
  const record = usePlayerRecord(accounts, myNames)
  const timeAgo = useFormat(TIME_AGO_FORMAT)
  const nowMs = useCurrentMinuteMs()
  // Held to its height while it loads, so the page doesn't move when it arrives.
  if (!record || record === 'error' || !myNames.length) {
    return <Line />
  }
  const { against, with: together } = record
  const games =
    against.wins +
    against.losses +
    against.unknown +
    together.wins +
    together.losses +
    together.unknown
  if (!games) {
    return <Line>{t('players.noGamesTogether', "You haven't played with or against them.")}</Line>
  }
  return (
    <Line>
      <span>
        {t('players.against', 'Against them')}{' '}
        <Figure>
          <RecordText record={against} />
        </Figure>
      </span>
      <span>
        {t('players.with', 'With them')}{' '}
        <Figure>
          <RecordText record={together} />
        </Figure>
      </span>
      {record.lastPlayedMs ? (
        <span>
          {t('players.lastPlayed', 'Last played {{when}}', {
            when: timeAgo.format(Math.min(record.lastPlayedMs, nowMs)),
          })}
        </span>
      ) : null}
    </Line>
  )
}

/**
 * The top of another player's page: that it's a player's, their races and name, their other
 * accounts, the user's record with them, and the names that play like them.
 */
export function PlayerHeader({
  name,
  accounts,
}: {
  name: string
  accounts: ReadonlyArray<string>
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const scout = useScouts([accounts])(accounts)
  const races = typeof scout === 'object' ? scout.races : []
  const others = accounts.filter(a => a.toLowerCase() !== name.toLowerCase())
  return (
    <Root>
      <TitleRow>
        {races.length ? <RaceMix races={races} /> : null}
        <Title>{name}</Title>
        {others.length ? (
          <AlsoPlays title={others.join(', ')}>
            {t('players.alsoPlaysAs', 'Also plays as {{names}}', { names: others.join(', ') })}
          </AlsoPlays>
        ) : null}
        <Spacer />
        <TextButton
          label={t('myStats.playerDetails', 'Note and accounts')}
          onClick={() => dispatch(openDialog({ type: DialogType.Player, initData: { name } }))}
        />
      </TitleRow>
      <YouAndThem accounts={accounts} />
      <PlayerAliasesLine accounts={accounts} />
    </Root>
  )
}
