import { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { MapFamily } from '../../common/games/map-family'
import { CoachBuild } from '../../common/my-stats/builds'
import { CoachBucket, CoachScope } from '../../common/my-stats/coach'
import {
  MetaBuild,
  MetaResult,
  MIN_META_BUILD_GAMES,
  MIN_META_BUILD_PLAYERS,
} from '../../common/my-stats/meta-builds'
import { AssignedRaceChar, raceCharToLabel } from '../../common/races'
import { getPoolPlace } from '../coach/coach-page'
import { Cell, getMapFamilyShortName, HeadCell } from '../coach/coach-shared'
import { SegmentMenu, SegmentOption } from '../material/segmented'
import {
  formatPercent,
  HelpLabel,
  PaddedPanel,
  PanelHead,
  PanelHeadNote,
  PanelTitle,
} from '../my-stats/my-stats-panels'
import {
  BuildRow,
  BuildsTable,
  BuildTag,
  getBuildFamilyName,
  isAllInFamily,
  Row,
  SpanHead,
  WinRateCell,
} from './build-shared'

/**
 * A win rate from fewer games than this, as the Games column counts them, is shown faded, since
 * it's mostly chance.
 */
export const MIN_RATE_GAMES = 10
/** A top players' win number from fewer games than this is shown faded, the same way. */
const MIN_WIN_GAMES = 30

/** A build played here, by top players, by players at the user's level, or by the user. */
export interface BuildEntry {
  family: string
  top: MetaBuild | undefined
  level: CoachBuild | undefined
}

const COUNT_COLUMN = '64px'
const RATE_COLUMN = '96px'
const COLUMNS = [
  'minmax(0, 1fr)',
  // Top players: share, games, players, wins.
  COUNT_COLUMN,
  COUNT_COLUMN,
  COUNT_COLUMN,
  RATE_COLUMN,
  // Players at the user's level: games, players, win rate.
  COUNT_COLUMN,
  COUNT_COLUMN,
  RATE_COLUMN,
  // The user: games, win rate.
  COUNT_COLUMN,
  RATE_COLUMN,
].join(' ')

const Pickers = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
`

/** The row of the builds table for every build top players play that isn't listed. */
const OtherCell = styled(Cell)`
  color: var(--theme-on-surface-variant);
`

/** How the top players were picked, see `MetaResult.topBy`. */
function getTopPlayersNote(meta: MetaResult, values: Record<string, unknown>, t: TFunction) {
  switch (meta.topBy) {
    case 'rank':
      return t(
        'builds.metaFieldRank',
        'From {{games}} games of {{players}} {{race}} players over the last 6 months: S and A rank, S counting twice, and unranked players as fast as them, over {{eapm}} early game EAPM.',
        values,
      )
    case 'rating':
      return t(
        'builds.metaFieldRating',
        'From {{games}} games of {{players}} {{race}} players over the last 6 months: the better rated half of ladder players here, rated {{rating}} or more, and unrated players as fast as them, over {{eapm}} early game EAPM.',
        values,
      )
    case 'eapm':
      return t(
        'builds.metaFieldEapm',
        'From {{games}} games of {{players}} {{race}} players over the last 6 months: the fastest quarter of players here, over {{eapm}} early game EAPM.',
        values,
      )
    default:
      return assertUnreachable(meta.topBy)
  }
}

/** Who the top players are here, where their games come from, and what's listed of them. */
export function getTopPlayersHelp(
  meta: MetaResult | 'error',
  scope: Omit<CoachScope, 'games'>,
  t: TFunction,
) {
  if (meta === 'error') {
    return t('builds.metaError', "The meta couldn't be worked out. Your replays are fine.")
  }
  const values = {
    games: meta.games,
    players: meta.players,
    race: raceCharToLabel(scope.race, t),
    eapm: Math.round(meta.eapmCutoff ?? 0),
    rating: Math.round(meta.ratingCutoff ?? 0),
  }
  const notes = meta.games
    ? [getTopPlayersNote(meta, values, t)]
    : [t('builds.metaNone', 'No games of top players here yet.')]
  if (meta.anyAlly && scope.allyRace) {
    notes.push(
      t('builds.metaAnyAlly', 'With any teammate, since too few top players had a {{ally}} one.', {
        ally: raceCharToLabel(scope.allyRace, t),
      }),
    )
  }
  if (meta.shortShare >= 0.005) {
    notes.push(
      t(
        'builds.metaShort',
        '{{share}} of these games were over before their build showed, and shares leave them out.',
        { share: formatPercent(meta.shortShare) },
      ),
    )
  }
  if (meta.libraryGames) {
    notes.push(
      t('builds.metaFromLibrary', {
        defaultValue: '{{count}} of them are from your replays.',
        defaultValue_one: '{{count}} of them is from your replays.',
        count: meta.libraryGames,
      }),
    )
  }
  if (meta.games && !meta.builds.length) {
    notes.push(
      t(
        'builds.metaThinNote',
        'A build needs {{minGames}} games from {{minPlayers}} top players to be listed, and none has that many yet.',
        { minGames: MIN_META_BUILD_GAMES, minPlayers: MIN_META_BUILD_PLAYERS },
      ),
    )
  }
  if (meta.topBy === 'eapm') {
    notes.push(
      t(
        'builds.metaThinTeam',
        "Team games come from the ladder baseline and your own replays. Adding a folder of strong players' games fills this in.",
      ),
    )
  }
  return notes.join(' ')
}

/** Who the players at the user's level are here. */
export function getLevelHelp(bucket: CoachBucket, eapmFloor: number, t: TFunction) {
  const notes = [
    t('builds.poolNote', '{{race}} players over {{floor}} EAPM in {{where}}.', {
      race: raceCharToLabel(bucket.race, t),
      where: getPoolPlace(bucket, t),
      floor: eapmFloor,
    }),
  ]
  if (bucket.rank) {
    notes.push(
      t('myStats.rankOnly', 'Only players who were rank {{rank}} going into the game count.', {
        rank: bucket.rank.toUpperCase(),
      }),
    )
  }
  if (bucket.allyRace && bucket.anyAlly) {
    notes.push(
      t(
        'builds.anyAllyNote',
        'Theirs are with any teammate, since too few had a {{ally}} one. Yours are all with a {{ally}} teammate.',
        { ally: raceCharToLabel(bucket.allyRace, t) },
      ),
    )
  }
  return notes.join(' ')
}

/** What a win rate of players at the user's level means here: how much it follows the user's. */
function getLevelWinRateHelp(bucket: CoachBucket, builds: ReadonlyArray<BuildEntry>, t: TFunction) {
  const games = builds.reduce((sum, b) => sum + (b.level?.others.games ?? 0), 0)
  const withUser = builds.reduce((sum, b) => sum + (b.level?.others.withUser ?? 0), 0)
  const notes = [
    t(
      'builds.winRateHelp',
      '{{share}} of these games were with or against you, so their win rates partly follow yours.',
      { share: formatPercent(games ? withUser / games : 0) },
    ),
  ]
  if (bucket.shape !== '1v1' && bucket.shape !== 'ffa') {
    notes.push(t('builds.teamNote', 'Teammates on the same build count their result once.'))
  }
  notes.push(t('builds.fadedNote', 'Faded: under {{minimum}} games.', { minimum: MIN_RATE_GAMES }))
  return notes.join(' ')
}

function rateOf(record: { wins: number; losses: number } | undefined) {
  const decided = record ? record.wins + record.losses : 0
  return record && decided ? record.wins / decided : undefined
}

/** A count, or a dash for none. */
function CountCell({ count }: { count: number | undefined }) {
  return (
    <Cell $end={true} $tone={count ? undefined : 'muted'}>
      {count || '-'}
    </Cell>
  )
}

/**
 * What the games can be split by here: the opponent's opening, the maps and, in 2v2, the
 * opponents' races, which top players' games and the user's level both split by.
 */
function getSplits(meta: MetaResult | 'error', bucket: CoachBucket) {
  const openings = meta === 'error' ? [] : (meta.openings ?? [])
  const maps = meta === 'error' ? [] : (meta.mapFamilies ?? [])
  const topPairs = meta === 'error' ? [] : (meta.opponentPairs ?? [])
  const pairs = Array.from(
    new Set([
      ...(bucket.buildsAgainst ?? []).filter(b => b.builds.length).map(b => b.opponents),
      ...topPairs.map(pair => pair.value),
    ]),
  )
  return { openings, maps, topPairs, pairs }
}

/** Whether there's anything to split the games by here, see {@link BuildsPickers}. */
export function hasSplits(meta: MetaResult | 'error', bucket: CoachBucket) {
  const { openings, maps, pairs } = getSplits(meta, bucket)
  return openings.length > 0 || maps.length > 1 || pairs.length > 0
}

/** Picks what to split the games by, for the kinds of game that offer it. */
export function BuildsPickers({
  meta,
  bucket,
  opening,
  onOpening,
  map,
  onMap,
  against,
  onAgainst,
}: {
  meta: MetaResult | 'error'
  bucket: CoachBucket
  opening: string
  onOpening: (opening: string) => void
  map: MapFamily | undefined
  onMap: (map: MapFamily | undefined) => void
  against: string
  onAgainst: (against: string) => void
}) {
  const { t } = useTranslation()
  const { openings, maps, topPairs, pairs } = getSplits(meta, bucket)
  const opponent = bucket.opponentRace ? raceCharToLabel(bucket.opponentRace, t) : ''
  const gamesDetail = (games: number | undefined) =>
    games === undefined
      ? undefined
      : t('builds.topGamesCount', {
          defaultValue: '{{count}} top games',
          defaultValue_one: '{{count}} top game',
          count: games,
        })

  const openingOptions: Array<SegmentOption<string>> = [
    {
      value: '',
      label: t('builds.metaAnyOpening', 'Any {{race}} opening', { race: opponent }),
    },
    ...openings.map(({ value, games }) => ({
      value,
      label: t('builds.metaVsOpening', 'vs {{opening}}', {
        opening: getBuildFamilyName(value, t),
      }),
      menuDetail: gamesDetail(games),
    })),
  ]
  const mapOptions: Array<SegmentOption<MapFamily | undefined>> = maps.map(({ value, games }) => ({
    value,
    label: getMapFamilyShortName(value, t),
    menuDetail: gamesDetail(games),
  }))
  const pairOptions: Array<SegmentOption<string>> = [
    { value: '', label: t('builds.againstAny', 'Any team') },
    ...pairs.map(value => {
      const [first, second] = [...value] as AssignedRaceChar[]
      return {
        value,
        label: t('builds.againstPair', 'Against {{first}} and {{second}}', {
          first: raceCharToLabel(first, t),
          second: raceCharToLabel(second, t),
        }),
        menuDetail: gamesDetail(topPairs.find(pair => pair.value === value)?.games),
      }
    }),
  ]

  return (
    <Pickers>
      {openings.length ? (
        <SegmentMenu
          label={t('builds.metaOpening', "Opponent's opening")}
          showLabel={false}
          options={openingOptions}
          value={opening}
          onChange={onOpening}
        />
      ) : null}
      {maps.length > 1 ? (
        <SegmentMenu
          label={t('builds.metaMaps', 'Maps')}
          showLabel={false}
          options={mapOptions}
          value={map ?? (meta === 'error' ? undefined : meta.mapFamily)}
          onChange={onMap}
        />
      ) : null}
      {pairs.length ? (
        <SegmentMenu
          label={t('builds.against', 'Against')}
          showLabel={false}
          options={pairOptions}
          value={against}
          onChange={onAgainst}
        />
      ) : null}
    </Pickers>
  )
}

/**
 * Every build played here, by top players, by players at the user's level and by the user, side by
 * side. Picks the one shown below.
 */
export function BuildsList({
  entries,
  meta,
  scope,
  bucket,
  eapmFloor,
  userBuild,
  selected,
  onSelect,
  pickers,
}: {
  entries: ReadonlyArray<BuildEntry>
  meta: MetaResult | 'error'
  scope: Omit<CoachScope, 'games'>
  bucket: CoachBucket
  eapmFloor: number
  userBuild: string | undefined
  selected: string
  onSelect: (family: string) => void
  pickers: React.ReactNode
}) {
  const { t } = useTranslation()
  const byRating = meta !== 'error' && meta.topBy !== 'eapm'
  const topWinLabel = byRating
    ? t('builds.metaWinVsMmr', 'Win vs MMR')
    : t('builds.metaWinRate', 'Win rate')
  const topWinHelp = byRating
    ? t(
        'builds.metaWinVsMmrHelp',
        "How it wins against the other builds here, once the players' MMRs are taken into account: 50% is like the rest. Pulled toward 50% when it has few games, and faded under {{minimum}}.",
        { minimum: MIN_WIN_GAMES },
      )
    : t(
        'builds.metaWinRateHelp',
        'How it wins against the other builds here: 50% is like the rest. Each team counts once, leaving out players who went out first. Pulled toward 50% when it has few games, and faded under {{minimum}}.',
        { minimum: MIN_WIN_GAMES },
      )
  const otherShare = meta !== 'error' && meta.builds.length ? meta.otherShare : 0

  return (
    <PaddedPanel>
      <PanelHead $spread={!!pickers}>
        <PanelTitle>{t('builds.popular', 'Builds played here')}</PanelTitle>
        <PanelHeadNote>{t('builds.popularNote', 'Pick one to compare it below.')}</PanelHeadNote>
        {pickers}
      </PanelHead>
      <BuildsTable $columns={COLUMNS}>
        <Row>
          <span />
          <SpanHead style={{ gridColumn: 'span 4' }}>
            <HelpLabel
              label={t('builds.topPlayers', 'Top players')}
              help={getTopPlayersHelp(meta, scope, t)}
            />
          </SpanHead>
          <SpanHead style={{ gridColumn: 'span 3' }}>
            <HelpLabel
              label={t('builds.yourLevel', 'Your level')}
              help={getLevelHelp(bucket, eapmFloor, t)}
            />
          </SpanHead>
          <SpanHead style={{ gridColumn: 'span 2' }}>{t('builds.you', 'You')}</SpanHead>
        </Row>
        <Row>
          <HeadCell>{t('builds.build', 'Build')}</HeadCell>
          <HeadCell $end={true}>
            <HelpLabel
              label={t('builds.metaShare', 'Share')}
              help={t('builds.metaShareHelp', "Its share of top players' games here.")}
            />
          </HeadCell>
          <HeadCell $end={true}>{t('builds.games', 'Games')}</HeadCell>
          <HeadCell $end={true}>{t('builds.players', 'Players')}</HeadCell>
          <HeadCell $end={true}>
            <HelpLabel label={topWinLabel} help={topWinHelp} />
          </HeadCell>
          <HeadCell $end={true}>
            <HelpLabel
              label={t('builds.games', 'Games')}
              help={t(
                'builds.playedHelp',
                'How many games had this build, counting each player in a game, and how many different players those were. One player can play it many times.',
              )}
            />
          </HeadCell>
          <HeadCell $end={true}>{t('builds.players', 'Players')}</HeadCell>
          <HeadCell $end={true}>
            <HelpLabel
              label={t('builds.winRate', 'Win rate')}
              help={getLevelWinRateHelp(bucket, entries, t)}
            />
          </HeadCell>
          <HeadCell $end={true}>{t('builds.games', 'Games')}</HeadCell>
          <HeadCell $end={true}>
            <HelpLabel
              label={t('builds.winRate', 'Win rate')}
              help={t('builds.yourWinRateHelp', 'How often you won when you played this build.')}
            />
          </HeadCell>
        </Row>
        {entries.map(({ family, top, level }) => {
          const user = level?.user
          return (
            <BuildRow
              key={family}
              type='button'
              $selected={family === selected}
              aria-pressed={family === selected}
              onClick={() => onSelect(family)}>
              <Cell>
                {getBuildFamilyName(family, t)}
                {top?.standard ? <BuildTag>{t('builds.metaStandard', 'Standard')}</BuildTag> : null}
                {isAllInFamily(family) ? (
                  <BuildTag>{t('builds.metaAllIn', 'All in')}</BuildTag>
                ) : null}
                {family === userBuild ? (
                  <BuildTag $you={true}>{t('builds.yours', 'You play most')}</BuildTag>
                ) : null}
              </Cell>
              <Cell $end={true} $tone={top ? undefined : 'muted'}>
                {top ? formatPercent(top.share) : '-'}
              </Cell>
              <CountCell count={top?.games} />
              <CountCell count={top?.players} />
              <WinRateCell
                rate={top?.winScore}
                wins={top?.side.wins ?? 0}
                losses={top?.side.losses ?? 0}
                faded={!!top && top.winGames < MIN_WIN_GAMES}
              />
              <CountCell count={level?.others.games} />
              <CountCell count={level?.players} />
              <WinRateCell
                rate={rateOf(level?.others)}
                wins={level?.others.wins ?? 0}
                losses={level?.others.losses ?? 0}
                faded={(level?.others.games ?? 0) < MIN_RATE_GAMES}
              />
              <CountCell count={user?.games} />
              <WinRateCell
                rate={rateOf(user)}
                wins={user?.wins ?? 0}
                losses={user?.losses ?? 0}
                faded={(user?.games ?? 0) < MIN_RATE_GAMES}
              />
            </BuildRow>
          )
        })}
        {otherShare >= 0.005 ? (
          <Row>
            <OtherCell>{t('builds.metaOther', 'Other builds')}</OtherCell>
            <OtherCell $end={true}>{formatPercent(otherShare)}</OtherCell>
            {Array.from({ length: 8 }, (_, i) => (
              <OtherCell key={i} $end={true}>
                -
              </OtherCell>
            ))}
          </Row>
        ) : null}
      </BuildsTable>
    </PaddedPanel>
  )
}
