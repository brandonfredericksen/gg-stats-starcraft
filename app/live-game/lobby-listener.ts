import { EventEmitter } from 'node:events'
import { LiveGamePlayer } from '../../common/live-game'
import { RaceChar } from '../../common/races'

/** The parts of a WebSocket the listener uses. It never sends a message. */
export interface LobbySocket {
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: (() => void) | null
  onerror: (() => void) | null
  close: () => void
}

export type ConnectLobbySocket = (url: string) => LobbySocket

/** A lobby resends every slot every 5 seconds, so this long without a word means it's gone. */
export const SILENT_MS = 20_000
/** How long the socket gets to open. */
export const CONNECT_MS = 5000
/** Lobby messages are a few kilobytes. A message this big that never parses is dropped. */
export const MAX_MESSAGE_SIZE = 1024 * 1024
/** A countdown at this or less when the page closes was the game starting. */
const LAST_COUNT = 1
/** How long slot changes are gathered before they're reported together. */
export const EMIT_DELAY_MS = 50
/** How many chatters' identities are kept, to fill in the players who chat. */
const MAX_IDENTITIES = 32

const RACES: Readonly<Record<string, RaceChar>> = {
  Protoss: 'p',
  Random: 'r',
  Terran: 't',
  Zerg: 'z',
}

interface Slot {
  name: string
  race?: RaceChar
  observer: boolean
}

interface Identity {
  battleTag?: string
  gatewayId?: number
}

export type LobbyListenerEvents = {
  /** Everyone in the lobby, whenever that changes. */
  players: [players: LiveGamePlayer[]]
  /** The host started the game and its countdown ran out. */
  starting: []
  /** The lobby's page is gone: the game started, or the user left. Nothing follows. */
  end: []
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

/**
 * Listens to a StarCraft lobby's page socket, which the game uses to tell the page who's in each
 * slot. It only listens: no message is ever sent, so the lobby works as if it weren't there.
 */
export class LobbyListener extends EventEmitter<LobbyListenerEvents> {
  private socket: LobbySocket | undefined
  private silenceTimer: ReturnType<typeof setTimeout> | undefined
  private silenceMs = 0
  private emitTimer: ReturnType<typeof setTimeout> | undefined
  /** The countdown's last number, while one is running. */
  private countdown: number | undefined
  private partial = ''
  private slots = new Map<number, Slot>()
  private identities = new Map<string, Identity>()
  private lastPlayers = ''
  private started = false
  private ended = false

  constructor(
    private readonly port: number,
    private readonly panelId: number,
    private readonly connect: ConnectLobbySocket,
  ) {
    super()
  }

  start() {
    let socket: LobbySocket
    try {
      socket = this.connect(`ws://127.0.0.1:${this.port}/panel/GameLobbyPanel/${this.panelId}`)
    } catch {
      this.end()
      return
    }
    this.socket = socket
    socket.onmessage = event => this.onData(event.data)
    socket.onclose = () => this.end()
    socket.onerror = () => this.end()
    socket.onopen = () => this.resetSilence(SILENT_MS)
    this.resetSilence(CONNECT_MS)
  }

  /** Closes the socket. Nothing is emitted after. */
  stop() {
    this.ended = true
    this.cleanUp()
  }

  private resetSilence(ms: number) {
    // Each message pushes the timer back, so it's moved rather than made again.
    if (this.silenceTimer && this.silenceMs === ms) {
      this.silenceTimer.refresh()
      return
    }
    clearTimeout(this.silenceTimer)
    this.silenceMs = ms
    this.silenceTimer = setTimeout(() => this.end(), ms)
    this.silenceTimer.unref?.()
  }

  private cleanUp() {
    clearTimeout(this.silenceTimer)
    this.silenceTimer = undefined
    clearTimeout(this.emitTimer)
    this.emitTimer = undefined
    const socket = this.socket
    this.socket = undefined
    if (socket) {
      socket.onopen = null
      socket.onmessage = null
      socket.onclose = null
      socket.onerror = null
      try {
        socket.close()
      } catch {
        // Already closed.
      }
    }
    this.partial = ''
    this.slots.clear()
    this.identities.clear()
  }

  private end() {
    if (this.ended) {
      return
    }
    this.ended = true
    // The page goes away as the game starts, which a countdown about to run out when it does
    // means, whether or not its last number made it here. Leaving earlier in a countdown closes
    // it too, without the game starting.
    const starting = !this.started && this.countdown !== undefined && this.countdown <= LAST_COUNT
    this.cleanUp()
    if (starting) {
      this.emit('starting')
    }
    this.emit('end')
  }

  private onData(data: unknown) {
    if (typeof data !== 'string') {
      return
    }
    this.resetSilence(SILENT_MS)
    const message = tryParse(data)
    if (message !== undefined) {
      this.partial = ''
      this.onMessage(asRecord(asRecord(message)?.data))
      return
    }
    // A big message can come split over several pieces. One that starts a new message replaces
    // whatever came before, so a piece that never parses can't hold up the ones after it.
    const continued = this.partial + data
    if (this.partial && data.trimStart().startsWith('{') && tryParse(continued) === undefined) {
      this.partial = data
    } else {
      this.partial = continued
    }
    const joined = this.partial.length <= MAX_MESSAGE_SIZE ? tryParse(this.partial) : undefined
    if (joined !== undefined || this.partial.length > MAX_MESSAGE_SIZE) {
      this.partial = ''
    }
    if (joined !== undefined) {
      this.onMessage(asRecord(asRecord(joined)?.data))
    }
  }

  private onMessage(message: Record<string, unknown> | undefined) {
    const data = asRecord(message?.data)
    if (!data) {
      return
    }
    switch (message!.endpoint) {
      case 'SetPlayerData':
      case 'SetObserverData':
        this.onSlot(data, message!.endpoint === 'SetObserverData')
        break
      case 'OnMessage':
        this.onChat(asRecord(data.sender))
        break
      // A countdown can be called off, like when someone leaves during it, which sets it to
      // nothing. Only one that runs out starts the game.
      case 'SetCountdown':
        this.countdown = typeof data.count === 'number' ? data.count : undefined
        if (data.count === 0 && !this.started) {
          this.started = true
          this.emit('starting')
        }
        break
    }
  }

  private onSlot(data: Record<string, unknown>, observer: boolean) {
    if (typeof data.id !== 'number') {
      return
    }
    if (data.state === 'human' && typeof data.name === 'string' && data.name) {
      const race = typeof data.race === 'string' ? RACES[data.race] : undefined
      this.slots.set(data.id, { name: data.name, race: observer ? undefined : race, observer })
    } else {
      this.slots.delete(data.id)
    }
    this.emitPlayers()
  }

  private onChat(sender: Record<string, unknown> | undefined) {
    if (!sender || typeof sender.name !== 'string' || !sender.name) {
      return
    }
    const key = sender.name.toLowerCase()
    this.identities.delete(key)
    this.identities.set(key, {
      battleTag:
        typeof sender.battleTag === 'string' && sender.battleTag ? sender.battleTag : undefined,
      gatewayId:
        typeof sender.gatewayId === 'number' && sender.gatewayId > 0 ? sender.gatewayId : undefined,
    })
    if (this.identities.size > MAX_IDENTITIES) {
      this.identities.delete(this.identities.keys().next().value!)
    }
    this.emitPlayers()
  }

  /** Slots come one message each, so a burst of them is reported once. */
  private emitPlayers() {
    if (!this.emitTimer) {
      this.emitTimer = setTimeout(() => {
        this.emitTimer = undefined
        this.emitPlayersNow()
      }, EMIT_DELAY_MS)
      this.emitTimer.unref?.()
    }
  }

  private emitPlayersNow() {
    const players = Array.from(this.slots)
      .sort(([a], [b]) => a - b)
      .map(([id, slot]): LiveGamePlayer => {
        const identity = this.identities.get(slot.name.toLowerCase())
        return {
          name: slot.name,
          slot: id,
          race: slot.race,
          gatewayId: identity?.gatewayId,
          battleTag: identity?.battleTag,
          observer: slot.observer || undefined,
        }
      })
    // The lobby resends every slot every few seconds: only a change is news.
    const key = JSON.stringify(players)
    if (key !== this.lastPlayers) {
      this.lastPlayers = key
      this.emit('players', players)
    }
  }
}
