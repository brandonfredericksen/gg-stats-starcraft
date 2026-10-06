/** Whether `name` is one of the user's, ignoring case the way Battle.net names do. */
export function isMyPlayerName(name: string, myNames: ReadonlyArray<string> | undefined) {
  const lower = name.toLowerCase()
  return myNames?.some(n => n.toLowerCase() === lower) ?? false
}
