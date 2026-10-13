import { createStore, Provider, useAtom } from 'jotai'
import { useState } from 'react'
import styled from 'styled-components'
import { FilledButton } from '../../material/button'
import { CheckBox } from '../../material/check-box'
import { CenteredContentContainer } from '../../styles/centered-container'
import { TitleMedium } from '../../styles/typography'
import { GgStatsHealthDialog } from '../gg-stats-health'
import { ggStatsFilesState, starcraftPathValid } from '../health-state'
import { StarcraftHealthCheckupDialog } from '../starcraft-health'

const Root = styled(CenteredContentContainer)`
  padding-block: 16px;

  display: flex;
  gap: 40px;
`

const fakeStore = createStore()

export function HealthChecksDev() {
  return (
    <Provider store={fakeStore}>
      <Root>
        <StarcraftContent />
        <GgStatsContent />
      </Root>
    </Provider>
  )
}

function StarcraftContent() {
  const [pathValid, setPathValid] = useAtom(starcraftPathValid)
  const [shown, setShown] = useState(false)

  return (
    <div>
      <TitleMedium>StarCraft</TitleMedium>
      <CheckBox
        label='StarCraft path valid'
        checked={pathValid}
        onChange={e => setPathValid(e.target.checked)}
      />
      <FilledButton
        label='Show StarCraft Health Dialog'
        onClick={() => {
          setShown(true)
        }}
      />
      {shown && (
        <StarcraftHealthCheckupDialog
          onCancel={() => {
            setShown(false)
          }}
          close={() => {
            setShown(false)
          }}
        />
      )}
    </div>
  )
}

function GgStatsContent() {
  const [checkedFiles, setFiles] = useAtom(ggStatsFilesState)
  const files = checkedFiles ?? { init: true, main: true, init64: true, main64: true }
  const [shown, setShown] = useState(false)

  return (
    <div>
      <TitleMedium>GG Stats</TitleMedium>
      <CheckBox
        label='sb_init.dll'
        checked={files.init}
        onChange={e => setFiles({ ...files, init: e.target.checked })}
      />
      <CheckBox
        label='ggstats.dll'
        checked={files.main}
        onChange={e => setFiles({ ...files, main: e.target.checked })}
      />
      <FilledButton
        label='Show GG Stats Health Dialog'
        onClick={() => {
          setShown(true)
        }}
      />
      {shown && (
        <GgStatsHealthDialog
          onCancel={() => {
            setShown(false)
          }}
          close={() => {
            setShown(false)
          }}
        />
      )}
    </div>
  )
}
