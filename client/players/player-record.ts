import { withAssumedResults } from '../../common/games/assumed-results'
import { GameStatsSummary } from '../../common/games/game-stats'
import { isMyPlayerName } from '../../common/games/player-names'
import { TypedIpcRenderer } from '../../common/ipc'
import { ReplayLibraryEntry } from '../../common/replays-library'

const ipcRenderer = new TypedIpcRenderer()

/** Wins and losses in games with a known result, and how many games had none. */
export interface Tally {
  wins: number
  losses: number
  /** Games not analyzed yet, or that ended without a result. */
  unknown: number
}

/** How the user has done against one person, and alongside them, across all their accounts. */
export interface PlayerRecord {
  against: Tally
  with: Tally
  /** How many games each of their accounts was in, most first. */
  accounts: Array<{ name: string; games: number }>
  /** When the latest game with them was played. */
  lastPlayedMs?: number
}

function emptyTally(): Tally {
  return { wins: 0, losses: 0, unknown: 0 }
}

function sameName(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase()
}

/**
 * Tallies the user's record against and alongside the person playing as any of `accounts`, from
 * the games they were both in. Results come from the saved stats, so only analyzed games count
 * toward wins and losses; a game the user left counts as a loss, as it does everywhere else.
 * A player on the user's team counts as with them, anyone else, including in a free for all,
 * as against.
 */
export function tallyPlayerRecord(
  entries: ReadonlyArray<ReplayLibraryEntry>,
  summaries: Readonly<Record<string, GameStatsSummary>>,
  myNames: ReadonlyArray<string>,
  accounts: ReadonlyArray<string>,
): PlayerRecord {
  const record: PlayerRecord = { against: emptyTally(), with: emptyTally(), accounts: [] }
  const accountGames = new Map<string, number>()

  for (const entry of entries) {
    const humans = entry.players.filter(p => !p.isComputer)
    const me = humans.find(p => isMyPlayerName(p.name, myNames))
    const them = humans.find(
      p => !isMyPlayerName(p.name, myNames) && accounts.some(a => sameName(a, p.name)),
    )
    if (!me || !them) {
      continue
    }
    accountGames.set(them.name, (accountGames.get(them.name) ?? 0) + 1)
    record.lastPlayedMs = Math.max(record.lastPlayedMs ?? 0, entry.gameTime)

    const hasTeams = new Set(humans.map(p => p.team)).size > 1
    const tally = hasTeams && me.team === them.team ? record.with : record.against
    const summary = summaries[entry.path]
    const result = summary
      ? withAssumedResults(summary.players, summary.complete, myNames).find(p =>
          isMyPlayerName(p.name, myNames),
        )?.result
      : undefined
    if (result === 'win') {
      tally.wins += 1
    } else if (result === 'loss') {
      tally.losses += 1
    } else {
      tally.unknown += 1
    }
  }

  record.accounts = Array.from(accountGames, ([name, games]) => ({ name, games })).sort(
    (a, b) => b.games - a.games,
  )
  return record
}

/** Finds every game the user played with or against the person behind `accounts`, and tallies it. */
export async function loadPlayerRecord(
  accounts: ReadonlyArray<string>,
  myNames: ReadonlyArray<string>,
): Promise<PlayerRecord> {
  const result = await ipcRenderer.invoke('replayLibraryQuery', {
    whose: { names: [...myNames], match: 'mine' },
    withAccounts: [...accounts],
    includeShort: true,
  })
  const entries = result?.entries ?? []
  const summaries = entries.length
    ? ((await ipcRenderer.invoke(
        'gameStatsSummarizeReplays',
        entries.map(e => e.path),
      )) ?? {})
    : {}
  return tallyPlayerRecord(entries, summaries, myNames, accounts)
}
