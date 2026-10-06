import { useTranslation } from 'react-i18next'
import styled, { keyframes } from 'styled-components'
import { ReplayBackfillProgress } from '../../common/replays-library'
import { labelMedium } from '../styles/typography'

const ProgressTrack = styled.div`
  position: relative;
  width: 100%;
  height: 4px;
  border-radius: var(--radius-full);
  overflow: hidden;
  background-color: var(--theme-container-highest);
`

const ProgressFill = styled.div<{ $scale: number }>`
  position: absolute;
  inset: 0;
  border-radius: var(--radius-full);
  background-color: var(--theme-info);
  transform: ${props => `scaleX(${props.$scale})`};
  transform-origin: 0% 50%;
  transition: transform 120ms linear;
  will-change: transform;
`

const indeterminateSlide = keyframes`
  0% { transform: translateX(-100%); }
  100% { transform: translateX(350%); }
`

const IndeterminateFill = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  width: 40%;
  border-radius: var(--radius-full);
  background-color: var(--theme-info);
  animation: ${indeterminateSlide} 1.15s ease-in-out infinite;
  will-change: transform;
`

const BackfillBar = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 4px;
`

const BackfillLabel = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
`

/**
 * A slim progress indicator shown above the library while the index backfills: an indeterminate
 * bar while the folder is being scanned (total unknown), then a determinate bar with a running
 * count as replays are parsed.
 */
export function BackfillProgressBar({ backfill }: { backfill: ReplayBackfillProgress }) {
  const { t } = useTranslation()

  if (backfill.phase === 'scanning') {
    return (
      <BackfillBar>
        <BackfillLabel>
          {t('replays.library.scanningTitle', 'Scanning your replay folder…')}
        </BackfillLabel>
        <ProgressTrack>
          <IndeterminateFill />
        </ProgressTrack>
      </BackfillBar>
    )
  }

  const { done, total } = backfill
  const scale = total > 0 ? done / total : 0
  return (
    <BackfillBar>
      <BackfillLabel>
        {t('replays.library.indexingCountLine', {
          defaultValue: 'Indexing replays… {{done}}/{{total}}',
          done,
          total,
        })}
      </BackfillLabel>
      <ProgressTrack>
        <ProgressFill $scale={scale} />
      </ProgressTrack>
    </BackfillBar>
  )
}
