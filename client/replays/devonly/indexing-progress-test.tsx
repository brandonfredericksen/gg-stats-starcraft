import { useEffect, useState } from 'react'
import styled from 'styled-components'
import { ReplayBackfillProgress } from '../../../common/replays-library'
import { FilledButton } from '../../material/button'
import { CenteredContentContainer } from '../../styles/centered-container'
import { titleSmall } from '../../styles/typography'
import { BackfillProgressBar } from '../backfill-progress'
import { ReplayLibraryUnavailable } from '../replay-library'

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding: var(--space-6);
`

const Case = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);

  border: 1px solid var(--theme-outline-variant);
  border-radius: 2px;
`

const CaseLabel = styled.div`
  ${titleSmall};
  padding: var(--space-3) var(--space-4) 0;
  color: var(--theme-on-surface-variant);
`

const CaseBody = styled.div`
  padding: 0 var(--space-4) var(--space-4);
`

const Controls = styled.div`
  display: flex;
  gap: var(--space-3);
  align-items: center;
  padding: 0 var(--space-4) var(--space-3);
`

const DEMO_TOTAL = 11_248

/** A backfill whose `done` climbs from 0 to `DEMO_TOTAL` and back, to mimic a live index. */
function useAnimatedBackfill(running: boolean): ReplayBackfillProgress {
  const [done, setDone] = useState(0)

  useEffect(() => {
    if (!running) return undefined
    const interval = setInterval(() => {
      setDone(prev => (prev >= DEMO_TOTAL ? 0 : Math.min(DEMO_TOTAL, prev + 137)))
    }, 60)
    return () => clearInterval(interval)
  }, [running])

  return { phase: 'indexing', done, total: DEMO_TOTAL }
}

function StaticCase({ label, backfill }: { label: string; backfill: ReplayBackfillProgress }) {
  return (
    <Case>
      <CaseLabel>{label}</CaseLabel>
      <CaseBody>
        <BackfillProgressBar backfill={backfill} />
      </CaseBody>
    </Case>
  )
}

function AnimatedCase() {
  const [running, setRunning] = useState(true)
  const backfill = useAnimatedBackfill(running)
  return (
    <Case>
      <CaseLabel>Indexing (animated)</CaseLabel>
      <CaseBody>
        <BackfillProgressBar backfill={backfill} />
      </CaseBody>
      <Controls>
        <FilledButton label={running ? 'Pause' : 'Resume'} onClick={() => setRunning(r => !r)} />
      </Controls>
    </Case>
  )
}

export function IndexingProgressTest() {
  return (
    <CenteredContentContainer $targetWidth={960}>
      <Container>
        <StaticCase label='Scanning' backfill={{ phase: 'scanning' }} />
        <AnimatedCase />
        <StaticCase
          label='Indexing (start)'
          backfill={{ phase: 'indexing', done: 0, total: 11_248 }}
        />
        <StaticCase
          label='Indexing (partway)'
          backfill={{ phase: 'indexing', done: 4_137, total: 11_248 }}
        />
        <StaticCase
          label='Indexing (nearly done)'
          backfill={{ phase: 'indexing', done: 11_020, total: 11_248 }}
        />
        <Case>
          <CaseLabel>Unavailable</CaseLabel>
          <ReplayLibraryUnavailable />
        </Case>
      </Container>
    </CenteredContentContainer>
  )
}
