import { TFunction } from 'i18next'
import * as React from 'react'
import { ReplayLibraryEntry, ReplayPlaylist } from '../../common/replays-library'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { MaterialIcon } from '../icons/material/material-icon'
import { Divider } from '../material/menu/divider'
import { DestructiveMenuItem, MenuItem } from '../material/menu/item'
import { useAppDispatch } from '../redux-hooks'

/**
 * Builds the "more actions" menu items shared between the inspector's overflow menu and the
 * library's row context menu: add/remove-from-playlist, an optional reorder pair, analyze,
 * show-in-explorer, and move-to-recycle-bin. Watch/Bookmark aren't included here since each caller
 * surfaces those differently (dedicated buttons in the inspector, leading menu items in the
 * context menu).
 *
 * Returns a flat array of keyed `MenuItem` elements (rather than a component rendering a
 * fragment) so that spreading it directly into a `<MenuList>`'s children keeps every item a
 * direct child: `MenuList` only clones `dense`/focus state onto, and lets arrow-key navigation
 * reach, its direct `MenuItem` children.
 */
export function getReplayActionMenuItems({
  entry,
  inPlaylistView,
  closeMenu,
  onOpenAddToPlaylist,
  onRemoveFromPlaylist,
  onReveal,
  onAnalyze,
  onMoveToRecycleBin,
  reorder,
  t,
}: {
  entry: ReplayLibraryEntry
  inPlaylistView: boolean
  closeMenu: () => void
  onOpenAddToPlaylist: (event: React.MouseEvent | KeyboardEvent) => void
  onRemoveFromPlaylist: () => void
  onReveal: (entry: ReplayLibraryEntry) => void
  onAnalyze: (entry: ReplayLibraryEntry) => void
  onMoveToRecycleBin: (entry: ReplayLibraryEntry) => void
  /** Present only when Move up/Move down should be offered (the inspector, in manual order). */
  reorder?: {
    canMoveUp: boolean
    canMoveDown: boolean
    onMoveUp: () => void
    onMoveDown: () => void
  }
  t: TFunction
}): React.ReactNode[] {
  const items: React.ReactNode[] = [
    <MenuItem
      key='add-to-playlist'
      icon={<MaterialIcon icon='playlist_add' />}
      text={t('replays.library.addToPlaylist', 'Add to playlist…')}
      onClick={event => {
        closeMenu()
        onOpenAddToPlaylist(event)
      }}
    />,
  ]

  if (inPlaylistView) {
    items.push(
      <MenuItem
        key='remove-from-playlist'
        icon={<MaterialIcon icon='playlist_remove' />}
        text={t('replays.library.removeFromPlaylist', 'Remove from playlist')}
        onClick={() => {
          closeMenu()
          onRemoveFromPlaylist()
        }}
      />,
    )
  }

  if (reorder) {
    items.push(
      <MenuItem
        key='move-up'
        icon={<MaterialIcon icon='arrow_upward' />}
        text={t('replays.library.moveUp', 'Move up')}
        disabled={!reorder.canMoveUp}
        onClick={() => {
          closeMenu()
          reorder.onMoveUp()
        }}
      />,
      <MenuItem
        key='move-down'
        icon={<MaterialIcon icon='arrow_downward' />}
        text={t('replays.library.moveDown', 'Move down')}
        disabled={!reorder.canMoveDown}
        onClick={() => {
          closeMenu()
          reorder.onMoveDown()
        }}
      />,
    )
  }

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
  )

  items.push(
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
 * Builds the playlist-picker menu items shared between the inspector's and the library's "Add to
 * playlist" submenu: one item per existing playlist, plus a trailing "New playlist…" item that
 * opens the create-playlist dialog.
 *
 * Returns a flat array of keyed `MenuItem` elements (rather than a component rendering a
 * fragment) so that spreading it directly into a `<MenuList>`'s children keeps every item a
 * direct child: `MenuList` only clones `dense`/focus state onto, and lets arrow-key navigation
 * reach, its direct `MenuItem` children.
 */
export function getAddToPlaylistMenuItems({
  playlists,
  closeMenu,
  onAddToPlaylist,
  t,
  dispatch,
}: {
  playlists: ReadonlyArray<ReplayPlaylist>
  closeMenu: () => void
  onAddToPlaylist: (playlistId: number, playlistName: string) => void
  t: TFunction
  dispatch: ReturnType<typeof useAppDispatch>
}): React.ReactNode[] {
  return [
    ...playlists.map(p => (
      <MenuItem
        key={p.id}
        icon={<MaterialIcon icon='queue_music' />}
        text={p.name}
        onClick={() => {
          closeMenu()
          onAddToPlaylist(p.id, p.name)
        }}
      />
    )),
    <MenuItem
      key='new-playlist'
      icon={<MaterialIcon icon='add' />}
      text={t('replays.library.newPlaylistMenu', 'New playlist…')}
      onClick={() => {
        closeMenu()
        dispatch(
          openDialog({
            type: DialogType.CreatePlaylist,
            initData: {
              onCreated: (id, name) => onAddToPlaylist(id, name),
            },
          }),
        )
      }}
    />,
  ]
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
 * several replays at once (no Watch, View game page, Show in Explorer or reordering).
 *
 * Returns a flat array of keyed `MenuItem` elements so each one stays a direct child of
 * `MenuList` (see `getReplayActionMenuItems`).
 */
export function getBulkReplayActionMenuItems({
  entries,
  inPlaylistView,
  closeMenu,
  onOpenAddToPlaylist,
  onRemoveFromPlaylist,
  onSetBookmarked,
  onMoveToRecycleBin,
  t,
}: {
  entries: ReadonlyArray<ReplayLibraryEntry>
  inPlaylistView: boolean
  closeMenu: () => void
  onOpenAddToPlaylist: (event: React.MouseEvent | KeyboardEvent) => void
  onRemoveFromPlaylist: () => void
  onSetBookmarked: (bookmarked: boolean) => void
  onMoveToRecycleBin: () => void
  t: TFunction
}): React.ReactNode[] {
  const items: React.ReactNode[] = [
    <MenuItem
      key='add-to-playlist'
      icon={<MaterialIcon icon='playlist_add' />}
      text={t('replays.library.addToPlaylist', 'Add to playlist…')}
      onClick={event => {
        closeMenu()
        onOpenAddToPlaylist(event)
      }}
    />,
  ]

  if (inPlaylistView) {
    items.push(
      <MenuItem
        key='remove-from-playlist'
        icon={<MaterialIcon icon='playlist_remove' />}
        text={t('replays.library.removeFromPlaylist', 'Remove from playlist')}
        onClick={() => {
          closeMenu()
          onRemoveFromPlaylist()
        }}
      />,
    )
  }

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
    )
  }

  items.push(
    <Divider key='move-to-recycle-bin-divider' $dense={true} />,
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
