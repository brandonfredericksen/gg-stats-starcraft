import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { getErrorStack } from '../../common/errors'
import { TypedIpcRenderer } from '../../common/ipc'
import { WinLoss } from '../../common/my-stats/my-stats'
import { PlayerSummary } from '../../common/my-stats/player-scout'
import { ALL_ASSIGNED_RACE_CHARS, AssignedRaceChar, raceCharToLabel } from '../../common/races'
import { StatsPanel, useStatFormat } from '../games/game-stats-shared'
import { MaterialIcon } from '../icons/material/material-icon'
import logger from '../logging/logger'
import { buttonReset } from '../material/button-reset'
import { RaceMix } from '../material/race-mix'
import { Segmented, SegmentOption } from '../material/segmented'
import {
  getWinRate,
  Muted,
  PaddedPanel,
  PanelHead,
  PanelTitle,
  RecordText,
  Table,
  usePaged,
} from '../my-stats/my-stats-panels'
import { singleLine } from '../styles/typography'
import { PlayerNameButton } from './player-name-button'
import { LeagueTag } from './rank-tags'

const ipcRenderer = new TypedIpcRenderer()

/** Someone the user played with or against, with their record together. */
export interface Person {
  name: string
  races: Array<{ race: AssignedRaceChar; games: number }>
  games: number
  with?: WinLoss
  against?: WinLoss
}

/** Fewer analyzed games than this say too little to rank a player by. */
const TOP_MIN_GAMES = 5

/** Rows the table of everyone shows at a time. */
const TABLE_PAGE_SIZE = 20

/**
 * Each person's numbers from all their analyzed games, by name in lower case, once they're worked
 * out. Asked for again when the people change.
 */
export function usePlayerSummaries(people: ReadonlyArray<Person>) {
  const [summaries, setSummaries] = useState<ReadonlyMap<string, PlayerSummary>>()
  const namesKey = people.map(p => p.name).join('\n')

  useEffect(() => {
    if (!namesKey) {
      return undefined
    }
    let current = true
    const names = namesKey.split('\n')
    Promise.resolve(
      ipcRenderer.invoke(
        'playersSummary',
        names.map(name => [name]),
      ),
    )
      .then(result => {
        if (current && result) {
          setSummaries(new Map(names.map((name, i) => [name.toLowerCase(), result[i]])))
        }
      })
      .catch(err => {
        logger.error(`Error loading the numbers of the people in your games: ${getErrorStack(err)}`)
      })
    return () => {
      current = false
    }
  }, [namesKey])

  return summaries
}

const Columns = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
  align-items: stretch;

  @media (max-width: 960px) {
    grid-template-columns: minmax(0, 1fr);
  }
`

const TopRow = styled.div`
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) 80px 72px;
  gap: 10px;
  align-items: center;
  font-variant-numeric: tabular-nums;
`

const Place = styled(Muted)`
  text-align: right;
`

const NameCell = styled.span`
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-weight: 600;
`

const NameText = styled.span`
  ${singleLine};
`

const RightAligned = styled.span`
  text-align: right;
`

/** A number with the rank it's worth after it, centered on the digits. */
const ValueWithRank = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
`

function PersonName({ person }: { person: Person }) {
  return (
    <NameCell>
      <RaceMix races={person.races} />
      <NameText>
        <PlayerNameButton name={person.name} race={person.races[0]?.race} opensPage={true}>
          {person.name}
        </PlayerNameButton>
      </NameText>
    </NameCell>
  )
}

function ESkillText({ eSkill }: { eSkill: PlayerSummary['eSkill'] }) {
  const format = useStatFormat()
  if (!eSkill) {
    return <Muted>-</Muted>
  }
  return (
    <ValueWithRank>
      {format.format(eSkill.value)}
      {eSkill.rank ? <LeagueTag $rank={eSkill.rank}>{eSkill.rank.toUpperCase()}</LeagueTag> : null}
    </ValueWithRank>
  )
}

interface Ranked {
  person: Person
  summary: PlayerSummary
}

/** The people with the most of something, among those with enough games to say. */
function TopList({
  title,
  rows,
  value,
}: {
  title: string
  rows: ReadonlyArray<Ranked>
  value: (row: Ranked) => React.ReactNode
}) {
  const { t } = useTranslation()
  const { shown, pager } = usePaged(rows)
  const first = rows.indexOf(shown[0])
  return (
    <PaddedPanel>
      <PanelHead $spread={!!pager}>
        <PanelTitle>{title}</PanelTitle>
        {pager}
      </PanelHead>
      {shown.length ? (
        shown.map((row, i) => (
          <TopRow key={row.person.name}>
            <Place>{first + i + 1}</Place>
            <PersonName person={row.person} />
            <RightAligned>
              <Muted>
                {t('players.topGames', {
                  defaultValue: '{{count}} games',
                  defaultValue_one: '{{count}} game',
                  count: row.summary.games,
                })}
              </Muted>
            </RightAligned>
            <RightAligned>{value(row)}</RightAligned>
          </TopRow>
        ))
      ) : (
        <Muted>
          {t('players.topNone', {
            defaultValue: 'Nobody has {{count}} analyzed games yet.',
            count: TOP_MIN_GAMES,
          })}
        </Muted>
      )}
    </PaddedPanel>
  )
}

/** The people in the user's games with the highest eSkill and eAPM, over all their games. */
export function TopPlayers({
  people,
  summaries,
}: {
  people: ReadonlyArray<Person>
  summaries: ReadonlyMap<string, PlayerSummary>
}) {
  const { t } = useTranslation()
  const format = useStatFormat()
  const ranked = people.flatMap(person => {
    const summary = summaries.get(person.name.toLowerCase())
    return summary && summary.games >= TOP_MIN_GAMES ? [{ person, summary }] : []
  })
  const byESkill = ranked
    .filter(r => r.summary.eSkill)
    .sort((a, b) => b.summary.eSkill!.value - a.summary.eSkill!.value)
  const byEapm = ranked
    .filter(r => r.summary.eapm)
    .sort((a, b) => b.summary.eapm!.value - a.summary.eapm!.value)
  return (
    <Columns>
      <TopList
        title={t('players.topESkill', 'Highest eSkill')}
        rows={byESkill}
        value={row => <ESkillText eSkill={row.summary.eSkill} />}
      />
      <TopList
        title={t('players.topEapm', 'Highest eAPM')}
        rows={byEapm}
        value={row => format.format(row.summary.eapm!.value)}
      />
    </Columns>
  )
}

type Relation = 'all' | 'with' | 'against'
type SortKey = 'name' | 'games' | 'with' | 'against' | 'apm' | 'eapm' | 'eSkill'

interface Sort {
  key: SortKey
  descending: boolean
}

/** What a column sorts by, or undefined for a player without it, who goes last either way. */
function getSortValue(
  key: SortKey,
  person: Person,
  summary: PlayerSummary | undefined,
): number | string | undefined {
  switch (key) {
    case 'name':
      return person.name.toLowerCase()
    case 'games':
      return person.games
    case 'with':
      return person.with ? getWinRate(person.with) : undefined
    case 'against':
      return person.against ? getWinRate(person.against) : undefined
    case 'apm':
      return summary?.apm?.value
    case 'eapm':
      return summary?.eapm?.value
    case 'eSkill':
      return summary?.eSkill?.value
    default:
      return key satisfies never
  }
}

const Filters = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
`

const TablePanel = styled(StatsPanel)`
  overflow-x: auto;
`

const TableHead = styled(PanelHead)`
  justify-content: space-between;
`

const SortButton = styled.button<{ $active: boolean }>`
  ${buttonReset};
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: ${props => (props.$active ? 'var(--theme-on-surface)' : 'inherit')};
  font: inherit;
  cursor: pointer;

  &:hover {
    color: var(--theme-on-surface);
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

/** Keeps the arrow's room when it's hidden, so a column doesn't shift when it's sorted by. */
const SortArrow = styled(MaterialIcon).attrs({ size: 16 })<{ $shown: boolean }>`
  visibility: ${props => (props.$shown ? 'visible' : 'hidden')};
`

const NameColumn = styled.td`
  max-width: 280px;
`

/**
 * Everyone the user played with or against, every number about them in a column to sort by, and
 * filters for who they played them as and what race they played.
 */
export function PlayersTable({
  people,
  summaries,
}: {
  people: ReadonlyArray<Person>
  summaries: ReadonlyMap<string, PlayerSummary> | undefined
}) {
  const { t } = useTranslation()
  const format = useStatFormat()
  const [relation, setRelation] = useState<Relation>('all')
  const [race, setRace] = useState<AssignedRaceChar | undefined>()
  const [sort, setSort] = useState<Sort>({ key: 'games', descending: true })

  const rows = people
    .filter(
      p =>
        p.games > 0 &&
        (relation === 'all' || (relation === 'with' ? p.with : p.against)) &&
        (!race || p.races.some(r => r.race === race)),
    )
    .map(person => ({ person, summary: summaries?.get(person.name.toLowerCase()) }))
    .map(row => ({ ...row, sortValue: getSortValue(sort.key, row.person, row.summary) }))
    .sort((a, b) => {
      if (a.sortValue === undefined || b.sortValue === undefined) {
        return Number(a.sortValue === undefined) - Number(b.sortValue === undefined)
      }
      const order =
        typeof a.sortValue === 'string'
          ? a.sortValue.localeCompare(b.sortValue as string)
          : a.sortValue - (b.sortValue as number)
      return (sort.descending ? -order : order) || b.person.games - a.person.games
    })
  const { shown, pager } = usePaged(rows, TABLE_PAGE_SIZE)

  const relationOptions: Array<SegmentOption<Relation>> = [
    { value: 'all', label: t('players.filterEveryone', 'Everyone') },
    { value: 'with', label: t('players.filterWith', 'With') },
    { value: 'against', label: t('players.filterAgainst', 'Against') },
  ]
  const raceOptions: Array<SegmentOption<AssignedRaceChar | undefined>> = [
    { value: undefined, label: t('players.filterAnyRace', 'Any') },
    ...ALL_ASSIGNED_RACE_CHARS.map(r => ({
      value: r,
      label: r.toUpperCase(),
      title: raceCharToLabel(r, t),
    })),
  ]

  const header = (key: SortKey, label: string) => {
    const active = sort.key === key
    const direction = sort.descending ? 'descending' : 'ascending'
    return (
      <th aria-sort={active ? direction : undefined}>
        <SortButton
          type='button'
          $active={active}
          onClick={() =>
            setSort(
              active ? { key, descending: !sort.descending } : { key, descending: key !== 'name' },
            )
          }>
          {/* On the side away from the column's edge, so the label lines up with the numbers. */}
          {key === 'name' ? label : null}
          <SortArrow
            icon={active && !sort.descending ? 'arrow_upward' : 'arrow_downward'}
            $shown={active}
          />
          {key === 'name' ? null : label}
        </SortButton>
      </th>
    )
  }

  return (
    <TablePanel>
      <TableHead $flush={true}>
        <PanelTitle>{t('players.everyone', 'Everyone in your games')}</PanelTitle>
        <Filters>
          <Segmented
            label={t('players.filterRelation', 'Played with or against')}
            options={relationOptions}
            value={relation}
            onChange={setRelation}
          />
          <Segmented
            label={t('players.filterRace', 'Race they played')}
            options={raceOptions}
            value={race}
            onChange={setRace}
          />
          {pager}
        </Filters>
      </TableHead>
      <Table>
        <thead>
          <tr>
            {header('name', t('players.columnPlayer', 'Player'))}
            {header('games', t('players.columnGames', 'Games together'))}
            {header('with', t('players.columnWith', 'With'))}
            {header('against', t('players.columnAgainst', 'Against'))}
            {header('apm', t('players.columnApm', 'APM'))}
            {header('eapm', t('players.columnEapm', 'eAPM'))}
            {header('eSkill', t('players.columnESkill', 'eSkill'))}
          </tr>
        </thead>
        <tbody>
          {shown.map(({ person, summary }) => (
            <tr key={person.name}>
              <NameColumn>
                <PersonName person={person} />
              </NameColumn>
              <td>{format.format(person.games)}</td>
              <td>{person.with ? <RecordText record={person.with} /> : <Muted>-</Muted>}</td>
              <td>{person.against ? <RecordText record={person.against} /> : <Muted>-</Muted>}</td>
              <td>{summary?.apm ? format.format(summary.apm.value) : <Muted>-</Muted>}</td>
              <td>{summary?.eapm ? format.format(summary.eapm.value) : <Muted>-</Muted>}</td>
              <td>
                <ESkillText eSkill={summary?.eSkill} />
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </TablePanel>
  )
}
