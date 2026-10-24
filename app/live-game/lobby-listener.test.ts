import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { LiveGamePlayer } from '../../common/live-game'
import {
  CONNECT_MS,
  EMIT_DELAY_MS,
  LobbyListener,
  LobbySocket,
  MAX_MESSAGE_SIZE,
  SILENT_MS,
} from './lobby-listener'

class FakeSocket implements LobbySocket {
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  close = vi.fn(() => {
    this.closed = true
  })

  /** Sends what the game sends the lobby's page. */
  push(endpoint: string, data: object) {
    this.onmessage?.({
      data: JSON.stringify({
        originRoutePath: 'app',
        requestId: 'app-1',
        data: { endpoint, data },
      }),
    })
  }
}

function slot(id: number, name: string, race = 'SelectRace', state = 'human') {
  return { id, name, race, color: 'Random', state, latency: 0, latencyBars: 0 }
}

function setup() {
  const socket = new FakeSocket()
  const connect = vi.fn(() => socket)
  const listener = new LobbyListener(50072, 12382, connect)
  const players: LiveGamePlayer[][] = []
  const events: string[] = []
  listener.on('players', p => players.push(p))
  listener.on('starting', () => events.push('starting'))
  listener.on('end', () => events.push('end'))
  listener.start()
  socket.onopen?.()
  return { socket, connect, listener, players, events }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('LobbyListener', () => {
  test("connects to the lobby page's socket", () => {
    const { connect } = setup()
    expect(connect).toHaveBeenCalledWith('ws://127.0.0.1:50072/panel/GameLobbyPanel/12382')
  })

  test('reports the players in a burst of slots once', () => {
    const { socket, players } = setup()
    socket.push('SetPlayerData', slot(0, 'Me', 'Terran'))
    socket.push('SetPlayerData', slot(1, 'Them'))
    socket.push('SetPlayerData', slot(2, '', 'SelectRace', 'open'))
    socket.push('SetObserverData', { id: 128, name: 'Watcher', state: 'human' })
    socket.push('SetObserverData', { id: 129, name: '', state: 'closed' })
    vi.advanceTimersByTime(EMIT_DELAY_MS)
    expect(players).toEqual([
      [
        { name: 'Me', race: 't', gatewayId: undefined, battleTag: undefined, observer: undefined },
        {
          name: 'Them',
          race: undefined,
          gatewayId: undefined,
          battleTag: undefined,
          observer: undefined,
        },
        {
          name: 'Watcher',
          race: undefined,
          gatewayId: undefined,
          battleTag: undefined,
          observer: true,
        },
      ],
    ])
  })

  test('stays quiet when the lobby resends the same slots', () => {
    const { socket, players } = setup()
    for (let i = 0; i < 3; i++) {
      socket.push('SetPlayerData', slot(0, 'Me', 'Terran'))
      vi.advanceTimersByTime(5000)
    }
    expect(players).toHaveLength(1)
  })

  test('reports race picks, leaves and computers dropping out', () => {
    const { socket, players } = setup()
    socket.push('SetPlayerData', slot(0, 'Me'))
    socket.push('SetPlayerData', slot(1, 'Them'))
    vi.advanceTimersByTime(EMIT_DELAY_MS)
    socket.push('SetPlayerData', slot(1, 'Them', 'Zerg'))
    vi.advanceTimersByTime(EMIT_DELAY_MS)
    socket.push('SetPlayerData', slot(1, '', 'SelectRace', 'open'))
    socket.push('SetPlayerData', slot(2, 'Computer', 'Protoss', 'computer'))
    vi.advanceTimersByTime(EMIT_DELAY_MS)
    expect(players.map(p => p.map(q => `${q.name}:${q.race ?? '-'}`))).toEqual([
      ['Me:-', 'Them:-'],
      ['Me:-', 'Them:z'],
      ['Me:-'],
    ])
  })

  test('fills in the battleTag and gateway of a player who chats', () => {
    const { socket, players } = setup()
    socket.push('SetPlayerData', slot(1, 'VLR'))
    socket.push('OnMessage', {
      sender: { name: 'VLR', battleTag: 'Someone#1234', gatewayId: 10, isLocalUser: false },
      content: 'hi',
    })
    socket.push('OnMessage', { content: 'VLR has joined the game.', channel: 'gameLobby' })
    vi.advanceTimersByTime(EMIT_DELAY_MS)
    expect(players.at(-1)).toEqual([
      {
        name: 'VLR',
        race: undefined,
        gatewayId: 10,
        battleTag: 'Someone#1234',
        observer: undefined,
      },
    ])
  })

  test('joins a message split over several pieces', () => {
    const { socket, players } = setup()
    const whole = JSON.stringify({ data: { endpoint: 'SetPlayerData', data: slot(0, 'Me') } })
    socket.onmessage?.({ data: whole.slice(0, 20) })
    socket.onmessage?.({ data: whole.slice(20) })
    vi.advanceTimersByTime(EMIT_DELAY_MS)
    expect(players).toHaveLength(1)
  })

  test("isn't held up by a piece that never parses", () => {
    const { socket, players } = setup()
    socket.onmessage?.({ data: '{"originRoutePath":"app","data":{"endp' })
    socket.push('SetPlayerData', slot(0, 'Me'))
    vi.advanceTimersByTime(EMIT_DELAY_MS)
    socket.onmessage?.({ data: '{' + 'x'.repeat(MAX_MESSAGE_SIZE) })
    socket.onmessage?.({ data: 'more' })
    socket.push('SetPlayerData', slot(1, 'Them'))
    vi.advanceTimersByTime(EMIT_DELAY_MS)
    expect(players.map(p => p.map(q => q.name))).toEqual([['Me'], ['Me', 'Them']])
  })

  test('says when the countdown runs out, once', () => {
    const { socket, events } = setup()
    socket.push('SetCountdown', { count: 5 })
    socket.push('SetCountdown', { count: 1 })
    expect(events).toEqual([])
    socket.push('SetCountdown', { count: 0 })
    socket.push('SetCountdown', { count: 0 })
    expect(events).toEqual(['starting'])
  })

  test('says the game is starting when the page closes as the countdown runs out', () => {
    const { socket, events } = setup()
    socket.push('SetCountdown', { count: 1 })
    socket.onclose?.()
    expect(events).toEqual(['starting', 'end'])
  })

  test('takes the page closing earlier in a countdown as the user leaving', () => {
    const { socket, events } = setup()
    socket.push('SetCountdown', { count: 4 })
    socket.onclose?.()
    expect(events).toEqual(['end'])
  })

  test("doesn't say the game is starting after a countdown was called off", () => {
    const { socket, events } = setup()
    socket.push('SetCountdown', { count: 3 })
    socket.push('SetCountdown', { count: null })
    socket.onclose?.()
    expect(events).toEqual(['end'])
  })

  test('keeps a message split where a piece starts like a new one', () => {
    const { socket, players } = setup()
    const whole = JSON.stringify({ data: { endpoint: 'SetPlayerData', data: slot(0, 'Me') } })
    const split = whole.indexOf('{', 10)
    socket.onmessage?.({ data: whole.slice(0, split) })
    socket.onmessage?.({ data: whole.slice(split) })
    vi.advanceTimersByTime(EMIT_DELAY_MS)
    expect(players).toHaveLength(1)
  })

  test('ends when the socket closes, and lets go of it', () => {
    const { socket, listener, events } = setup()
    socket.onclose?.()
    expect(events).toEqual(['end'])
    expect(socket.onmessage).toBeNull()
    expect(listener.listenerCount('end')).toBe(1)
  })

  test('ends when the lobby goes quiet', () => {
    const { socket, events } = setup()
    socket.push('SetPlayerData', slot(0, 'Me'))
    vi.advanceTimersByTime(SILENT_MS - 1)
    expect(events).toEqual([])
    vi.advanceTimersByTime(1)
    expect(events).toEqual(['end'])
    expect(socket.closed).toBe(true)
  })

  test("ends when the socket doesn't open", () => {
    const socket = new FakeSocket()
    const listener = new LobbyListener(1, 2, () => socket)
    const ended = vi.fn()
    listener.on('end', ended)
    listener.start()
    vi.advanceTimersByTime(CONNECT_MS)
    expect(ended).toHaveBeenCalledOnce()
  })

  test('emits nothing after being stopped', () => {
    const { socket, listener, players, events } = setup()
    socket.push('SetPlayerData', slot(0, 'Me'))
    listener.stop()
    vi.advanceTimersByTime(SILENT_MS)
    expect(players).toEqual([])
    expect(events).toEqual([])
    expect(socket.closed).toBe(true)
  })

  test('never sends anything', () => {
    const { socket } = setup()
    expect('send' in socket).toBe(false)
  })
})
