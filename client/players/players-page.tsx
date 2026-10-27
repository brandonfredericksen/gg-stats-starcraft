import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { getErrorStack } from '../../common/errors'
import { TypedIpcRenderer } from '../../common/ipc'
import { PersonRow, WinLoss } from '../../common/my-stats/my-stats'
import { AssignedRaceChar } from '../../common/races'
import { urlPath } from '../../common/urls'
import { SectionErrorBoundary, StatsPanel } from '../games/game-stats-shared'
import { useMyPlayerNames } from '../games/my-player-names'
import { MaterialIcon } from '../icons/material/material-icon'
import { buttonReset } from '../material/button-reset'
import { RaceMix } from '../material/race-mix'
import logger from '../logging/logger'
import {
  Muted,
  PaddedPanel,
  PanelHead,
  PanelTitle,
  People,
  RecordText,
} from '../my-stats/my-stats-panels'
import { push } from '../navigation/routing'
import { bodyMedium, headlineMedium, labelLarge, labelMedium } from '../styles/typography'
import { useKnownPlayers } from './known-players'
import { useRecentPlayers } from './open-player'

const ipcRenderer = new TypedIpcRenderer()

/** How many players a search lists. */
const MAX_RESULTS = 25

const Root = styled.div`
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  padding: 22px 32px 56px;

  display: flex;
  flex-direction: column;
  gap: var(--space-4);
`

const Header = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3) var(--space-6);
`

const Title = styled.h1`
  ${headlineMedium};
  margin: 0;
`

const Search = styled.label`
  flex: 1 1 320px;
  max-width: 480px;
  height: 40px;
  padding: 0 14px;

  display: flex;
  align-items: center;
  gap: var(--space-2);

  border: 1px solid var(--theme-outline-variant);
  border-radius: var(--radius-md);
  background-color: var(--theme-container-low);
  color: var(--theme-on-surface-variant);

  &:focus-within {
    border-color: var(--theme-outline);
  }
`

const SearchInput = styled.input`
  ${bodyMedium};
  flex: 1 1 auto;
  min-width: 0;

  border: none;
  outline: none;
  background: transparent;
  color: var(--theme-on-surface);

  &::placeholder {
    color: var(--theme-on-surface-variant);
  }
`

const Recent = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
`

const RecentChip = styled.button`
  ${buttonReset};
  ${labelLarge};
  height: 32px;
  padding: 0 var(--space-3) 0 var(--space-2);

  display: inline-flex;
  align-items: center;
  gap: var(--space-2);

  background-color: var(--theme-container-high);
  border-radius: var(--radius-md);
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

const Columns = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
  align-items: stretch;

  @media (max-width: 960px) {
    grid-template-columns: minmax(0, 1fr);
  }
`

const Results = styled(StatsPanel)`
  padding: var(--space-2) 0;
  display: flex;
  flex-direction: column;
`

const ResultRow = styled.button<{ $first: boolean }>`
  ${buttonReset};
  min-height: 44px;
  padding: 0 var(--space-5);

  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) 96px 112px 112px;
  gap: var(--space-3);
  align-items: center;

  background-color: ${props => (props.$first ? 'var(--theme-container-high)' : 'transparent')};
  text-align: left;
  cursor: pointer;

  &:hover {
    background-color: var(--theme-container-high);
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: -3px;
  }
`

const ResultName = styled.span`
  ${labelLarge};
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
`

const ResultCell = styled.span`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
  text-align: right;
  white-space: nowrap;
`

const Message = styled(PaddedPanel)`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

/** Someone the user played with, against, or opened, with their record together. */
interface Person {
  name: string
  races: Array<{ race: AssignedRaceChar; games: number }>
  games: number
  with?: WinLoss
  against?: WinLoss
}

/** Everyone the user has played with or against, once each, most games first. */
function toPeople(teammates: ReadonlyArray<PersonRow>, opponents: ReadonlyArray<PersonRow>) {
  const byName = new Map<string, Person>()
  for (const row of [...teammates, ...opponents]) {
    const key = row.name.toLowerCase()
    const person = byName.get(key) ?? { name: row.name, races: [], games: 0 }
    person.games += row.games
    if (row.races.length > person.races.length) {
      person.races = row.races
    }
    if (row.relation === 'teammate') {
      person.with = row
    } else {
      person.against = row
    }
    byName.set(key, person)
  }
  return Array.from(byName.values()).sort((a, b) => b.games - a.games)
}

function openPlayer(name: string) {
  push(urlPath`/players/${name}`)
}

interface PeopleData {
  teammates: PersonRow[]
  opponents: PersonRow[]
}

/** The people in the user's analyzed games, with and against them. */
function usePeopleData(myNames: ReadonlyArray<string>) {
  const [data, setData] = useState<PeopleData | 'error'>()
  const namesKey = myNames.join('\n')

  useEffect(() => {
    if (!namesKey) {
      return undefined
    }
    let current = true
    Promise.resolve(
      ipcRenderer.invoke('myStatsQuery', { names: namesKey.split('\n'), range: 'all' }),
    )
      .then(summary => {
        if (current && summary) {
          setData({ teammates: summary.stats.teammates, opponents: summary.stats.opponents })
        }
      })
      .catch(err => {
        logger.error(`Error loading the people in your games: ${getErrorStack(err)}`)
        if (current) {
          setData('error')
        }
      })
    return () => {
      current = false
    }
  }, [namesKey])

  return data
}

/**
 * The players a search finds, the one Enter opens first: an exact match, then the rest by games
 * together. Anyone can be looked up by name, even someone the user never played, since their games
 * may be in the ladder games the app ships, so the name as typed comes last.
 */
function getSearchRows(query: string, people: ReadonlyArray<Person>): Person[] {
  const typed = query.trim()
  const lower = typed.toLowerCase()
  const matches = people
    .filter(p => p.name.toLowerCase().includes(lower))
    .sort((a, b) => Number(b.name.toLowerCase() === lower) - Number(a.name.toLowerCase() === lower))
    .slice(0, MAX_RESULTS)
  return matches.some(p => p.name.toLowerCase() === lower)
    ? matches
    : [...matches, { name: typed, races: [], games: 0 }]
}

function SearchResults({ query, people }: { query: string; people: ReadonlyArray<Person> }) {
  const { t } = useTranslation()
  const rows = getSearchRows(query, people)
  return (
    <Results role='listbox' aria-label={t('players.results', 'Players found')}>
      {rows.map((person, i) => (
        <ResultRow
          key={person.name}
          type='button'
          role='option'
          aria-selected={i === 0}
          $first={i === 0}
          onClick={() => openPlayer(person.name)}>
          <span>{person.races.length ? <RaceMix races={person.races} /> : null}</span>
          <ResultName>{person.name}</ResultName>
          <ResultCell>
            {person.games
              ? t('players.resultGames', {
                  defaultValue: '{{count}} games',
                  defaultValue_one: '1 game',
                  count: person.games,
                })
              : t('players.resultOpen', 'Open')}
          </ResultCell>
          <ResultCell>
            {person.with ? (
              <>
                {t('players.resultWith', 'With')} <RecordText record={person.with} />
              </>
            ) : null}
          </ResultCell>
          <ResultCell>
            {person.against ? (
              <>
                {t('players.resultAgainst', 'Against')} <RecordText record={person.against} />
              </>
            ) : null}
          </ResultCell>
        </ResultRow>
      ))}
    </Results>
  )
}

/**
 * Every player the user can look up: a search by name, the players they opened lately, and the
 * people they play with and against most. Each opens that player's page.
 */
export function PlayersPage() {
  const { t } = useTranslation()
  const myNames = useMyPlayerNames() ?? []
  const knownPlayers = useKnownPlayers()
  const recent = useRecentPlayers()
  const data = usePeopleData(myNames)
  const [query, setQuery] = useState('')

  const people = data && data !== 'error' ? toPeople(data.teammates, data.opponents) : []
  const known = new Set(people.map(p => p.name.toLowerCase()))
  // Noted and recently opened players can be found too, even with no games together.
  for (const name of [...recent, ...knownPlayers.flatMap(p => p.accounts)]) {
    if (!known.has(name.toLowerCase())) {
      known.add(name.toLowerCase())
      people.push({ name, races: [], games: 0 })
    }
  }
  const racesOf = (name: string) =>
    people.find(p => p.name.toLowerCase() === name.toLowerCase())?.races ?? []

  return (
    <Root>
      <Header>
        <Title>{t('navigation.players', 'Players')}</Title>
        <Search>
          <MaterialIcon icon='search' size={18} />
          <SearchInput
            type='search'
            autoFocus={true}
            value={query}
            placeholder={t('players.searchPlaceholder', 'Find a player by name')}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && query.trim()) {
                openPlayer(getSearchRows(query, people)[0].name)
              }
            }}
          />
        </Search>
      </Header>

      {query.trim() ? (
        <SearchResults query={query} people={people} />
      ) : (
        <>
          {recent.length ? (
            <PaddedPanel>
              <PanelHead>
                <PanelTitle>{t('players.recent', 'Opened lately')}</PanelTitle>
              </PanelHead>
              <Recent>
                {recent.map(name => (
                  <RecentChip key={name} type='button' onClick={() => openPlayer(name)}>
                    {racesOf(name).length ? <RaceMix races={racesOf(name)} /> : null}
                    {name}
                  </RecentChip>
                ))}
              </Recent>
            </PaddedPanel>
          ) : null}
          {data === 'error' ? (
            <Message role='alert'>
              {t('players.loadFailed', "The people in your games couldn't be loaded.")}
            </Message>
          ) : null}
          {data && data !== 'error' ? (
            <Columns>
              <SectionErrorBoundary>
                <People
                  title={t('players.playedWith', 'Played with most')}
                  people={data.teammates}
                  opensPage={true}
                />
              </SectionErrorBoundary>
              <SectionErrorBoundary>
                <People
                  title={t('players.playedAgainst', 'Played against most')}
                  people={data.opponents}
                  opensPage={true}
                />
              </SectionErrorBoundary>
            </Columns>
          ) : null}
          {!myNames.length ? (
            <Message>
              <Muted>
                {t(
                  'players.noNames',
                  'Set your player names in Settings to see who you play with and against.',
                )}
              </Muted>
            </Message>
          ) : null}
        </>
      )}
    </Root>
  )
}
