import { useState } from 'react'
import styled from 'styled-components'
import { Panel, PanelHeader, PanelRow } from '../panel'
import { PlayButton } from '../play-button'
import { RaceMix } from '../race-mix'
import { StatusPill } from '../status-pill'
import { getTeamSlotWidth, TeamLine, TeamLinePlayer, TeamLineResult } from '../team-line'
import { ToggleButton } from '../toggle-button'

const Root = styled.div`
  max-width: 1100px;
  padding: 24px;

  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 16px;

  & > ${'section'} {
    align-self: stretch;
  }
`

const Row = styled(PanelRow)`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 80px;
  align-items: center;
  gap: 16px;
`

const Lines = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const Mixes = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const Actions = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
`

interface SampleGame {
  teams: TeamLinePlayer[][]
  winner: number
  status: 'ready' | 'running' | 'none'
}

const GAMES: SampleGame[] = [
  {
    teams: [[{ name: 'Kestrel', race: 'p', isYou: true }], [{ name: 'Mordant', race: 'z' }]],
    winner: 0,
    status: 'ready',
  },
  {
    teams: [
      [
        { name: 'Kestrel', race: 'p', isYou: true },
        { name: 'Wren', race: 't' },
        { name: 'Ash', race: 'z' },
      ],
      [
        { name: 'Quarry', race: 't' },
        { name: 'Halyard', race: 'p' },
        { name: 'Tallow', race: 'z' },
      ],
    ],
    winner: 1,
    status: 'running',
  },
  {
    teams: [[{ name: 'ProximaCentauri', race: 't' }], [{ name: 'moonshotkraken', race: 'z' }]],
    winner: 1,
    status: 'none',
  },
]

function getResult(hideResults: boolean, won: boolean): TeamLineResult {
  if (hideResults) {
    return 'hidden'
  }
  return won ? 'won' : 'lost'
}

/** The pieces the library's game rows are built from. */
export function GamePartsTest() {
  const [hideResults, setHideResults] = useState(false)

  return (
    <Root>
      <ToggleButton
        pressed={hideResults}
        label={hideResults ? 'Results hidden' : 'Hide results'}
        icon={hideResults ? 'visibility_off' : 'visibility'}
        onChange={setHideResults}
      />
      <Panel>
        <PanelHeader>Tonight</PanelHeader>
        {GAMES.map((game, i) => {
          const slotWidth = getTeamSlotWidth(game.teams.flat().map(p => p.name))
          const order = hideResults ? game.teams.map((_, j) => j) : [game.winner, 1 - game.winner]
          return (
            <Row key={i}>
              <Lines>
                {order.map(t => (
                  <TeamLine
                    key={t}
                    players={game.teams[t]}
                    slotWidth={slotWidth}
                    wonLabel='Won'
                    result={getResult(hideResults, t === game.winner)}
                  />
                ))}
              </Lines>
              <Actions>
                <PlayButton label='Watch replay' />
                <StatusPill
                  status={game.status}
                  readyLabel='View stats'
                  runningLabel='Analyzing'
                  noneLabel='Analyze'
                />
              </Actions>
            </Row>
          )
        })}
      </Panel>
      <Mixes>
        <RaceMix races={[{ race: 'p', games: 4 }]} />
        <RaceMix
          races={[
            { race: 'z', games: 2 },
            { race: 'p', games: 1 },
          ]}
        />
        <RaceMix
          races={[
            { race: 't', games: 5 },
            { race: 'z', games: 4 },
            { race: 'p', games: 1 },
          ]}
        />
        <RaceMix
          races={[
            { race: 'p', games: 1 },
            { race: 't', games: 1 },
            { race: 'z', games: 1 },
          ]}
        />
      </Mixes>
    </Root>
  )
}
