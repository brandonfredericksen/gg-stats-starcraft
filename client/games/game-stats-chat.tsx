import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { getErrorStack } from '../../common/errors'
import { getGameDurationString } from '../../common/games/game-duration'
import { GamePlayerStats } from '../../common/games/game-stats'
import { ReplayChatMessage } from '../../common/games/replay-chat'
import { TypedIpcRenderer } from '../../common/ipc'
import logger from '../logging/logger'
import { RaceTag } from '../material/race-tag'
import { selectableTextContainer } from '../styles/text-selection'
import { bodyMedium, labelLarge, singleLine } from '../styles/typography'
import {
  PlayerSwatch,
  Section,
  SectionErrorBoundary,
  SectionNote,
  SectionTitle,
  StatsPanel,
} from './game-stats-shared'

const ipcRenderer = new TypedIpcRenderer()

/** Long chats scroll rather than stretch the page, and can be selected to copy. */
const MessageList = styled.ol`
  ${selectableTextContainer};
  max-height: 560px;
  margin: 0;
  padding: 6px 0;
  overflow-y: auto;
  list-style: none;
`

const MessageRow = styled.li`
  ${bodyMedium};
  display: grid;
  grid-template-columns: 64px minmax(0, 200px) minmax(0, 1fr);
  column-gap: 12px;
  align-items: baseline;
  padding: 6px 18px;
`

const Time = styled.span`
  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
`

const Sender = styled.span`
  ${labelLarge};
  min-width: 0;
  display: flex;
  align-items: center;
  align-self: center;
  gap: 8px;
  font-weight: 600;
`

/** A player's color and race, which copying the chat leaves out so only the name is copied. */
const SenderMarks = styled.span`
  display: contents;

  &,
  & * {
    user-select: none;
  }
`

const SenderName = styled.span`
  ${singleLine};
`

const ObserverName = styled(SenderName)`
  color: var(--theme-on-surface-variant);
  font-weight: 500;
`

const Message = styled.span`
  overflow-wrap: anywhere;
  white-space: pre-wrap;
`

const NoMessages = styled.div`
  ${bodyMedium};
  padding: 16px 18px;
  color: var(--theme-on-surface-variant);
`

function findPlayer(players: ReadonlyArray<GamePlayerStats>, name: string) {
  return players.find(p => p.names.includes(name))
}

function ChatMessageRow({
  message,
  players,
  playerColors,
}: {
  message: ReplayChatMessage
  players: ReadonlyArray<GamePlayerStats>
  playerColors: ReadonlyMap<number, string>
}) {
  const { t } = useTranslation()
  const player = findPlayer(players, message.name)
  const name = message.name || t('gameStats.chatUnknownSender', 'Unknown')
  return (
    <MessageRow>
      <Time>{getGameDurationString(message.timeMs)}</Time>
      <Sender title={name}>
        {player ? (
          <>
            <SenderMarks>
              <PlayerSwatch $color={playerColors.get(player.id) ?? 'transparent'} />
              {player.race ? <RaceTag race={player.race} /> : null}
            </SenderMarks>
            <SenderName>{name}</SenderName>
          </>
        ) : (
          <ObserverName>
            {message.isObserver
              ? t('gameStats.chatObserver', '{{name}} (observer)', { name })
              : name}
          </ObserverName>
        )}
      </Sender>
      <Message>{message.message}</Message>
    </MessageRow>
  )
}

/**
 * Copies a selection that covers more than one message as one line per message, rather than the
 * time, sender and message each on a line of their own. A selection within one message copies as
 * selected.
 */
function copyMessages(
  event: React.ClipboardEvent<HTMLOListElement>,
  messages: ReplayChatMessage[],
) {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed) {
    return
  }
  const rows = Array.from(event.currentTarget.children)
  const selected = messages.filter((_, i) => rows[i] && selection.containsNode(rows[i], true))
  if (selected.length < 2) {
    return
  }
  event.preventDefault()
  event.clipboardData.setData(
    'text/plain',
    selected.map(m => `${getGameDurationString(m.timeMs)} ${m.name}: ${m.message}`).join('\n'),
  )
}

/** Everything said in the game, read from its replay, with when it was said. */
export function GameChat({
  replayPath,
  players,
  playerColors,
}: {
  replayPath: string
  players: ReadonlyArray<GamePlayerStats>
  playerColors: ReadonlyMap<number, string>
}) {
  const { t } = useTranslation()
  const [chat, setChat] = useState<{ path: string; messages?: ReplayChatMessage[] }>()

  useEffect(() => {
    let cancelled = false
    Promise.resolve(ipcRenderer.invoke('replayReadChat', replayPath))
      .then(messages => {
        if (!cancelled) {
          setChat({ path: replayPath, messages })
        }
      })
      .catch(err => {
        logger.error(`Error reading the chat in ${replayPath}: ${getErrorStack(err)}`)
        if (!cancelled) {
          setChat({ path: replayPath })
        }
      })
    return () => {
      cancelled = true
    }
  }, [replayPath])

  if (!chat || chat.path !== replayPath) {
    return null
  }
  if (!chat.messages) {
    return (
      <Section>
        <SectionTitle>{t('gameStats.chat', 'Chat')}</SectionTitle>
        <SectionNote>
          {t('gameStats.chatUnreadable', "Couldn't read the chat from this game's replay.")}
        </SectionNote>
      </Section>
    )
  }

  return (
    <Section>
      <SectionTitle>{t('gameStats.chat', 'Chat')}</SectionTitle>
      <SectionErrorBoundary>
        <StatsPanel>
          {chat.messages.length ? (
            <MessageList onCopy={event => copyMessages(event, chat.messages!)}>
              {chat.messages.map((message, i) => (
                <ChatMessageRow
                  key={i}
                  message={message}
                  players={players}
                  playerColors={playerColors}
                />
              ))}
            </MessageList>
          ) : (
            <NoMessages>{t('gameStats.noChat', 'No one said anything in this game.')}</NoMessages>
          )}
        </StatsPanel>
      </SectionErrorBoundary>
    </Section>
  )
}
