import { TFunction } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MapFamily } from '../../common/games/map-family'
import { WORKER_MINUTES } from '../../common/my-stats/builds'
import { CoachScope } from '../../common/my-stats/coach'
import {
  CORE_STEP_SHARE,
  MetaBuild,
  MetaResult,
  MetaStep,
  MIN_META_BUILD_GAMES,
  MIN_META_BUILD_PLAYERS,
  ORDER_END_MS,
  TIGHT_STEP_MS,
  VARIED_STEP_MS,
} from '../../common/my-stats/meta-builds'
import { AssignedRaceChar, raceCharToLabel } from '../../common/races'
import { useMetaBuilds } from '../coach/coach-data'
import {
  Cell,
  formatGameTime,
  getBuildName,
  getMapFamilyShortName,
  HeadCell,
  Table,
  Text,
} from '../coach/coach-shared'
import { GameIcon } from '../games/game-icon'
import { TextButton } from '../material/button'
import { SegmentMenu, SegmentOption } from '../material/segmented'
import {
  formatPercent,
  HelpLabel,
  PaddedPanel,
  PanelHead,
  PanelHeadNote,
  PanelNote,
  PanelTitle,
} from '../my-stats/my-stats-panels'
import { push } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'
import { getGameStatsUrl } from '../replays/action-creators'
import { titleSmall } from '../styles/typography'
import {
  BuildRow,
  BuildsGrid,
  BuildTag,
  getBuildFamilyName,
  getStepName,
  IconName,
  isAllInFamily,
  PlayersCount,
  stepId,
} from './build-shared'

/** A win number from fewer games than this is shown faded, since it's mostly chance. */
const MIN_WIN_GAMES = 30

const OrderTitle = styled.h3`
  ${titleSmall};
  margin-top: var(--space-2);
`

const Pickers = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
`

/** How often a step comes up, after its name. */
const StepShare = styled.span`
  margin-left: var(--space-2);
  color: var(--theme-on-surface-variant);
`

/** An all-in, in a red that reads apart from the tab's pink. */
const AllInTag = styled(BuildTag)`
  background: transparent;
  color: var(--theme-error);
  box-shadow: inset 0 0 0 1px var(--theme-error);
`

/** The row of the builds table for every build not listed, which can't be picked. */
const OtherCell = styled(Cell)`
  color: var(--theme-on-surface-variant);
`

const Checkpoints = styled.ul`
  margin: 0;
  padding: 0;
  list-style: none;

  display: flex;
  flex-direction: column;
  gap: var(--space-1);
`

/** Who the top players are here, and where their games come from. */
function getFieldNote(meta: MetaResult, scope: Omit<CoachScope, 'games'>, t: TFunction) {
  const values = {
    games: meta.games,
    players: meta.players,
    race: raceCharToLabel(scope.race, t),
    eapm: Math.round(meta.eapmCutoff ?? 0),
  }
  const notes = [
    meta.topBy === 'rank'
      ? t(
          'builds.metaFieldRank',
          'From {{games}} games of {{players}} {{race}} players over the last 6 months: S and A rank, S counting twice, and unranked players as fast as them, over {{eapm}} early game EAPM.',
          values,
        )
      : t(
          'builds.metaFieldEapm',
          'From {{games}} games of {{players}} {{race}} players over the last 6 months: the fastest quarter of players here, over {{eapm}} early game EAPM.',
          values,
        ),
  ]
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
  return notes.join(' ')
}

/** Workers at each of the minutes they're counted at, like "18 at 4:00, 31 at 6:00". */
function getWorkersText(build: MetaBuild, t: TFunction) {
  const counts = WORKER_MINUTES.flatMap((minute, i) => {
    const workers = build.workersAt[i]
    return workers === null || workers === undefined
      ? []
      : [
          t('builds.metaCountAt', '{{count}} at {{time}}', {
            count: workers,
            time: formatGameTime(minute * 60_000),
          }),
        ]
  })
  return counts.length
    ? t('builds.metaWorkers', 'Workers: {{counts}}', { counts: counts.join(', ') })
    : ''
}

/** What a build's army is by a few points in the game, and the static defense it builds. */
function getCheckpoints(build: MetaBuild, t: TFunction): string[] {
  const lines = [getWorkersText(build, t)]
  for (const { minute, units } of build.armyAt) {
    if (units.length) {
      lines.push(
        t('builds.metaArmyAt', 'Army at {{time}}: {{units}}', {
          time: formatGameTime(minute * 60_000),
          units: units
            .map(unit =>
              t('builds.metaUnitCount', '{{count}} {{unit}}', {
                count: Math.round(unit.count),
                unit: getBuildName(`u${unit.unitId}`, t),
              }),
            )
            .join(', '),
        }),
      )
    }
  }
  if (build.defense.length) {
    lines.push(
      t('builds.metaDefense', 'Static defense by 6:00: {{defense}}', {
        defense: build.defense
          .map(({ key, count }) =>
            t('builds.metaUnitCount', '{{count}} {{unit}}', {
              count,
              unit: getBuildName(key, t),
            }),
          )
          .join(', '),
      }),
    )
  }
  if (build.later.length) {
    lines.push(
      t('builds.metaLater', 'After {{time}}, by when most games take them: {{steps}}', {
        time: formatGameTime(ORDER_END_MS),
        steps: build.later
          .map(step => `${getStepName(step, t)} ${formatGameTime(step.timeMs)}`)
          .join(', '),
      }),
    )
  }
  return lines.filter(Boolean)
}

function RangeCell({ step }: { step: MetaStep }) {
  const { t } = useTranslation()
  const range = t('builds.timingsWindow', '{{from}} to {{to}}', {
    from: formatGameTime(step.earlyMs),
    to: formatGameTime(step.lateMs),
  })
  return (
    <Cell $end={true} $tone='muted'>
      {step.lateMs - step.earlyMs > VARIED_STEP_MS
        ? t('builds.metaVaries', 'varies, {{range}}', { range })
        : range}
    </Cell>
  )
}

/** The steps of a build top players use, as the game closest to their usual play took them. */
function BuildOrder({ build }: { build: MetaBuild }) {
  const { t } = useTranslation()
  return (
    <>
      <OrderTitle>{getBuildFamilyName(build.family, t)}</OrderTitle>
      <Table $columns='64px 72px minmax(0, 1fr) 72px 168px'>
        <HeadCell $end={true}>{t('builds.metaSupply', 'Supply')}</HeadCell>
        <HeadCell $end={true}>{t('builds.metaWorkersHead', 'Workers')}</HeadCell>
        <HeadCell>{t('builds.step', 'Step')}</HeadCell>
        <HeadCell $end={true}>{t('builds.metaTime', 'Time')}</HeadCell>
        <HeadCell $end={true}>
          <HelpLabel
            label={t('builds.metaRange', 'Usual range')}
            help={t(
              'builds.metaRangeHelp',
              'When the middle half of all these top games take it. Times in bold are steps most top players take within {{seconds}}s of each other. A step that varies by more than {{varies}}s depends on the game.',
              { seconds: TIGHT_STEP_MS / 1000, varies: VARIED_STEP_MS / 1000 },
            )}
          />
        </HeadCell>
        {build.order.map(step => [
          <Cell key={`${stepId(step)}-supply`} $end={true} $tone='muted'>
            {step.supply ?? '-'}
          </Cell>,
          <Cell key={`${stepId(step)}-workers`} $end={true} $tone='muted'>
            {step.workers ?? '-'}
          </Cell>,
          <Cell key={`${stepId(step)}-name`}>
            <IconName>
              <GameIcon buildKey={step.key} size={32} />
              {getStepName(step, t)}
            </IconName>
            {step.share < CORE_STEP_SHARE ? (
              <StepShare>
                {t('builds.stepShare', 'in {{share}} of games', {
                  share: formatPercent(step.share),
                })}
              </StepShare>
            ) : null}
          </Cell>,
          <Cell
            key={`${stepId(step)}-time`}
            $end={true}
            $strong={step.lateMs - step.earlyMs <= TIGHT_STEP_MS}>
            {formatGameTime(step.timeMs)}
          </Cell>,
          <RangeCell key={`${stepId(step)}-range`} step={step} />,
        ])}
      </Table>
      <Checkpoints>
        {getCheckpoints(build, t).map(line => (
          <li key={line}>
            <Text>{line}</Text>
          </li>
        ))}
      </Checkpoints>
      <PanelNote>
        {t(
          'builds.metaOrderNote',
          'Supply, workers and times are from one game, the one closest to how top players usually play it. Ranges are from all {{games}} games.',
          { games: build.games },
        )}{' '}
        {build.typical.fromLibrary ? (
          <TextButton
            label={t('builds.metaOpenGame', 'Open that game')}
            onClick={() => push(getGameStatsUrl(build.typical.gameId))}
          />
        ) : null}
      </PanelNote>
    </>
  )
}

/** What's known about a kind of game too thin to list builds for. */
function ThinMeta({ meta }: { meta: MetaResult }) {
  const { t } = useTranslation()
  return (
    <>
      <Text>
        {meta.games
          ? t(
              'builds.metaThin',
              '{{games}} games of {{players}} top players here so far. A build needs {{minGames}} games from {{minPlayers}} players to be listed.',
              {
                games: meta.games,
                players: meta.players,
                minGames: MIN_META_BUILD_GAMES,
                minPlayers: MIN_META_BUILD_PLAYERS,
              },
            )
          : t('builds.metaNone', 'No games of top players here yet.')}
      </Text>
      {meta.seen.length ? (
        <Text>
          {t('builds.metaSeen', 'Seen so far: {{builds}}', {
            builds: meta.seen
              .map(seen =>
                t('builds.metaSeenBuild', '{{name}} ({{games}})', {
                  name: getBuildFamilyName(seen.family, t),
                  games: seen.games,
                }),
              )
              .join(', '),
          })}
        </Text>
      ) : null}
      {meta.topBy === 'eapm' ? (
        <PanelNote>
          {t(
            'builds.metaThinTeam',
            "Team game builds come from your own replays. Adding a folder of strong players' team games fills this in.",
          )}
        </PanelNote>
      ) : null}
    </>
  )
}

/** The table of builds, the most played first, which picks the one shown below it. */
function MetaTable({
  meta,
  selected,
  onSelect,
}: {
  meta: MetaResult
  selected: MetaBuild
  onSelect: (family: string) => void
}) {
  const { t } = useTranslation()
  const winLabel =
    meta.topBy === 'rank'
      ? t('builds.metaWinVsMmr', 'Win vs MMR')
      : t('builds.metaWinRate', 'Win rate')
  return (
    <BuildsGrid $lastColumn={4} $columns='minmax(0, 1fr) 96px 112px 168px'>
      <HeadCell>{t('builds.build', 'Build')}</HeadCell>
      <HeadCell $end={true}>
        <HelpLabel
          label={t('builds.metaShare', 'Share')}
          help={t('builds.metaShareHelp', "Its share of top players' games here.")}
        />
      </HeadCell>
      <HeadCell $end={true}>
        <HelpLabel
          label={winLabel}
          help={
            meta.topBy === 'rank'
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
          }
        />
      </HeadCell>
      <HeadCell $end={true}>{t('builds.played', 'Played')}</HeadCell>
      {meta.builds.map(build => (
        <BuildRow
          key={build.family}
          type='button'
          $selected={build === selected}
          aria-pressed={build === selected}
          onClick={() => onSelect(build.family)}>
          <Cell>
            {getBuildFamilyName(build.family, t)}
            {build.standard ? <BuildTag>{t('builds.metaStandard', 'Standard')}</BuildTag> : null}
            {isAllInFamily(build.family) ? (
              <AllInTag>{t('builds.metaAllIn', 'All in')}</AllInTag>
            ) : null}
          </Cell>
          <Cell $end={true}>{formatPercent(build.share)}</Cell>
          <Cell
            $end={true}
            $tone={build.winGames < MIN_WIN_GAMES ? 'muted' : undefined}
            title={t('builds.record', '{{wins}} wins, {{losses}} losses', {
              wins: build.wins,
              losses: build.losses,
            })}>
            {formatPercent(build.winScore)}
          </Cell>
          <Cell $end={true}>
            {t('builds.gamesCount', {
              defaultValue: '{{count}} games',
              defaultValue_one: '{{count}} game',
              count: build.games,
            })}
            <PlayersCount>
              {t('builds.playersCount', {
                defaultValue: '{{count}} players',
                defaultValue_one: '{{count}} player',
                count: build.players,
              })}
            </PlayersCount>
          </Cell>
        </BuildRow>
      ))}
      {meta.otherShare >= 0.005 ? (
        <>
          <OtherCell>{t('builds.metaOther', 'Other builds')}</OtherCell>
          <OtherCell $end={true}>{formatPercent(meta.otherShare)}</OtherCell>
          <OtherCell $end={true}>-</OtherCell>
          <OtherCell $end={true}>-</OtherCell>
        </>
      ) : null}
    </BuildsGrid>
  )
}

/** Picks what to split the top games by, for the kinds of game that offer it. */
function MetaPickers({
  meta,
  opponentRace,
  opening,
  onOpening,
  map,
  onMap,
  opponents,
  onOpponents,
}: {
  meta: MetaResult | undefined
  opponentRace: AssignedRaceChar | undefined
  opening: string
  onOpening: (opening: string) => void
  map: MapFamily | undefined
  onMap: (map: MapFamily | undefined) => void
  opponents: string
  onOpponents: (opponents: string) => void
}) {
  const { t } = useTranslation()
  const openings = meta?.openings ?? []
  const maps = meta?.mapFamilies ?? []
  const pairs = meta?.opponentPairs ?? []
  if (openings.length === 0 && maps.length < 2 && pairs.length === 0) {
    return null
  }
  const opponent = opponentRace ? raceCharToLabel(opponentRace, t) : ''
  const gamesDetail = (games: number) =>
    t('builds.gamesCount', {
      defaultValue: '{{count}} games',
      defaultValue_one: '{{count}} game',
      count: games,
    })

  const openingOptions: Array<SegmentOption<string>> = [
    { value: '', label: t('builds.metaAnyOpening', 'Any {{race}} opening', { race: opponent }) },
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
    ...pairs.map(({ value, games }) => {
      const [first, second] = [...value] as AssignedRaceChar[]
      return {
        value,
        label: t('builds.againstPair', 'Against {{first}} and {{second}}', {
          first: raceCharToLabel(first, t),
          second: raceCharToLabel(second, t),
        }),
        menuDetail: gamesDetail(games),
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
          value={map ?? meta?.mapFamily}
          onChange={onMap}
        />
      ) : null}
      {pairs.length ? (
        <SegmentMenu
          label={t('builds.against', 'Against')}
          showLabel={false}
          options={pairOptions}
          value={opponents}
          onChange={onOpponents}
        />
      ) : null}
    </Pickers>
  )
}

/**
 * The builds the best players use in the kind of game picked, the most played first, and the steps
 * of the one picked. Only the field's numbers, none of the user's next to them.
 */
export function MetaBuilds({ scope }: { scope: Omit<CoachScope, 'games'> }) {
  const { t } = useTranslation()
  const [picked, setPicked] = useState<string>()
  const [opening, setOpening] = useState('')
  const [map, setMap] = useState<MapFamily>()
  const [opponents, setOpponents] = useState('')
  const meta = useMetaBuilds({
    shape: scope.shape,
    race: scope.race,
    opponentRace: scope.opponentRace,
    allyRace: scope.allyRace,
    mapFamily: scope.mapFamily ?? map,
    opponents: opponents || undefined,
    opponentOpening: opening || undefined,
  })

  let content: React.ReactNode
  if (meta === 'error') {
    content = (
      <Text>
        {t('builds.metaError', "The meta couldn't be worked out. Your replays are fine.")}
      </Text>
    )
  } else if (!meta) {
    content = <LoadingDotsArea />
  } else if (!meta.builds.length) {
    content = <ThinMeta meta={meta} />
  } else {
    const selected = meta.builds.find(b => b.family === picked) ?? meta.builds[0]
    content = (
      <>
        <MetaTable meta={meta} selected={selected} onSelect={setPicked} />
        <PanelNote>{getFieldNote(meta, scope, t)}</PanelNote>
        <BuildOrder build={selected} />
      </>
    )
  }

  return (
    <PaddedPanel>
      <PanelHead $spread={true}>
        <PanelTitle>
          <HelpLabel
            label={t('builds.metaTitle', 'The meta')}
            help={t(
              'builds.metaHelp',
              "The builds the best players use here, the most played first. The most played is the standard one when it's at least 15% of games, from at least 5 players. Your games count when you play at their level, but your numbers aren't shown here.",
            )}
          />
        </PanelTitle>
        <PanelHeadNote>
          {t('builds.metaNote', 'How top players open. Pick a build to see its steps.')}
        </PanelHeadNote>
        <MetaPickers
          meta={meta === 'error' ? undefined : meta}
          opponentRace={scope.opponentRace}
          opening={opening}
          onOpening={value => {
            setOpening(value)
            setPicked(undefined)
          }}
          map={map}
          onMap={value => {
            setMap(value)
            setPicked(undefined)
          }}
          opponents={opponents}
          onOpponents={value => {
            setOpponents(value)
            setPicked(undefined)
          }}
        />
      </PanelHead>
      {content}
    </PaddedPanel>
  )
}
