/**
 * Whether a player is the user: one of the names they played under, which is several in games with
 * shared control, is one of the user's.
 */
export function isMyPlayer(
  player: { name: string; names?: ReadonlyArray<string> },
  myNames: ReadonlyArray<string> | undefined,
) {
  const names = player.names?.length ? player.names : [player.name]
  return names.some(name => isMyPlayerName(name, myNames))
}

/** Whether `name` is one of the user's, ignoring case the way Battle.net names do. */
export function isMyPlayerName(name: string, myNames: ReadonlyArray<string> | undefined) {
  const lower = name.toLowerCase()
  return myNames?.some(n => n.toLowerCase() === lower) ?? false
}
