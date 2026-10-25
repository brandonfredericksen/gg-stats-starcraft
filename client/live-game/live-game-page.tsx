import { TFunction } from 'i18next'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { getErrorStack } from '../../common/errors'
import { GameShape } from '../../common/games/player-metrics'
import { isMyPlayerName } from '../../common/games/player-names'
import { GATEWAY_REGIONS, LiveGame, LiveGamePlayer } from '../../common/live-game'
import { PlayerScout, ScoutMatchup } from '../../common/my-stats/player-scout'
import { raceCharToLabel } from '../../common/races'
import { KnownPlayer } from '../../common/settings/local-settings'
import { getBuildFamilyName } from '../builds/build-shared'
import { getMapFamilyShortName } from '../coach/coach-shared'
import { SectionErrorBoundary } from '../games/game-stats-shared'
import { useMyPlayerNames } from '../games/my-player-names'
import { relativeTimeFormat, useFormat } from '../i18n/locale-formats'
import { RankBadge } from '../ladder/rank-badge'
import logger from '../logging/logger'
import { TextButton } from '../material/button'
import { RaceTag } from '../material/race-tag'
import { SkeletonText } from '../material/skeleton'
import {
  formatPercent,
  getShapeLabel,
  getWinRate,
  Muted,
  PaddedPanel,
  RecentGames,
  RecordText,
  Totals,
} from '../my-stats/my-stats-panels'
import { Badge, Header, Message, Root, Title } from '../my-stats/page-layout'
import { findPlayerByAccount, useKnownPlayers } from '../players/known-players'
import { PlayerNameButton } from '../players/player-card'
import { loadPlayerRecord, PlayerRecord } from '../players/player-record'
import { useCurrentMinuteMs } from '../react/date-hooks'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { openSettings } from '../settings/action-creators'
import { AppSettingsPage } from '../settings/settings-page'
import {
  bahnschrift,
  bodyMedium,
  bodySmall,
  labelMedium,
  labelSmall,
  titleMedium,
} from '../styles/typography'
import { openLastGame } from '../system-bar/last-game'
import { liveGameAtom } from './live-game-atoms'
import { ScoutState, useScouts } from './live-game-data'

const TIME_AGO_FORMAT = relativeTimeFormat({ numeric: 'auto' })

/** Pushes what follows it to the far end of the header. */
const HeaderEnd = styled.div`
  margin-left: auto;
`

/** The cards side by side, each in the same order and only as tall as what's known. */
const Cards = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  align-items: start;
  gap: var(--space-4);
`

const Card = styled(PaddedPanel)`
  gap: var(--space-4);
`

/** Numbers with a label over each, read at a glance. */
const Stats = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3) var(--space-6);
`

const Stat = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const StatLabel = styled.span`
  ${labelSmall};
  color: var(--theme-on-surface-variant);
`

const StatValue = styled.span`
  ${titleMedium};
  ${bahnschrift};
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-variant-numeric: tabular-nums;
`

const CardHead = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
`

const NameLine = styled.div`
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
`

const Name = styled.h2`
  ${titleMedium};
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const Section = styled.section`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
`

/** A part of a section, under its own small label. */
const SubSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
`

const SubLabel = styled.div`
  ${labelSmall};
  color: var(--theme-on-surface-variant);
`

const Races = styled.div`
  ${bodyMedium};
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
`

const SectionNote = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const SectionLabel = styled.h3`
  ${labelMedium};
  margin: 0;
  color: var(--theme-on-surface-variant);
`

const Figure = styled.span`
  ${bahnschrift};
  font-variant-numeric: tabular-nums;
`

const Chips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
`

const Chip = styled.span`
  ${labelMedium};
  max-width: 100%;
  height: 24px;
  padding: 0 var(--space-2);

  display: inline-flex;
  align-items: center;

  background-color: var(--theme-container-high);
  border-radius: var(--radius-full);
`

const Note = styled.div`
  ${bodyMedium};
  padding: var(--space-2) var(--space-3);
  white-space: pre-wrap;
  overflow-wrap: anywhere;

  background-color: var(--theme-container-high);
  border-radius: var(--radius-md);
`

const Table = styled.div`
  ${bodySmall};
  display: grid;
  /* The same columns in every matchup, so the numbers line up from one to the next. */
  grid-template-columns: minmax(0, 1fr) 48px 64px 48px;
  align-items: baseline;
  gap: 2px var(--space-3);
`

/** A row is its cells, laid out by the table's columns. */
const TableRow = styled.div`
  display: contents;
`

const HeadCell = styled.div<{ $end?: boolean }>`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
  text-align: ${props => (props.$end ? 'right' : 'left')};
`

/** A matchup's first row. Every cell in it gets the room above, so the row stays level. */
const MatchupCell = styled.div<{ $end?: boolean }>`
  ${labelMedium};
  margin-top: var(--space-2);
  font-weight: 700;
  text-align: ${props => (props.$end ? 'right' : 'left')};
`

const BuildCell = styled.div`
  min-width: 0;
  padding-left: var(--space-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const NumberCell = styled.div`
  ${bahnschrift};
  text-align: right;
  font-variant-numeric: tabular-nums;
`

function getSourceLabel(game: LiveGame, t: TFunction) {
  if (game.source === 'ladder') {
    return t('liveGame.source.ladder', 'Ladder')
  }
  return game.source === 'lobby' ? t('liveGame.source.lobby', 'Custom game') : 'ShieldBattery'
}

function getRegionLabel(gatewayId: number, t: TFunction) {
  switch (GATEWAY_REGIONS[gatewayId]) {
    case 'usWest':
      return t('liveGame.region.usWest', 'U.S. West')
    case 'usEast':
      return t('liveGame.region.usEast', 'U.S. East')
    case 'europe':
      return t('liveGame.region.europe', 'Europe')
    case 'korea':
      return t('liveGame.region.korea', 'Korea')
    case 'asia':
      return t('liveGame.region.asia', 'Asia')
    default:
      return undefined
  }
}

/** Players on a side, in game types whose matchups are written out. */
const TEAM_SIZES: Partial<Record<GameShape, number>> = { '1v1': 1, '2v2': 2 }

/**
 * Like PvT or PZvTZ when both sides' races are known, or else the race and the kind of game, and
 * the kind of map in game types that play differently by map.
 */
function getMatchupLabel(matchup: ScoutMatchup, t: TFunction) {
  const team = [matchup.race, ...matchup.teammateRaces].sort()
  const size = TEAM_SIZES[matchup.shape]
  if (size && team.length === size && matchup.opponentRaces.length === size) {
    const side = (races: ReadonlyArray<string>) => races.join('').toUpperCase()
    return `${side(team)}${t('gameStats.matchupSeparator', 'v')}${side(matchup.opponentRaces)}`
  }
  const kind = [
    getShapeLabel(matchup.shape, t),
    matchup.mapFamily ? getMapFamilyShortName(matchup.mapFamily, t) : undefined,
  ]
    .filter(Boolean)
    .join(' ')
  return `${raceCharToLabel(matchup.race, t)} · ${kind}`
}

/** Every account someone plays under: the one they're on, ones the user noted, and alternates. */
function getAccounts(player: LiveGamePlayer, known: KnownPlayer | undefined) {
  return Array.from(
    new Set([player.name, ...(known?.accounts ?? []), ...(player.otherAccounts ?? [])]),
  )
}

/** The accounts besides the one someone is on, each once whatever its case. */
function getAliases(name: string, accounts: ReadonlyArray<string>) {
  const seen = new Set([name.toLowerCase()])
  return accounts.filter(a => {
    const lower = a.toLowerCase()
    if (seen.has(lower)) {
      return false
    }
    seen.add(lower)
    return true
  })
}

/**
 * The user's record with someone. Keyed by the game, so the next game counts again; when more of
 * their accounts become known, the record so far stays up until the new count replaces it.
 */
function RecordWithYou({
  accounts,
  myNames,
}: {
  accounts: string[]
  myNames: ReadonlyArray<string>
}) {
  const { t } = useTranslation()
  const [record, setRecord] = useState<PlayerRecord | 'error'>()
  const accountsKey = accounts.join('\n')
  const namesKey = myNames.join('\n')

  useEffect(() => {
    let cancelled = false
    loadPlayerRecord(accountsKey.split('\n'), namesKey.split('\n'))
      .then(loaded => {
        if (!cancelled) {
          setRecord(loaded)
        }
      })
      .catch(err => {
        logger.error(`Error counting the games with ${accountsKey}: ${getErrorStack(err)}`)
        if (!cancelled) {
          setRecord('error')
        }
      })
    return () => {
      cancelled = true
    }
  }, [accountsKey, namesKey])

  if (record === 'error') {
    return <Muted>{t('players.recordFailed', "Couldn't count your games with them.")}</Muted>
  }
  if (!record) {
    return <SkeletonText $width='160px' />
  }
  const { against, with: together } = record
  const unknown = against.unknown + together.unknown
  const games = against.wins + against.losses + together.wins + together.losses + unknown
  if (!games) {
    return <Muted>{t('liveGame.neverPlayed', "You haven't played them.")}</Muted>
  }
  return (
    <>
      <Stats>
        <Stat>
          <StatLabel>{t('players.against', 'Against them')}</StatLabel>
          <StatValue>
            <RecordText record={against} />
          </StatValue>
        </Stat>
        <Stat>
          <StatLabel>{t('players.with', 'On your team')}</StatLabel>
          <StatValue>
            <RecordText record={together} />
          </StatValue>
        </Stat>
      </Stats>
      {unknown ? (
        <Muted>
          {t('liveGame.withoutResult', {
            defaultValue: '{{count}} more without a result yet.',
            defaultValue_one: '1 more without a result yet.',
            count: unknown,
          })}
        </Muted>
      ) : null}
    </>
  )
}

/** How much of the builds table shows before it's opened up: a glance, not every game ever. */
const MATCHUPS_SHOWN = 3
const BUILDS_SHOWN = 3

/** The rows a matchup has: its builds, then the games whose build has no name, if any. */
function getBuildRows(matchup: ScoutMatchup, all: boolean) {
  const builds = all ? matchup.builds : matchup.builds.slice(0, BUILDS_SHOWN)
  // Unnamed games only take a row of their own when they're all there is, or everything shows.
  const unnamed = matchup.unnamed.games > 0 && (all || !matchup.builds.length)
  return { builds, unnamed }
}

function countRows(matchups: ReadonlyArray<ScoutMatchup>, all: boolean) {
  return matchups.slice(0, all ? undefined : MATCHUPS_SHOWN).reduce((count, matchup) => {
    const rows = getBuildRows(matchup, all)
    return count + 1 + rows.builds.length + Number(rows.unnamed)
  }, 0)
}

function BuildsTable({ matchups }: { matchups: ReadonlyArray<ScoutMatchup> }) {
  const { t } = useTranslation()
  const [all, setAll] = useState(false)
  const hiddenRows = countRows(matchups, true) - countRows(matchups, false)
  return (
    <>
      <Table role='table' aria-label={t('liveGame.buildsTable', 'Builds by matchup')}>
        <TableRow role='row'>
          <HeadCell role='columnheader'>
            {t('liveGame.matchupAndBuild', 'Matchup and build')}
          </HeadCell>
          <HeadCell role='columnheader' $end={true}>
            {t('liveGame.games', 'Games')}
          </HeadCell>
          <HeadCell role='columnheader' $end={true}>
            {t('liveGame.record', 'Record')}
          </HeadCell>
          <HeadCell role='columnheader' $end={true}>
            {t('liveGame.winRate', 'Win %')}
          </HeadCell>
        </TableRow>
        {matchups.slice(0, all ? undefined : MATCHUPS_SHOWN).map(matchup => {
          const rows = getBuildRows(matchup, all)
          return (
            <React.Fragment
              key={[
                matchup.shape,
                matchup.race,
                matchup.teammateRaces.join(''),
                matchup.opponentRaces.join(''),
                matchup.mapFamily,
              ].join(' ')}>
              <TableRow role='row'>
                <MatchupCell role='rowheader'>{getMatchupLabel(matchup, t)}</MatchupCell>
                <MatchupCell role='cell' $end={true}>
                  <Figure>{matchup.games}</Figure>
                </MatchupCell>
                <MatchupCell role='cell' $end={true}>
                  <RecordText record={matchup} />
                </MatchupCell>
                <MatchupCell role='cell' $end={true}>
                  <Figure>{formatPercent(getWinRate(matchup))}</Figure>
                </MatchupCell>
              </TableRow>
              {rows.builds.map(build => (
                <TableRow role='row' key={build.family}>
                  <BuildCell role='rowheader' title={getBuildFamilyName(build.family, t)}>
                    {getBuildFamilyName(build.family, t)}
                  </BuildCell>
                  <NumberCell role='cell'>{build.games}</NumberCell>
                  <NumberCell role='cell'>
                    <RecordText record={build} />
                  </NumberCell>
                  <NumberCell role='cell'>{formatPercent(getWinRate(build))}</NumberCell>
                </TableRow>
              ))}
              {rows.unnamed ? (
                <TableRow role='row'>
                  <BuildCell
                    role='rowheader'
                    title={t(
                      'liveGame.unnamedBuildHelp',
                      "Games whose build couldn't be named, like ones over too soon to tell.",
                    )}>
                    <Muted>{t('liveGame.unnamedBuild', 'Unnamed build')}</Muted>
                  </BuildCell>
                  <NumberCell role='cell'>{matchup.unnamed.games}</NumberCell>
                  <NumberCell role='cell'>
                    <RecordText record={matchup.unnamed} />
                  </NumberCell>
                  <NumberCell role='cell'>{formatPercent(getWinRate(matchup.unnamed))}</NumberCell>
                </TableRow>
              ) : null}
            </React.Fragment>
          )
        })}
      </Table>
      {hiddenRows > 0 || all ? (
        <div>
          <TextButton
            label={
              all
                ? t('liveGame.showLess', 'Show less')
                : t('liveGame.showAll', {
                    defaultValue: 'Show all ({{count}} more rows)',
                    defaultValue_one: 'Show all (1 more row)',
                    count: hiddenRows,
                  })
            }
            onClick={() => setAll(!all)}
          />
        </div>
      ) : null}
    </>
  )
}

/** A player's card shows a small My stats for them, then the builds they went with. */
function ScoutDetails({ scout }: { scout: PlayerScout }) {
  const { t } = useTranslation()
  const { totals } = scout
  return (
    <>
      <Totals stats={totals} compact={true} />
      {totals.recent.length ? (
        <SubSection>
          <SubLabel>{t('liveGame.latestGames', 'Latest games, newest first')}</SubLabel>
          <RecentGames games={totals.recent} compact={true} />
        </SubSection>
      ) : null}
      {scout.races.length ? (
        <SubSection>
          <SubLabel>{t('liveGame.racesPlayed', 'Games as each race')}</SubLabel>
          <Races>
            {scout.races.map(({ race, games }) => (
              <span key={race}>
                <RaceTag race={race} /> <Figure>{games}</Figure>
              </span>
            ))}
          </Races>
        </SubSection>
      ) : null}
      {scout.fromBaseline ? (
        <Muted>
          {t('liveGame.fromBaseline', {
            defaultValue: '{{count}} are from the ladder games built into GG Stats.',
            defaultValue_one: '1 is from the ladder games built into GG Stats.',
            count: scout.fromBaseline,
          })}
        </Muted>
      ) : null}
      <BuildsTable matchups={scout.matchups} />
    </>
  )
}

function ScoutSummary({ scout }: { scout: ScoutState }) {
  const { t } = useTranslation()
  if (scout === 'loading') {
    return <SkeletonText $width='200px' />
  }
  if (scout === 'error') {
    return <Muted>{t('liveGame.scoutFailed', "Couldn't look up their games.")}</Muted>
  }
  if (!scout.totals.games) {
    return <Muted>{t('liveGame.noAnalyzedGames', 'None analyzed yet.')}</Muted>
  }
  return <ScoutDetails scout={scout} />
}

interface Person {
  player: LiveGamePlayer
  known: KnownPlayer | undefined
  accounts: string[]
  /** Their other accounts, from their ladder profile and the user's notes. */
  aliases: string[]
  isMe: boolean
}

/**
 * Everything known about one player, the parts that say most first. A part with nothing to say
 * isn't shown, so a stranger's card is short and says so once.
 */
function PlayerCard({
  person: { player, known, accounts, aliases, isMe },
  gameId,
  scout,
  myNames,
}: {
  person: Person
  gameId: string
  scout: ScoutState
  myNames: ReadonlyArray<string>
}) {
  const { t } = useTranslation()
  const region = player.gatewayId ? getRegionLabel(player.gatewayId, t) : undefined
  const identity = [player.battleTag, region].filter(Boolean).join(' · ')
  return (
    <Card>
      <CardHead>
        <NameLine>
          {/* Only a race they picked: a guess here would read as their pick. */}
          {player.race ? <RaceTag race={player.race} /> : null}
          <Name>
            <PlayerNameButton name={player.name} race={player.race}>
              {player.name}
            </PlayerNameButton>
          </Name>
          {isMe ? <Badge>{t('liveGame.you', 'You')}</Badge> : null}
          {player.observer ? <Badge>{t('liveGame.observer', 'Observer')}</Badge> : null}
        </NameLine>
        {identity ? <Muted>{identity}</Muted> : null}
      </CardHead>

      {!isMe && myNames.length ? (
        <Section>
          <SectionLabel>{t('liveGame.youAndThem', 'You and them')}</SectionLabel>
          <SectionErrorBoundary>
            <RecordWithYou key={gameId} accounts={accounts} myNames={myNames} />
          </SectionErrorBoundary>
        </Section>
      ) : null}

      {player.ladder ? (
        <Section>
          <SectionLabel>{t('liveGame.ladderSeason', 'Ladder this season')}</SectionLabel>
          <Stats>
            <Stat>
              <StatLabel>{t('liveGame.mmr', 'MMR')}</StatLabel>
              <StatValue>
                {player.ladder.rank ? <RankBadge rank={player.ladder.rank} /> : null}
                {player.ladder.rating ?? t('liveGame.unranked', 'Unranked')}
              </StatValue>
            </Stat>
            <Stat>
              <StatLabel>{t('liveGame.record', 'Record')}</StatLabel>
              <StatValue>
                <RecordText record={player.ladder} />
              </StatValue>
            </Stat>
          </Stats>
        </Section>
      ) : null}

      <Section>
        <div>
          <SectionLabel>
            {isMe
              ? t('liveGame.yourAnalyzedGames', 'Your analyzed games')
              : t('liveGame.theirAnalyzedGames', 'Their analyzed games')}
          </SectionLabel>
          <SectionNote>
            {isMe
              ? t('liveGame.yourGamesScope', 'Every game of yours that GG Stats analyzed, all time')
              : t('liveGame.theirGamesScope', 'Every analyzed game they were in, all time')}
          </SectionNote>
        </div>
        <SectionErrorBoundary>
          <ScoutSummary scout={scout} />
        </SectionErrorBoundary>
      </Section>

      {aliases.length ? (
        <Section>
          <SectionLabel>{t('liveGame.otherAccounts', 'Also plays as')}</SectionLabel>
          <Chips>
            {aliases.map(name => (
              <Chip key={name}>
                <PlayerNameButton name={name}>{name}</PlayerNameButton>
              </Chip>
            ))}
          </Chips>
        </Section>
      ) : null}

      {known?.note ? (
        <Section>
          <SectionLabel>{t('liveGame.yourNote', 'Your note')}</SectionLabel>
          <Note>{known.note}</Note>
        </Section>
      ) : null}
    </Card>
  )
}

/**
 * A card's key: the player's name, which stays the same as more is learned about them, with their
 * gateway only when another player has the same name.
 */
function getPersonKey(person: Person, index: number, people: ReadonlyArray<Person>) {
  const name = person.player.name.toLowerCase()
  const shared = people.some(p => p !== person && p.player.name.toLowerCase() === name)
  // Without a gateway to tell them apart, where they are in the game does.
  return shared ? `${name}@${person.player.gatewayId ?? `#${index}`}` : name
}

/**
 * The order the cards go in: the lobby's, top to bottom, so each player is where the user sees them
 * in the game. Without slots, like on the ladder, the people the user is playing come before
 * them. Anyone watching comes last.
 */
function comparePeople(a: Person, b: Person) {
  const watching = Number(!!a.player.observer) - Number(!!b.player.observer)
  if (watching) {
    return watching
  }
  if (a.player.slot !== undefined && b.player.slot !== undefined) {
    return a.player.slot - b.player.slot
  }
  return Number(a.isMe) - Number(b.isMe)
}

/** Rounds down to the minute, to say how long ago something was in whole minutes. */
function toMinute(ms: number) {
  return ms - (ms % 60_000)
}

/** How long ago the user joined, on its own so the minute ticking over redraws only this. */
function Joined({ noticedMs }: { noticedMs: number }) {
  const { t } = useTranslation()
  const nowMs = useCurrentMinuteMs()
  const format = useFormat(TIME_AGO_FORMAT)
  const when = format.format(Math.min(toMinute(noticedMs), nowMs), nowMs)
  return <Muted>{t('liveGame.joined', 'Joined {{when}}', { when })}</Muted>
}

function LiveGameView({ game }: { game: LiveGame }) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const knownPlayers = useKnownPlayers()
  const myNames = useMyPlayerNames() ?? []
  const people: Person[] = game.players
    .map(player => {
      const known = findPlayerByAccount(knownPlayers, player.name)
      const isMe = isMyPlayerName(player.name, myNames)
      // The user's own card counts every name they play under, without listing them.
      const accounts = isMe
        ? Array.from(new Set([player.name, ...myNames]))
        : getAccounts(player, known)
      return {
        player,
        known,
        accounts,
        aliases: isMe ? [] : getAliases(player.name, accounts),
        isMe,
      }
    })
    .sort(comparePeople)
  const scouts = useScouts(people.map(p => p.accounts))
  const playing = people.filter(p => !p.player.observer).length

  return (
    <Root>
      <Header>
        <Title>{t('liveGame.title', 'Live game')}</Title>
        <Badge>{getSourceLabel(game, t)}</Badge>
        {playing ? (
          <Muted>
            {t('liveGame.players', {
              defaultValue: '{{count}} players',
              defaultValue_one: '{{count}} player',
              count: playing,
            })}
          </Muted>
        ) : null}
        <Joined noticedMs={game.noticedMs} />
        <HeaderEnd>
          <TextButton
            label={t('matchStats.lastGame', "Last game's stats")}
            onClick={() => dispatch(openLastGame())}
          />
        </HeaderEnd>
      </Header>
      {myNames.length ? null : (
        <Message>
          <Muted>
            {t(
              'liveGame.needsNames',
              'Add your names in Settings to see which player is you and your record with the others.',
            )}
          </Muted>
          <div>
            <TextButton
              label={t('liveGame.setNames', 'Set your names')}
              onClick={() => dispatch(openSettings(AppSettingsPage.PlayerNames))}
            />
          </div>
        </Message>
      )}
      {people.length ? (
        <Cards>
          {people.map((person, i) => (
            <PlayerCard
              key={getPersonKey(person, i, people)}
              person={person}
              gameId={game.id}
              scout={scouts(person.accounts)}
              myNames={myNames}
            />
          ))}
        </Cards>
      ) : (
        <Message>
          <Muted>{t('liveGame.waitingForPlayers', "Waiting to see who's in the game.")}</Muted>
        </Message>
      )}
    </Root>
  )
}

export function LiveGamePage() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const game = useAtomValue(liveGameAtom)
  const enabled = useAppSelector(s => s.settings.local.liveGame) !== false

  if (game) {
    return <LiveGameView game={game} />
  }
  return (
    <Root>
      <Header>
        <Title>{t('liveGame.title', 'Live game')}</Title>
      </Header>
      <Message>
        {enabled ? (
          <>
            <Muted>
              {t(
                'liveGame.empty',
                "You're not in a game. Join one on the ladder, in a custom lobby or on " +
                  "ShieldBattery to see who's in it.",
              )}
            </Muted>
            <div>
              <TextButton
                label={t('matchStats.lastGame', "Last game's stats")}
                onClick={() => dispatch(openLastGame())}
              />
            </div>
          </>
        ) : (
          <>
            <Muted>{t('liveGame.off', "Showing who's in the games you join is turned off.")}</Muted>
            <div>
              <TextButton
                label={t('liveGame.openSettings', 'Open settings')}
                onClick={() => dispatch(openSettings(AppSettingsPage.Replays))}
              />
            </div>
          </>
        )}
      </Message>
    </Root>
  )
}
