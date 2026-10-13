import { useAtomValue } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { getErrorStack } from '../../common/errors'
import { getGameDurationString } from '../../common/games/game-duration'
import { GamePlayerStats } from '../../common/games/game-stats'
import { ReplayChat, ReplayChatMessage } from '../../common/games/replay-chat'
import { TypedIpcRenderer } from '../../common/ipc'
import logger from '../logging/logger'
import { RaceTag } from '../material/race-tag'
import { selectableTextContainer } from '../styles/text-selection'
import { bodyMedium, labelLarge, singleLine } from '../styles/typography'
import { Side } from './game-stats-model'
import { gameScrubAtom } from './game-stats-scrub'
import {
  CURRENT_ROW_BACKGROUND,
  findCurrentIndex,
  FUTURE_ROW_OPACITY,
  keepInView,
  PlayerSwatch,
  Section,
  SectionErrorBoundary,
  SectionNote,
  SectionTitle,
  StatsPanel,
} from './game-stats-shared'

const ipcRenderer = new TypedIpcRenderer()

/**
 * Beside something taller, the chat takes up the same height, however much was said, and scrolls
 * inside it. Its minimum is kept low so that in team games, where the production box above it is
 * tall, the chat doesn't make the column taller than the minimap beside it.
 */
const FillingPanel = styled(StatsPanel)<{ $fill: boolean }>`
  ${props =>
    props.$fill
      ? `
        flex: 1 1 0;
        min-height: 120px;
        contain: size;
      `
      : ''}
`

/**
 * Long chats scroll rather than stretch the page, and can be selected to copy. The columns are
 * shared by every message: the times and names take only the width they need, but the messages
 * always get at least 60% of it, and names that don't fit in the rest are cut short.
 */
const MessageList = styled.ol<{ $fill: boolean }>`
  ${selectableTextContainer};
  max-height: ${props => (props.$fill ? '100%' : '560px')};
  margin: 0;
  padding: 6px 0;
  overflow-y: auto;
  list-style: none;

  display: grid;
  grid-template-columns: max-content minmax(0, max-content) minmax(60%, 1fr);
  align-content: start;
  column-gap: 12px;
`

const MessageRow = styled.li<{ $current: boolean; $future: boolean }>`
  ${bodyMedium};
  background: ${props => (props.$current ? CURRENT_ROW_BACKGROUND : 'transparent')};
  opacity: ${props => (props.$future ? FUTURE_ROW_OPACITY : 1)};
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: subgrid;
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
  current,
  future,
}: {
  message: ReplayChatMessage
  players: ReadonlyArray<GamePlayerStats>
  playerColors: ReadonlyMap<number, string>
  /** Whether it's the last message said by the moment picked. */
  current: boolean
  /** Whether it was said after the moment picked. */
  future: boolean
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (current && ref.current?.parentElement) {
      keepInView(ref.current.parentElement, ref.current)
    }
  }, [current])
  const player = findPlayer(players, message.name)
  const name = message.name || t('gameStats.chatUnknownSender', 'Unknown')
  return (
    <MessageRow ref={ref} $current={current} $future={future}>
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

/**
 * Says which teams' ally chat the replay is missing. A replay only has the chat the person who
 * saved it could see, so ally chat between the players of any other team, or of every team if an
 * observer saved it, isn't in it.
 */
export function MissingAllyChatNote({
  chat,
  players,
  teamsByPlayer,
}: {
  chat: LoadedReplayChat
  players: ReadonlyArray<GamePlayerStats>
  teamsByPlayer: ReadonlyMap<number, Side>
}) {
  const { t, i18n } = useTranslation()
  if (!chat.chat) {
    return null
  }
  const { recorder } = chat.chat
  const recorderPlayer =
    recorder && !recorder.isObserver ? findPlayer(players, recorder.name) : undefined
  const recorderTeam = recorderPlayer ? teamsByPlayer.get(recorderPlayer.id) : undefined
  // A player alone on their team has no one to ally chat with.
  const missing = Array.from(new Set(teamsByPlayer.values()))
    .filter(team => team !== recorderTeam && team.players.length > 1)
    .sort((a, b) => a.number - b.number)
  if (!missing.length) {
    return null
  }

  const teams = new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(
    missing.map(team => t('gameStats.teamName', 'Team {{number}}', { number: team.number })),
  )
  let note
  if (!recorder) {
    note = t(
      'gameStats.chatAllyUnknownRecorder',
      'A replay only has the ally chat of the team that saved it.',
    )
  } else if (recorder.isObserver) {
    note = t(
      'gameStats.chatAllyObserverRecorder',
      'An observer saved this replay, so it has no ally chat from {{teams}}.',
      { teams },
    )
  } else {
    note = t(
      'gameStats.chatAllyPlayerRecorder',
      '{{name}} saved this replay, so it has no ally chat from {{teams}}.',
      { name: recorder.name, teams },
    )
  }
  return <SectionNote>{note}</SectionNote>
}

/** A replay's chat, once read, or none if it couldn't be. */
export interface LoadedReplayChat {
  path: string
  chat?: ReplayChat
}

/** Reads the chat from `replayPath`, giving undefined until it's done. */
export function useReplayChat(replayPath: string | undefined): LoadedReplayChat | undefined {
  const [chat, setChat] = useState<LoadedReplayChat>()

  useEffect(() => {
    if (!replayPath) {
      return undefined
    }
    let cancelled = false
    Promise.resolve(ipcRenderer.invoke('replayReadChat', replayPath))
      .then(replayChat => {
        if (!cancelled) {
          setChat({ path: replayPath, chat: replayChat })
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

  return replayPath && chat?.path === replayPath ? chat : undefined
}

/**
 * Everything said in the game, read from its replay, with when it was said. The note on which ally
 * chat the replay is missing is {@link MissingAllyChatNote}, apart from this so it can sit on the
 * same row as the minimap's note.
 */
export function GameChat({
  chat,
  players,
  playerColors,
  fill = false,
}: {
  chat: LoadedReplayChat
  players: ReadonlyArray<GamePlayerStats>
  playerColors: ReadonlyMap<number, string>
  /** Whether to take up the height it's given, like beside the minimap, rather than its own. */
  fill?: boolean
}) {
  const { t } = useTranslation()
  const scrubMs = useAtomValue(gameScrubAtom)?.timeMs

  if (!chat.chat) {
    return (
      <Section>
        <SectionTitle>{t('gameStats.chat', 'Chat')}</SectionTitle>
        <SectionNote>
          {t('gameStats.chatUnreadable', "Couldn't read the chat from this game's replay.")}
        </SectionNote>
      </Section>
    )
  }

  const { messages } = chat.chat
  const currentIndex = findCurrentIndex(messages, scrubMs)
  return (
    <Section>
      <SectionTitle>{t('gameStats.chat', 'Chat')}</SectionTitle>
      <SectionErrorBoundary>
        <FillingPanel $fill={fill}>
          {messages.length ? (
            <MessageList $fill={fill} onCopy={event => copyMessages(event, messages)}>
              {messages.map((message, i) => (
                <ChatMessageRow
                  key={i}
                  message={message}
                  players={players}
                  playerColors={playerColors}
                  current={i === currentIndex}
                  future={scrubMs !== undefined && message.timeMs > scrubMs}
                />
              ))}
            </MessageList>
          ) : (
            <NoMessages>{t('gameStats.noChat', 'No one said anything in this game.')}</NoMessages>
          )}
        </FillingPanel>
      </SectionErrorBoundary>
    </Section>
  )
}
