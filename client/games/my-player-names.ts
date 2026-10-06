import { TypedIpcRenderer } from '../../common/ipc'
import { ThunkAction } from '../dispatch-registry'
import { useAppSelector } from '../redux-hooks'
import { mergeLocalSettings } from '../settings/action-creators'

const ipcRenderer = new TypedIpcRenderer()

/**
 * The user's own in-game names, or undefined until they've confirmed them. An empty list means
 * they chose not to set any.
 */
export function useMyPlayerNames(): ReadonlyArray<string> | undefined {
  return useAppSelector(s => s.settings.local.myPlayerNames)
}

/** Saves the user's own in-game names. */
export function setMyPlayerNames(names: ReadonlyArray<string>): ThunkAction {
  const unique = Array.from(new Set(names.map(n => n.trim()).filter(Boolean)))
  return mergeLocalSettings({ myPlayerNames: unique }, { onSuccess: () => {}, onError: () => {} })
}

/** Guesses which other names are the user's, from the games they played. */
export async function getSuggestedPlayerNames(
  knownNames: ReadonlyArray<string>,
): Promise<string[]> {
  const suggested = await ipcRenderer.invoke('replayLibrarySuggestOwnNames', [...knownNames])
  return suggested?.map(({ name }) => name) ?? []
}
