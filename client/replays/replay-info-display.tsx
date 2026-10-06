import type { Player, ReplayHeader } from '@shieldbattery/broodrep'
import { useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { getGameDurationString } from '../../common/games/game-duration'
import { FASTEST_MS_PER_FRAME } from '../../common/games/game-stats'
import { TypedIpcRenderer } from '../../common/ipc'
import { filterColorCodes } from '../../common/maps'
import { replayGameTypeToLabel, replayGameTypeToNumber } from '../../common/replays'
import { closeDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { DialogType } from '../dialogs/dialog-type'
import { useOverflowingElement } from '../dom/overflowing-element'
import { MapNoImage } from '../maps/map-image'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { Tooltip } from '../material/tooltip'
import { LoadingDotsArea } from '../progress/dots'
import { RaceIcon } from '../races/race-icon'
import { useAppDispatch } from '../redux-hooks'
import { bodyLarge, labelMedium, singleLine, titleLarge } from '../styles/typography'
import { startReplay } from './action-creators'

const ipcRenderer = new TypedIpcRenderer()

async function getReplayMetadata(
  filePath: string,
): Promise<{ headerData: ReplayHeader; players: Player[] } | undefined> {
  return ipcRenderer.invoke('replayParseMetadata', filePath)
}

const Root = styled.div``

const ErrorText = styled.div`
  ${bodyLarge};
  padding: 16px;

  color: var(--theme-error);
`

const InfoContainer = styled.div`
  display: grid;
  grid-auto-flow: row;
  grid-auto-rows: max-content;
  grid-template-columns: repeat(8, 1fr);
  grid-gap: 24px 24px;
`

const PlayerListContainer = styled.div`
  grid-column: 4 / 9;
`

const TeamLabel = styled.div`
  ${labelMedium};
  ${singleLine};

  height: 24px;
  line-height: 24px;

  color: var(--theme-on-surface-variant);
`

const PlayerContainer = styled.div`
  width: 100%;
  height: 40px;

  display: flex;
  align-items: center;
  text-align: left;

  & + ${TeamLabel} {
    margin-top: 16px;
  }
`

const RaceRoot = styled.div`
  position: relative;
  width: auto;
  height: 32px;
`

const StyledRaceIcon = styled(RaceIcon)`
  width: auto;
  height: 100%;
  aspect-ratio: 1;
`

const PlayerName = styled.div`
  ${titleLarge};
  ${singleLine};
  margin-left: 16px;
  margin-right: 8px;
  flex-grow: 1;
`

const ReplayInfoContainer = styled.div`
  grid-column: 1 / 4;
  height: auto;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
`

const MapNameTooltip = styled(Tooltip)`
  flex-shrink: 0;
`

const MapName = styled.div`
  ${titleLarge};
  ${singleLine};
  margin: 12px 0 16px;
`

const ReplayInfoText = styled.div`
  ${bodyLarge};
  ${singleLine};
  margin: 4px 0;

  color: var(--theme-on-surface-variant);
`

const MapNoImageContainer = styled.div`
  position: relative;
  width: 100%;
  height: auto;
  border-radius: var(--radius-lg);
  contain: content;
`

const TextInfoContainer = styled.div`
  max-width: 100%;
`

export interface ReplayInfoDisplayProps {
  filePath: string
  className?: string
}

export function ReplayInfoDisplay({ filePath, className }: ReplayInfoDisplayProps) {
  const { t } = useTranslation()
  const [replayMetadata, setReplayMetadata] = useState<{
    headerData: ReplayHeader
    players: Player[]
  }>()

  const [mapNameRef, isMapNameOverflowing] = useOverflowingElement()
  const [gameTypeRef, isGameTypeOverflowing] = useOverflowingElement()

  const [parseError, setParseError] = useState(null)

  useEffect(() => {
    getReplayMetadata(filePath)
      .then(data => {
        setParseError(null)
        setReplayMetadata(data)
      })
      .catch(err => setParseError(err))
  }, [filePath])

  const [durationStr, gameTypeLabel, mapName, playerListItems] = useMemo(() => {
    const replayHeader = replayMetadata?.headerData
    const players = replayMetadata?.players
    if (!replayHeader || !players) {
      return [
        '00:00',
        t('game.gameType.unknown', 'Unknown'),
        t('game.mapName.unknown', 'Unknown map'),
        null,
      ]
    }

    const timeMs = replayHeader.frames * FASTEST_MS_PER_FRAME
    const durationStr = getGameDurationString(timeMs)
    const gameTypeLabel = replayGameTypeToLabel(replayGameTypeToNumber[replayHeader.gameType], t)
    const mapName = filterColorCodes(replayHeader.mapName)

    const teams = players.reduce((acc, player) => {
      const team = acc.get(player.team)
      if (team) {
        team.push(player)
      } else {
        acc.set(player.team, [player])
      }
      return acc
    }, new Map<number, Player[]>())

    const playerListItems = Array.from(teams.values(), (team, i) => {
      const elems = team.map((player, j) => (
        <PlayerContainer key={player.slotId}>
          <RaceRoot>
            <StyledRaceIcon race={player.race} />
          </RaceRoot>
          <PlayerName>
            {player.playerType === 'computer'
              ? t('game.playerName.computer', 'Computer')
              : player.name}
          </PlayerName>
        </PlayerContainer>
      ))

      if (teams.size > 1) {
        elems.unshift(
          <TeamLabel key={`team-${i}`}>
            {t('game.teamName.number', {
              defaultValue: 'Team {{teamNumber}}',
              teamNumber: i + 1,
            })}
          </TeamLabel>,
        )
      }

      return elems
    })

    return [durationStr, gameTypeLabel, mapName, playerListItems]
  }, [replayMetadata?.headerData, replayMetadata?.players, t])

  let content
  if (parseError) {
    content = (
      <ErrorText>
        {t('replays.local.loadingError', 'There was a problem loading the replay')}
      </ErrorText>
    )
  } else if (!replayMetadata) {
    content = <LoadingDotsArea />
  } else if (replayMetadata) {
    content = (
      <InfoContainer>
        <ReplayInfoContainer>
          <MapNoImageContainer>
            <MapNoImage />
          </MapNoImageContainer>
          <MapNameTooltip text={mapName} position='bottom' disabled={!isMapNameOverflowing}>
            <MapName ref={mapNameRef}>{mapName}</MapName>
          </MapNameTooltip>
          <TextInfoContainer>
            <Tooltip text={gameTypeLabel} position='bottom' disabled={!isGameTypeOverflowing}>
              <ReplayInfoText ref={gameTypeRef}>
                <Trans t={t} i18nKey='replays.local.gameType'>
                  Game type: {{ gameTypeLabel }}
                </Trans>
              </ReplayInfoText>
            </Tooltip>
            <ReplayInfoText>
              <Trans t={t} i18nKey='replays.local.duration'>
                Duration: {{ durationStr }}
              </Trans>
            </ReplayInfoText>
          </TextInfoContainer>
        </ReplayInfoContainer>
        <PlayerListContainer>{playerListItems}</PlayerListContainer>
      </InfoContainer>
    )
  }

  return <Root className={className}>{content}</Root>
}

const StyledDialog = styled(Dialog)`
  max-width: 800px;
`

interface ReplayInfoDialogProps extends CommonDialogProps {
  filePath: string
}

export function ReplayInfoDialog({ filePath, onCancel }: ReplayInfoDialogProps) {
  const dispatch = useAppDispatch()
  const { t } = useTranslation()

  return (
    <StyledDialog
      onCancel={onCancel}
      title={t('replays.replayInfoDialog.title', 'Replay info')}
      showCloseButton={true}
      buttons={[
        <TextButton key='cancel' onClick={onCancel} label={t('common.actions.cancel', 'Cancel')} />,
        <TextButton
          key='watch'
          onClick={() => {
            dispatch(closeDialog(DialogType.ReplayInfo))
            dispatch(startReplay({ path: filePath }))
          }}
          label={t('replays.replayInfoDialog.watch', 'Watch')}
        />,
      ]}>
      <ReplayInfoDisplay filePath={filePath} />
    </StyledDialog>
  )
}
