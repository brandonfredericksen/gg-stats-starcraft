import { useTranslation } from 'react-i18next'
import { urlPath } from '../../common/urls'
import { useAppDispatch } from '../redux-hooks'
import { openLastGame } from '../system-bar/last-game'
import { Crumb, useCurrentSection, useParentPathname } from './page-nav'

const PLAYER_PATH = /^\/players\/([^/]+)$/

/** The name in a player's page's pathname, if it's one. */
export function getPlayerFromPathname(pathname: string | undefined): string | undefined {
  const match = pathname ? PLAYER_PATH.exec(pathname) : undefined
  if (!match) {
    return undefined
  }
  try {
    return decodeURIComponent(match[1])
  } catch {
    return undefined
  }
}

/**
 * The crumbs a page under the lit tab starts with: the tab's own, so they always agree. With
 * `fromPlayer`, for a game, then the player whose page it was opened from, if it was.
 */
export function useSectionCrumbs({ fromPlayer = false }: { fromPlayer?: boolean } = {}): Crumb[] {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const section = useCurrentSection()
  const parent = getPlayerFromPathname(useParentPathname())

  const crumbs: Crumb[] = []
  switch (section) {
    case 'library':
      crumbs.push({ label: t('navigation.library', 'Library'), href: '/replays' })
      break
    case 'lastGame':
      crumbs.push({ label: t('navigation.lastGame', 'Last game'), onClick: () => dispatch(openLastGame()) })
      break
    case 'liveGame':
      crumbs.push({ label: t('navigation.liveGame', 'Live game'), href: '/live-game' })
      break
    case 'myStats':
      crumbs.push({ label: t('myStats.label', 'My stats'), href: '/my-stats' })
      break
    case 'players':
      crumbs.push({ label: t('navigation.players', 'Players'), href: '/players' })
      break
    case 'coach':
      crumbs.push({ label: t('myStats.coach.title', 'Coach'), href: '/coach' })
      break
    case 'builds':
      crumbs.push({ label: t('builds.title', 'Builds'), href: '/builds' })
      break
    case 'settings':
    case 'other':
      break
    default:
      section satisfies never
  }
  if (fromPlayer && parent && section === 'players') {
    crumbs.push({ label: parent, href: urlPath`/players/${parent}` })
  }
  return crumbs
}
