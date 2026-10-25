import { useEffect, useSyncExternalStore } from 'react'
import { getErrorStack } from '../../common/errors'
import { TypedIpcRenderer } from '../../common/ipc'
import { PlayerScout } from '../../common/my-stats/player-scout'
import logger from '../logging/logger'

const ipcRenderer = new TypedIpcRenderer()

/** People are looked up a little after a game's players change, so a burst of them is one request. */
const LOAD_DELAY_MS = 300
/** How many people's stats are kept, the latest looked up. */
const MAX_CACHED = 64
/**
 * How long after newly analyzed games what was looked up is let go. A game being analyzed sends
 * a few changes in a row; they're answered with one new lookup.
 */
const CLEAR_DELAY_MS = 2000

/** Between the accounts in a person's key, and between people in a list of keys. */
const ACCOUNT_SEPARATOR = '\n'
const PERSON_SEPARATOR = '\t'

/** Everything known about who's been looked up. Replaced, never changed, so React sees each change. */
interface ScoutStore {
  /** By the key of the accounts asked about. */
  scouts: ReadonlyMap<string, PlayerScout>
  /** The latest stats that included each account, to show while a person's other accounts load. */
  byAccount: ReadonlyMap<string, PlayerScout>
  failed: ReadonlySet<string>
  /** Counts the times what was known went out of date. */
  clears: number
}

let store: ScoutStore = { scouts: new Map(), byAccount: new Map(), failed: new Set(), clears: 0 }
/** People being looked up now, so they aren't asked about again meanwhile. */
const loading = new Set<string>()
const listeners = new Set<() => void>()
let clearTimer: ReturnType<typeof setTimeout> | undefined

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function setStore(next: ScoutStore) {
  store = next
  for (const listener of listeners) {
    listener()
  }
}

/** Keeps at most {@link MAX_CACHED} of the newest entries. */
function capped<T>(map: Map<string, T>) {
  while (map.size > MAX_CACHED) {
    map.delete(map.keys().next().value!)
  }
  return map
}

/** Forgets what was looked up, like when newly analyzed games could change it. */
function clearScouts() {
  clearTimeout(clearTimer)
  clearTimer = undefined
  loading.clear()
  setStore({
    scouts: new Map(),
    byAccount: store.byAccount,
    failed: new Set(),
    clears: store.clears + 1,
  })
}

/** Forgets what was looked up soon, once a burst of changes is over. */
export function clearScoutsSoon() {
  clearTimeout(clearTimer)
  clearTimer = setTimeout(clearScouts, CLEAR_DELAY_MS)
}

/** The same person, whatever order or case their accounts are in. */
function getAccountsKey(accounts: ReadonlyArray<string>) {
  return Array.from(new Set(accounts.map(a => a.toLowerCase())))
    .sort()
    .join(ACCOUNT_SEPARATOR)
}

function settle(keys: ReadonlyArray<string>, clears: number, scouts?: ReadonlyArray<PlayerScout>) {
  // What was asked before a clear is out of date: it's asked again.
  if (clears !== store.clears) {
    return
  }
  for (const key of keys) {
    loading.delete(key)
  }
  if (!scouts) {
    setStore({ ...store, failed: new Set([...store.failed, ...keys]) })
    return
  }
  const byKey = new Map(store.scouts)
  const byAccount = new Map(store.byAccount)
  keys.forEach((key, i) => {
    byKey.delete(key)
    byKey.set(key, scouts[i])
    for (const account of key.split(ACCOUNT_SEPARATOR)) {
      byAccount.delete(account)
      byAccount.set(account, scouts[i])
    }
  })
  setStore({ ...store, scouts: capped(byKey), byAccount: capped(byAccount) })
}

export type ScoutState = PlayerScout | 'loading' | 'error'

/**
 * What the analyzed games say about each person, by {@link getAccountsKey}. Only the people not
 * already looked up, or being looked up, are asked about. While someone is looked up again, like
 * once more of their accounts are known, what was known about them before still shows.
 */
export function useScouts(accountLists: ReadonlyArray<ReadonlyArray<string>>) {
  const known = useSyncExternalStore(subscribe, () => store)
  const missingKey = accountLists
    .map(getAccountsKey)
    .filter(k => k && !known.scouts.has(k) && !known.failed.has(k) && !loading.has(k))
    .join(PERSON_SEPARATOR)

  useEffect(() => {
    if (!missingKey) {
      return undefined
    }
    const timer = setTimeout(() => {
      const missing = missingKey.split(PERSON_SEPARATOR)
      const clears = store.clears
      for (const key of missing) {
        loading.add(key)
      }
      ipcRenderer
        .invoke(
          'liveGameScout',
          missing.map(k => k.split(ACCOUNT_SEPARATOR)),
        )
        ?.then(scouts => settle(missing, clears, scouts))
        .catch(err => {
          logger.error(`Error looking up the players in a game: ${getErrorStack(err)}`)
          settle(missing, clears)
        })
    }, LOAD_DELAY_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [missingKey, known.clears])

  return (accounts: ReadonlyArray<string>): ScoutState => {
    const key = getAccountsKey(accounts)
    const scout = known.scouts.get(key)
    if (scout) {
      return scout
    }
    if (known.failed.has(key)) {
      return 'error'
    }
    return known.byAccount.get(accounts[0]?.toLowerCase() ?? '') ?? 'loading'
  }
}
