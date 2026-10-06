import { atom, useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { TypedIpcRenderer } from '../../common/ipc'
import { UpdateStatus } from '../../common/updates'
import { MaterialIcon } from '../icons/material/material-icon'
import { jotaiStore } from '../jotai-store'
import { buttonReset } from '../material/button-reset'
import { Tooltip } from '../material/tooltip'
import { labelMedium } from '../styles/typography'

const ipcRenderer = new TypedIpcRenderer()

export const updateStatusAtom = atom<UpdateStatus>({ kind: 'none' })

export function registerUpdateStatusHandlers() {
  ipcRenderer.on('updaterStatusChanged', (_, status) => {
    jotaiStore.set(updateStatusAtom, status)
  })
  ipcRenderer
    .invoke('updaterGetStatus')
    ?.then(status => jotaiStore.set(updateStatusAtom, status))
    .catch(swallowNonBuiltins)
}

const RestartButton = styled.button`
  ${buttonReset};
  ${labelMedium};
  height: 28px;
  padding: 0 12px 0 8px;
  flex-shrink: 0;

  display: flex;
  align-items: center;
  gap: 6px;

  background-color: var(--theme-container-high);
  border-radius: var(--radius-full);
  box-shadow: inset 0 0 0 1px var(--theme-outline-variant);
  color: var(--theme-on-surface);
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  -webkit-app-region: no-drag;

  & > :first-child {
    color: var(--theme-positive);
  }

  &:hover {
    background-color: var(--theme-container-highest);
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

/** Restarts into a downloaded update. Shows only once one is ready. */
export function RestartToUpdateButton() {
  const { t } = useTranslation()
  const status = useAtomValue(updateStatusAtom)
  if (status.kind !== 'ready') {
    return null
  }
  return (
    <Tooltip
      text={t(
        'updates.restartTooltip',
        'Version {{version}} is ready. It also installs the next time GG Stats quits.',
        { version: status.version },
      )}
      position='bottom'>
      <RestartButton
        type='button'
        onClick={() => {
          ipcRenderer.invoke('updaterRestart')?.catch(swallowNonBuiltins)
        }}>
        <MaterialIcon icon='update' size={18} />
        {t('updates.restart', 'Restart to update')}
      </RestartButton>
    </Tooltip>
  )
}
