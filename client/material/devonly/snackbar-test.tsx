import styled from 'styled-components'
import { DURATION_LONG } from '../../snackbars/snackbar-durations'
import { useSnackbarController } from '../../snackbars/snackbar-overlay'
import { CenteredContentContainer } from '../../styles/centered-container'
import { FilledButton } from '../button'
import { Snackbar } from '../snackbar'

const Root = styled.div`
  height: calc(100% - 24px);
  margin-top: 24px;

  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
`

const StaticSnackbars = styled.div`
  flex-grow: 1;

  display: flex;
  flex-direction: column;

  align-items: center;
  justify-content: center;
  gap: 16px;
`

const Buttons = styled.div`
  padding-block: 24px;

  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px;
`

export function SnackbarTest() {
  const snackbarController = useSnackbarController()

  return (
    <CenteredContentContainer>
      <Root>
        <StaticSnackbars>
          <Snackbar message='Analyzing 25 games in the background' onDismiss={() => {}} />
          <Snackbar
            message='New game analyzed: TvZ on Polypoid'
            tone='success'
            actionLabel='View stats'
            durationMillis={DURATION_LONG}
            onDismiss={() => {}}
          />
          <Snackbar
            message="Couldn't find your last game."
            tone='error'
            count={3}
            onDismiss={() => {}}
          />
          <Snackbar
            message={
              'This snackbar has a really, super, crazy long message that should wrap and ' +
              'not look completely terrible hopefully. It also has an action.'
            }
            actionLabel='Acknowledge'
            onDismiss={() => {}}
          />
        </StaticSnackbars>
        <Buttons>
          <FilledButton
            onClick={() => snackbarController.showSnackbar('Moved 12 replays to Recycle Bin')}
            label='Info'
          />
          <FilledButton
            onClick={() =>
              snackbarController.showSnackbar('New game analyzed: PvT on Fighting Spirit', {
                durationMillis: DURATION_LONG,
                tone: 'success',
                action: { label: 'View stats', onClick: () => {} },
              })
            }
            label='Success with action'
          />
          <FilledButton
            onClick={() =>
              snackbarController.showSnackbar('There was an issue saving the settings.', {
                tone: 'error',
              })
            }
            label='Error'
          />
          <FilledButton
            onClick={() => {
              for (let i = 1; i <= 10; i++) {
                snackbarController.showSnackbar(`New game analyzed: game ${i} of 10`, {
                  tone: 'success',
                })
              }
            }}
            label='Burst of 10'
          />
        </Buttons>
      </Root>
    </CenteredContentContainer>
  )
}
