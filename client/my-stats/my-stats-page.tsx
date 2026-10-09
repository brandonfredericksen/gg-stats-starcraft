import { TFunction } from 'i18next'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { DEFAULT_EAPM_FLOOR } from '../../common/my-stats/coach'
import { MyStatsResult } from '../../common/my-stats/my-stats'
import { picksOneKind, useFilteredCoach } from '../coach/coach-data'
import { Comparison } from '../coach/coach-page'
import { SectionErrorBoundary, StatsPanel } from '../games/game-stats-shared'
import { TextButton } from '../material/button'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch } from '../redux-hooks'
import { openSettings } from '../settings/action-creators'
import { AppSettingsPage } from '../settings/settings-page'
import { bodyMedium, headlineMedium, labelLarge } from '../styles/typography'
import { AnalyzeMine } from './analyze-mine'
import { useStatsPlayerNames } from './demo-player'
import { MyStatsData, MyStatsFilters, myStatsFiltersAtom, useMyStats } from './my-stats-data'
import { FilterBar } from './my-stats-filters'
import {
  ByLength,
  ByMatchup,
  MacroAveragesPanel,
  Maps,
  People,
  RecentGames,
  TeamGames,
  Totals,
  Trends,
} from './my-stats-panels'

const Root = styled.div`
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  padding: 22px 32px 56px;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

const Header = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`

const Title = styled.h1`
  ${headlineMedium};
  margin: 0;
`

const PlayingAs = styled.div`
  ${bodyMedium};
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  color: var(--theme-on-surface-variant);
`

const NameChip = styled.span`
  ${labelLarge};
  height: 26px;
  padding: 0 10px;

  display: inline-flex;
  align-items: center;

  border-radius: var(--radius-full);
  background: var(--theme-container-highest);
  color: var(--theme-on-surface);
  font-weight: 600;
`

const Coverage = styled.div`
  ${bodyMedium};
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  color: var(--theme-on-surface-variant);

  &:empty {
    display: none;
  }
`

/** Two columns as tall as each other, so a panel that can grow fills its column's height. */
const Columns = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
  gap: 16px;
  align-items: stretch;

  @media (max-width: 960px) {
    grid-template-columns: minmax(0, 1fr);
  }
`

/** Panels of the same kind side by side, as tall as each other. */
const EvenColumns = styled(Columns)`
  grid-template-columns: repeat(2, minmax(0, 1fr));

  @media (max-width: 960px) {
    grid-template-columns: minmax(0, 1fr);
  }
`

const Column = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
`

const Buckets = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const Message = styled(StatsPanel)`
  ${bodyMedium};
  padding: 24px;
  color: var(--theme-on-surface-variant);
`

/**
 * How many of the user's games of the picked game type and time range are analyzed, naming that
 * scope so the numbers can't be mistaken for every game.
 */
function getCoverageText(data: MyStatsData, filters: MyStatsFilters, t: TFunction) {
  const scope = [
    filters.shape === 'ffa' ? t('myStats.ffa', 'FFA') : filters.shape,
    filters.range === '7d' ? t('myStats.coverageWeek', 'last 7 days') : undefined,
    filters.range === '30d' ? t('myStats.coverageMonth', 'last 30 days') : undefined,
  ].filter(Boolean)
  const counts = { count: data.scope.analyzed, total: data.scope.total }
  return scope.length
    ? t('myStats.coverageScope', {
        defaultValue: '{{count}} of your {{total}} games ({{scope}}) are analyzed.',
        defaultValue_one: '{{count}} of your {{total}} games ({{scope}}) is analyzed.',
        ...counts,
        scope: scope.join(', '),
      })
    : t('myStats.coverageAll', {
        defaultValue: '{{count}} of your {{total}} games are analyzed.',
        defaultValue_one: '{{count}} of your {{total}} games is analyzed.',
        ...counts,
      })
}

/**
 * The numbers against other players: every number the coach compares when the filters pick one
 * kind of game, or the main ones on average when they don't.
 */
function Numbers({ stats, filters }: { stats: MyStatsResult; filters: MyStatsFilters }) {
  const { t } = useTranslation()
  const coach = useFilteredCoach()
  const oneKind = picksOneKind(filters)
  const buckets =
    oneKind && coach && coach !== 'error' && coach.status === 'ready'
      ? coach.buckets.filter(bucket => bucket.userGames)
      : []

  if (buckets.length && coach && coach !== 'error') {
    return (
      <Buckets>
        {buckets.map(bucket => (
          <Comparison
            key={bucket.mapFamily ?? 'any'}
            bucket={bucket}
            eapmFloor={coach.eapmFloor}
            sameDates={filters.range !== 'all'}
          />
        ))}
      </Buckets>
    )
  }
  if (oneKind && coach === undefined) {
    return <LoadingDotsArea />
  }
  return (
    <MacroAveragesPanel
      macro={stats.macro}
      others={stats.macroOthers}
      othersGames={stats.othersGames}
      othersFromBaseline={stats.othersFromBaseline}
      eapmFloor={filters.eapmFloor ?? DEFAULT_EAPM_FLOOR}
      rank={stats.rank}
      extraNote={
        oneKind
          ? undefined
          : t(
              'myStats.macro.pickForAll',
              'Pick a game type and your race, and in 1v1 the race you played against, to see every number.',
            )
      }
    />
  )
}

/** The user's own stats across their analyzed games. */
export function MyStatsView() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const names = useStatsPlayerNames() ?? []
  const filters = useAtomValue(myStatsFiltersAtom)
  const data = useMyStats()

  let content: React.ReactNode
  if (!data) {
    content = <LoadingDotsArea />
  } else if (!data.analyzedGames) {
    content = (
      <Message>
        {t(
          'myStats.noAnalyzedGames',
          "None of your games are analyzed yet. Analyze some and they'll show up here.",
        )}
      </Message>
    )
  } else if (!data.stats.games) {
    content = <Message>{t('myStats.noMatches', 'No analyzed games match these filters.')}</Message>
  } else {
    const { stats } = data
    content = (
      <>
        <SectionErrorBoundary>
          <RecentGames games={stats.recent} />
        </SectionErrorBoundary>
        <SectionErrorBoundary>
          <Totals stats={stats} />
        </SectionErrorBoundary>
        <Columns>
          <Column>
            <SectionErrorBoundary>
              <ByMatchup rows={stats.byMatchup} apmGames={stats.apm?.games ?? 0} />
            </SectionErrorBoundary>
            <SectionErrorBoundary>
              <ByLength rows={stats.byLength} />
            </SectionErrorBoundary>
          </Column>
          <Column>
            <SectionErrorBoundary>
              <Trends games={stats.trend} />
            </SectionErrorBoundary>
          </Column>
        </Columns>
        <SectionErrorBoundary>
          <Numbers stats={stats} filters={filters} />
        </SectionErrorBoundary>
        {/* Without teammates, Maps takes their place beside Opponents rather than leave a hole. */}
        <EvenColumns>
          {stats.teammates.length ? (
            <SectionErrorBoundary>
              <People title={t('myStats.people.teammates', 'Teammates')} people={stats.teammates} />
            </SectionErrorBoundary>
          ) : null}
          <SectionErrorBoundary>
            <People title={t('myStats.people.opponents', 'Opponents')} people={stats.opponents} />
          </SectionErrorBoundary>
          {stats.teammates.length ? null : (
            <SectionErrorBoundary>
              <Maps maps={stats.maps} />
            </SectionErrorBoundary>
          )}
        </EvenColumns>
        {stats.team ? (
          <SectionErrorBoundary>
            <TeamGames key={filters.race ?? 'any'} byRace={stats.team} initialRace={filters.race} />
          </SectionErrorBoundary>
        ) : null}
        {stats.teammates.length ? (
          <SectionErrorBoundary>
            <Maps maps={stats.maps} />
          </SectionErrorBoundary>
        ) : null}
      </>
    )
  }

  return (
    <Root>
      <Header>
        <Title>{t('myStats.label', 'My stats')}</Title>
        <PlayingAs>
          {t('myStats.playingAs', 'Playing as')}
          {names.map(name => (
            <NameChip key={name}>{name}</NameChip>
          ))}
          <TextButton
            label={t('myStats.editNames', 'Edit names')}
            onClick={() => dispatch(openSettings(AppSettingsPage.PlayerNames))}
          />
        </PlayingAs>
      </Header>
      <FilterBar autoRank={data?.stats.rank} />
      {data ? (
        <Coverage>
          {data.analyzedGames ? <span>{getCoverageText(data, filters, t)}</span> : null}
          <AnalyzeMine names={names} filters={filters} compact={true} />
        </Coverage>
      ) : null}
      {content}
    </Root>
  )
}
