import { TFunction } from 'i18next'
import * as React from 'react'
import { ReplayLibraryEntry } from '../../common/replays-library'
import { MaterialIcon } from '../icons/material/material-icon'
import { Divider } from '../material/menu/divider'
import { DestructiveMenuItem, MenuItem } from '../material/menu/item'

/**
 * Builds the row context menu's items after Watch and Bookmark: analyze, show in Explorer and move
 * to the Recycle Bin. An unreadable replay can only be shown or removed.
 *
 * Returns a flat array of keyed `MenuItem` elements (rather than a component rendering a
 * fragment) so that spreading it directly into a `<MenuList>`'s children keeps every item a
 * direct child: `MenuList` only clones `dense`/focus state onto, and lets arrow-key navigation
 * reach, its direct `MenuItem` children.
 */
export function getReplayActionMenuItems({
  entry,
  closeMenu,
  onReveal,
  onAnalyze,
  onMoveToRecycleBin,
  t,
}: {
  entry: ReplayLibraryEntry
  closeMenu: () => void
  onReveal: (entry: ReplayLibraryEntry) => void
  onAnalyze: (entry: ReplayLibraryEntry) => void
  onMoveToRecycleBin: (entry: ReplayLibraryEntry) => void
  t: TFunction
}): React.ReactNode[] {
  const items: React.ReactNode[] = []

  if (!entry.parseError) {
    items.push(
      <MenuItem
        key='analyze'
        icon={<MaterialIcon icon='analytics' />}
        text={t('replays.library.analyzeReplay', 'Analyze replay')}
        onClick={() => {
          closeMenu()
          onAnalyze(entry)
        }}
      />,
    )
  }

  items.push(
    <MenuItem
      key='show-in-explorer'
      icon={<MaterialIcon icon='folder_open' />}
      text={t('replays.library.showInExplorer', 'Show in Explorer')}
      onClick={() => {
        closeMenu()
        onReveal(entry)
      }}
    />,
    <Divider key='move-to-recycle-bin-divider' $dense={true} />,
    <DestructiveMenuItem
      key='move-to-recycle-bin'
      icon={<MaterialIcon icon='delete' />}
      text={t('replays.library.moveToRecycleBin', 'Move to Recycle Bin')}
      onClick={() => {
        closeMenu()
        onMoveToRecycleBin(entry)
      }}
    />,
  )

  return items
}

/**
 * Which bookmark action a multi-selection offers: `true` to bookmark the selected rows that aren't
 * yet, `false` to remove the bookmark from all of them (only when every one is bookmarked), or
 * `undefined` when nothing selected can be bookmarked (unreadable replays can't be).
 */
export function getBulkBookmarkAction(
  entries: ReadonlyArray<ReplayLibraryEntry>,
): boolean | undefined {
  const bookmarkable = entries.filter(e => !e.parseError)
  if (bookmarkable.length === 0) {
    return undefined
  }
  return !bookmarkable.every(e => e.bookmarkedAt !== undefined)
}

function getBookmarkText(bookmark: boolean, t: TFunction) {
  return bookmark
    ? t('replays.library.bookmark', 'Bookmark')
    : t('replays.library.removeBookmark', 'Remove bookmark')
}

/**
 * Builds the row context menu's items for a multi-selection: only the actions that make sense on
 * several replays at once (no Watch or Show in Explorer).
 *
 * Returns a flat array of keyed `MenuItem` elements so each one stays a direct child of
 * `MenuList` (see `getReplayActionMenuItems`).
 */
export function getBulkReplayActionMenuItems({
  entries,
  closeMenu,
  onSetBookmarked,
  onMoveToRecycleBin,
  t,
}: {
  entries: ReadonlyArray<ReplayLibraryEntry>
  closeMenu: () => void
  onSetBookmarked: (bookmarked: boolean) => void
  onMoveToRecycleBin: () => void
  t: TFunction
}): React.ReactNode[] {
  const items: React.ReactNode[] = []

  const bookmark = getBulkBookmarkAction(entries)
  if (bookmark !== undefined) {
    items.push(
      <MenuItem
        key='bookmark'
        icon={<MaterialIcon icon='bookmark' filled={!bookmark} />}
        text={getBookmarkText(bookmark, t)}
        onClick={() => {
          closeMenu()
          onSetBookmarked(bookmark)
        }}
      />,
      <Divider key='move-to-recycle-bin-divider' $dense={true} />,
    )
  }

  items.push(
    <DestructiveMenuItem
      key='move-to-recycle-bin'
      icon={<MaterialIcon icon='delete' />}
      text={t('replays.library.moveToRecycleBin', 'Move to Recycle Bin')}
      onClick={() => {
        closeMenu()
        onMoveToRecycleBin()
      }}
    />,
  )

  return items
}
