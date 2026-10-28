import { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { LadderRank } from '../../common/games/ladder'
import { MapFamily } from '../../common/games/map-family'
import { CoachBuild } from '../../common/my-stats/builds'
import { CoachBucket, CoachScope } from '../../common/my-stats/coach'
import {
  MetaBuild,
  MetaResult,
  MIN_META_BUILD_GAMES,
  MIN_META_BUILD_PLAYERS,
} from '../../common/my-stats/meta-builds'
import { MIN_COLORED_GAMES } from '../../common/my-stats/my-stats'
import { AssignedRaceChar, raceCharToLabel } from '../../common/races'
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
  Row,
  SpanHead,
  WinRateCell,
} from './build-shared'

/**
 * A win rate from fewer games than this, as the Games column counts them, is shown faded, since
 * it's mostly chance. The same floor as everywhere else in the app.
 */
export const MIN_RATE_GAMES = MIN_COLORED_GAMES
/** A top players' win number from fewer games than this is shown faded, the same way. */
const MIN_WIN_GAMES = 30

/** A build played here, by top players or by the user. */
export interface BuildEntry {
  family: string
  top: MetaBuild | undefined
  /** The build in games at the user's level, which holds the user's own games of it. */
  level: CoachBuild | undefined
}

const COUNT_COLUMN = '64px'
const RATE_COLUMN = '96px'
const COLUMNS = [
  'minmax(0, 1fr)',
  // Top players: share, wins.
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
        '{{games}} games of {{players}} {{race}} players from the last 6 months: S and A rank, with S counting twice, and unranked players over {{eapm}} early game EAPM.',
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

/**
 * What the players at the user's level are called, as a heading and within a sentence. Their
 * level is only known from the rank of their latest ranked 1v1 game. Otherwise the players are
 * named for the rank or the EAPM they were picked by.
 */
export function getLevelName(
  bucket: CoachBucket,
  autoRank: LadderRank | undefined,
  eapmFloor: number,
  t: TFunction,
): { label: string; players: string } {
  if (bucket.rank && bucket.rank === autoRank) {
    return {
      label: t('builds.yourLevel', 'Your level'),
      players: t('builds.basisLevel', 'players at your level'),
    }
  }
  if (bucket.rank) {
    const rank = bucket.rank.toUpperCase()
    return {
      label: t('myStats.filters.rankOption', 'Rank {{rank}}', { rank }),
      players: t('builds.basisRank', 'rank {{rank}} players', { rank }),
    }
  }
  return {
    label: t('myStats.filters.floorOption', '{{floor}}+ EAPM', { floor: eapmFloor }),
    players: t('builds.basisFloor', 'players over {{floor}} EAPM', { floor: eapmFloor }),
  }
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

/** Every build played here, by top players and by the user, side by side. Picks the one shown below. */
export function BuildsList({
  entries,
  meta,
  scope,
  userBuild,
  selected,
  onSelect,
  pickers,
}: {
  entries: ReadonlyArray<BuildEntry>
  meta: MetaResult | 'error'
  scope: Omit<CoachScope, 'games'>
  userBuild: string | undefined
  selected: string
  onSelect: (family: string) => void
  pickers: React.ReactNode
}) {
  const { t } = useTranslation()
  // Only 1v1 wins go by MMR, see `computeMetaBuilds`.
  const byMmr = scope.shape === '1v1'
  // Not a plain win rate, so it's named apart from the win rates next to it.
  const topWinLabel = t('builds.metaWinScore', 'Win score')
  const topWinHelp = byMmr
    ? t(
        'builds.metaWinScoreMmrHelp',
        'How it does against the other builds here, with MMR taken into account. 50% is even. Few games pull it toward 50%, so it can differ from the record on hover.',
      )
    : t(
        'builds.metaWinScoreHelp',
        'How it does against the other builds here. 50% is even. Few games pull it toward 50%, so it can differ from the record on hover.',
      )
  const otherShare = meta !== 'error' && meta.builds.length ? meta.otherShare : 0

  return (
    <PaddedPanel>
      <PanelHead $spread={!!pickers}>
        <PanelTitle>{t('builds.popular', 'Builds played here')}</PanelTitle>
        <PanelHeadNote>{t('builds.popularNote', 'Pick one to compare it below.')}</PanelHeadNote>
        {pickers}
      </PanelHead>
      <BuildsTable $columns={COLUMNS} $you={2}>
        <Row>
          <span />
          <SpanHead style={{ gridColumn: 'span 2' }}>
            <HelpLabel
              label={t('builds.topPlayers', 'Top players')}
              help={getTopPlayersHelp(meta, scope, t)}
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
          <HeadCell $end={true}>
            <HelpLabel label={topWinLabel} help={topWinHelp} />
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
                {family === userBuild ? (
                  <BuildTag $you={true}>{t('builds.yours', 'You play most')}</BuildTag>
                ) : null}
              </Cell>
              <Cell $end={true} $tone={top ? undefined : 'muted'}>
                {top ? formatPercent(top.share) : '-'}
              </Cell>
              <WinRateCell
                rate={top?.winScore}
                wins={top?.side.wins ?? 0}
                losses={top?.side.losses ?? 0}
                faded={!!top && top.winGames < MIN_WIN_GAMES}
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
        {entries.length ? null : (
          <Row>
            <Cell $tone='muted' style={{ gridColumn: '1 / -1' }}>
              {t('builds.noneAgainst', 'No builds against this yet.')}
            </Cell>
          </Row>
        )}
        {otherShare >= 0.005 ? (
          <Row>
            <OtherCell>{t('builds.metaOther', 'Other builds')}</OtherCell>
            <OtherCell $end={true}>{formatPercent(otherShare)}</OtherCell>
            {Array.from({ length: 3 }, (_, i) => (
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
