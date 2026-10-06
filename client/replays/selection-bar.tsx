import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReplayPlaylist } from '../../common/replays-library'
import { MaterialIcon } from '../icons/material/material-icon'
import { buttonReset } from '../material/button-reset'
import { MenuList } from '../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { useAppDispatch } from '../redux-hooks'
import { labelLarge } from '../styles/typography'
import { getAddToPlaylistMenuItems } from './replay-menu-items'

/** Inverse colors, so the bar stands apart from the panels it floats over. */
const Root = styled.div`
  position: sticky;
  top: 8px;
  z-index: 2;
  padding: 8px 8px 8px 16px;

  display: flex;
  align-items: center;
  gap: 6px;

  border-radius: 12px;
  background-color: var(--theme-inverse-surface);
  color: var(--theme-inverse-on-surface);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.3);
`

const Count = styled.span`
  ${labelLarge};
  margin-right: 10px;
  font-weight: 700;
`

const Spacer = styled.span`
  flex: 1 1 0;
`

const BarButton = styled.button<{ $danger?: boolean; $filled?: boolean }>`
  ${buttonReset};
  ${labelLarge};
  height: 32px;
  padding: 0 12px;

  display: inline-flex;
  align-items: center;
  gap: 6px;

  border-radius: 8px;
  background-color: ${props =>
    props.$filled ? 'rgb(from var(--theme-inverse-on-surface) r g b / 0.08)' : 'transparent'};
  color: ${props =>
    props.$danger ? 'var(--theme-inverse-negative)' : 'var(--theme-inverse-on-surface)'};
  font-weight: 600;
  cursor: pointer;

  &:hover {
    background-color: rgb(from var(--theme-inverse-on-surface) r g b / 0.1);
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

/** What can be done with several selected games at once. */
export function SelectionBar({
  count,
  allBookmarked,
  playlists,
  onBookmark,
  onAddToPlaylist,
  onAnalyze,
  onMoveToRecycleBin,
  onClear,
}: {
  count: number
  allBookmarked: boolean
  playlists: ReadonlyArray<ReplayPlaylist>
  onBookmark: (bookmarked: boolean) => void
  onAddToPlaylist: (playlistId: number, playlistName: string) => void
  onAnalyze: () => void
  onMoveToRecycleBin: () => void
  onClear: () => void
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [anchor, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('left', 'bottom')
  const [menuOpen, openMenu, closeMenu] = usePopoverController({ refreshAnchorPos })

  return (
    <Root role='toolbar' aria-label={t('replays.selection.label', 'Selected games')}>
      <Count>
        {t('replays.selection.count', {
          defaultValue_one: '{{count}} game selected',
          defaultValue_other: '{{count}} games selected',
          count,
        })}
      </Count>
      <BarButton type='button' onClick={onAnalyze}>
        <MaterialIcon icon='bolt' size={16} />
        {t('replays.selection.analyze', 'Analyze')}
      </BarButton>
      <BarButton type='button' onClick={() => onBookmark(!allBookmarked)}>
        <MaterialIcon icon='bookmark' size={16} filled={allBookmarked} />
        {allBookmarked
          ? t('replays.library.removeBookmark', 'Remove bookmark')
          : t('replays.library.bookmark', 'Bookmark')}
      </BarButton>
      <BarButton ref={anchor} type='button' onClick={openMenu}>
        <MaterialIcon icon='playlist_add' size={16} />
        {t('replays.selection.addToPlaylist', 'Add to playlist')}
      </BarButton>
      <BarButton type='button' $danger={true} onClick={onMoveToRecycleBin}>
        <MaterialIcon icon='delete' size={16} />
        {t('replays.library.moveToRecycleBin', 'Move to Recycle Bin')}
      </BarButton>
      <Spacer />
      <BarButton type='button' $filled={true} onClick={onClear}>
        {t('replays.selection.clear', 'Clear')}
      </BarButton>
      <Popover
        open={menuOpen}
        onDismiss={closeMenu}
        anchorX={anchorX ?? 0}
        anchorY={anchorY ?? 0}
        originX='left'
        originY='top'>
        <MenuList dense={true}>
          {getAddToPlaylistMenuItems({ playlists, closeMenu, onAddToPlaylist, t, dispatch })}
        </MenuList>
      </Popover>
    </Root>
  )
}
