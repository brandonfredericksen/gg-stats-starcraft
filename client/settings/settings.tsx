import { TFunction } from 'i18next'
import { useAtomValue } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearch } from 'wouter'
import { MaterialIcon } from '../icons/material/material-icon'
import { useKeyListener } from '../keyboard/key-listener'
import { useAppDispatch } from '../redux-hooks'
import { starcraftHealthy } from '../starcraft/health-state'
import { closeSettings } from './action-creators'
import { AppAppearanceSettings } from './app/appearance-settings'
import { AppPlayerNamesSettings } from './app/player-names-settings'
import { AppReplaySettings } from './app/replay-settings'
import { AppSystemSettings } from './app/system-settings'
import { GameDefaultsSettings } from './game/game-defaults-settings'
import { GameplaySettings } from './game/gameplay-settings'
import { GameInputSettings } from './game/input-settings'
import { GameSoundSettings } from './game/sound-settings'
import { StarcraftSettings } from './game/starcraft-settings'
import { GameVideoSettings } from './game/video-settings'
import {
  CollapseButton,
  CollapseChevron,
  CollapseText,
  Main,
  NavItem,
  NavList,
  NavTitle,
  NavVersion,
  Root,
  Section,
  SectionDescription,
  SectionNote,
  SectionTitle,
  SettingsCard,
  SideNav,
} from './settings-content'
import {
  ALL_SETTINGS_PAGES,
  AppSettingsPage,
  GameSettingsPage,
  SettingsPage,
} from './settings-page'

const ESCAPE = 'Escape'
/** Room left above a section's title when jumping to it. */
const SCROLL_TOP_MARGIN = 24

type SectionId = 'general' | 'replays' | 'starcraft' | 'replay-viewing'

interface SettingsSection {
  id: SectionId
  icon: string
  pages: ReadonlyArray<SettingsPage>
}

const SECTIONS: ReadonlyArray<SettingsSection> = [
  {
    id: 'general',
    icon: 'tune',
    pages: [AppSettingsPage.PlayerNames, AppSettingsPage.Appearance, AppSettingsPage.System],
  },
  { id: 'replays', icon: 'video_library', pages: [AppSettingsPage.Replays] },
  { id: 'starcraft', icon: 'folder_open', pages: [GameSettingsPage.StarCraft] },
  {
    id: 'replay-viewing',
    icon: 'smart_display',
    pages: [
      GameSettingsPage.Input,
      GameSettingsPage.Sound,
      GameSettingsPage.Video,
      GameSettingsPage.Gameplay,
      GameSettingsPage.Defaults,
    ],
  },
]

function getSectionTitle(id: SectionId, t: TFunction) {
  switch (id) {
    case 'general':
      return t('settings.sections.general', 'General')
    case 'replays':
      return t('settings.sections.replays', 'Replays')
    case 'starcraft':
      return t('settings.sections.starcraft', 'StarCraft')
    case 'replay-viewing':
      return t('settings.sections.replayViewing', 'When watching replays')
    default:
      return id satisfies never
  }
}

/** Pages that title their own settings, so their cards don't need another title on top. */
const PAGES_WITH_OWN_HEADINGS: ReadonlySet<SettingsPage> = new Set([
  AppSettingsPage.PlayerNames,
  AppSettingsPage.Appearance,
  AppSettingsPage.System,
  AppSettingsPage.Replays,
  GameSettingsPage.StarCraft,
])

/** The element that scrolls the settings page, which is the app's content area. */
function getScrollParent(elem: HTMLElement): HTMLElement {
  let parent = elem.parentElement
  while (parent) {
    const { overflowY } = getComputedStyle(parent)
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return parent
    }
    parent = parent.parentElement
  }
  return document.scrollingElement as HTMLElement
}

/** How far down the scroller a section's top edge sits, accounting for the scroll so far. */
function offsetWithin(elem: HTMLElement, scroller: HTMLElement) {
  return (
    elem.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
  )
}

function sectionForPage(page: SettingsPage | undefined): SettingsSection | undefined {
  return page ? SECTIONS.find(s => s.pages.includes(page)) : undefined
}

/** Every setting on one page, in sections, with a short list on the side to jump between them. */
export function SettingsScreen() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const isStarcraftHealthy = useAtomValue(starcraftHealthy)
  const pageParam = new URLSearchParams(useSearch()).get('page')
  const targetPage = ALL_SETTINGS_PAGES.find(p => p === pageParam)
  const targetSection = sectionForPage(targetPage)

  const [replayViewingOpen, setReplayViewingOpen] = useState(targetSection?.id === 'replay-viewing')
  const [activeSection, setActiveSection] = useState<SectionId>(targetSection?.id ?? 'general')
  const sectionElems = useRef(new Map<SectionId, HTMLElement>())

  useKeyListener({
    onKeyDown(event) {
      if (event.code === ESCAPE) {
        dispatch(closeSettings())
        return true
      }
      return false
    },
  })

  const rootRef = useRef<HTMLDivElement>(null)
  // A section to scroll to once it has rendered, like one that was collapsed until it was asked for
  const [pendingJump, setPendingJump] = useState<{ id: SectionId; smooth: boolean } | undefined>(
    targetSection ? { id: targetSection.id, smooth: false } : undefined,
  )

  useEffect(() => {
    const elem = pendingJump && sectionElems.current.get(pendingJump.id)
    if (!elem || !rootRef.current) {
      return
    }
    const scroller = getScrollParent(rootRef.current)
    scroller.scrollTo({
      top: offsetWithin(elem, scroller) - SCROLL_TOP_MARGIN,
      behavior: pendingJump.smooth ? 'smooth' : 'auto',
    })
    setPendingJump(undefined)
  }, [pendingJump, replayViewingOpen])

  useEffect(() => {
    if (!rootRef.current) {
      return undefined
    }
    const scroller = getScrollParent(rootRef.current)
    // The current section is the last one whose top has passed a third of the way down the view,
    // or the last section once the page can't scroll any further.
    const onScroll = () => {
      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4
      if (atBottom) {
        setActiveSection(SECTIONS[SECTIONS.length - 1].id)
        return
      }
      const line = scroller.scrollTop + scroller.clientHeight / 3
      let current: SectionId = SECTIONS[0].id
      for (const section of SECTIONS) {
        const elem = sectionElems.current.get(section.id)
        if (elem && offsetWithin(elem, scroller) <= line) {
          current = section.id
        }
      }
      setActiveSection(current)
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [])

  const jumpTo = (id: SectionId) => {
    if (id === 'replay-viewing') {
      setReplayViewingOpen(true)
    }
    setActiveSection(id)
    setPendingJump({ id, smooth: true })
  }

  return (
    <Root ref={rootRef}>
      <SideNav>
        <NavTitle>{t('settings.title', 'Settings')}</NavTitle>
        <NavList>
          {SECTIONS.map(section => (
            <NavItem
              key={section.id}
              type='button'
              $active={activeSection === section.id}
              $hasError={section.id === 'starcraft' && !isStarcraftHealthy}
              aria-current={activeSection === section.id ? 'location' : undefined}
              data-testid={`settings-nav-${section.id}`}
              onClick={() => jumpTo(section.id)}>
              <MaterialIcon
                icon={section.id === 'starcraft' && !isStarcraftHealthy ? 'error' : section.icon}
                size={20}
              />
              {getSectionTitle(section.id, t)}
            </NavItem>
          ))}
        </NavList>
        <NavVersion>GG Stats v{import.meta.env.GGSTATS_VERSION}</NavVersion>
      </SideNav>

      <Main>
        {SECTIONS.map(section => {
          const ref = (elem: HTMLElement | null) => {
            if (elem) {
              sectionElems.current.set(section.id, elem)
            } else {
              sectionElems.current.delete(section.id)
            }
          }

          if (section.id === 'replay-viewing') {
            return (
              <Section key={section.id} ref={ref} data-section={section.id}>
                <CollapseButton
                  type='button'
                  aria-expanded={replayViewingOpen}
                  onClick={() => setReplayViewingOpen(open => !open)}>
                  <CollapseText>
                    <SectionTitle as='span'>{getSectionTitle(section.id, t)}</SectionTitle>
                    <SectionDescription>
                      {t(
                        'settings.sections.replayViewingDescription',
                        'Controls, sound, video and gameplay for when you watch a replay in ' +
                          'StarCraft. Analysis ignores them.',
                      )}
                    </SectionDescription>
                  </CollapseText>
                  <CollapseChevron icon='expand_more' $open={replayViewingOpen} />
                </CollapseButton>
                {replayViewingOpen && !isStarcraftHealthy ? (
                  <SectionNote>
                    {t(
                      'settings.sections.replayViewingNeedsStarcraft',
                      'Set your StarCraft folder above to change these.',
                    )}
                  </SectionNote>
                ) : null}
                {replayViewingOpen && isStarcraftHealthy
                  ? section.pages.map(page => (
                      <SettingsCard
                        key={page}
                        title={getSettingsPageTitle({ page, t })}
                        testName={`settings-card-${page}`}>
                        <SettingsPageDisplay page={page} />
                      </SettingsCard>
                    ))
                  : null}
              </Section>
            )
          }

          return (
            <Section key={section.id} ref={ref} data-section={section.id}>
              <SectionTitle>{getSectionTitle(section.id, t)}</SectionTitle>
              {section.pages.map(page => (
                <SettingsCard
                  key={page}
                  title={
                    PAGES_WITH_OWN_HEADINGS.has(page)
                      ? undefined
                      : getSettingsPageTitle({ page, t })
                  }
                  testName={`settings-card-${page}`}>
                  <SettingsPageDisplay page={page} />
                </SettingsCard>
              ))}
            </Section>
          )
        })}
      </Main>
    </Root>
  )
}

function SettingsPageDisplay({ page }: { page: SettingsPage }) {
  switch (page) {
    case AppSettingsPage.PlayerNames:
      return <AppPlayerNamesSettings />
    case AppSettingsPage.Appearance:
      return <AppAppearanceSettings />
    case AppSettingsPage.Replays:
      return <AppReplaySettings />
    case AppSettingsPage.System:
      return <AppSystemSettings />
    case GameSettingsPage.StarCraft:
      return <StarcraftSettings />
    case GameSettingsPage.Input:
      return <GameInputSettings />
    case GameSettingsPage.Sound:
      return <GameSoundSettings />
    case GameSettingsPage.Video:
      return <GameVideoSettings />
    case GameSettingsPage.Gameplay:
      return <GameplaySettings />
    case GameSettingsPage.Defaults:
      return <GameDefaultsSettings />
    default:
      return page satisfies never
  }
}

function getSettingsPageTitle({ page, t }: { page: SettingsPage; t: TFunction }) {
  switch (page) {
    case AppSettingsPage.PlayerNames:
      return t('settings.app.playerNames.title', 'Your names')
    case AppSettingsPage.Appearance:
      return t('settings.app.appearance.title', 'Appearance')
    case AppSettingsPage.Replays:
      return t('settings.app.replays.title', 'Replays')
    case AppSettingsPage.System:
      return t('settings.app.system.title', 'System')
    case GameSettingsPage.StarCraft:
      return t('settings.game.starcraft.title', 'StarCraft')
    case GameSettingsPage.Input:
      return t('settings.game.input.title', 'Input')
    case GameSettingsPage.Sound:
      return t('settings.game.sound.title', 'Sound')
    case GameSettingsPage.Video:
      return t('settings.game.video.title', 'Video')
    case GameSettingsPage.Gameplay:
      return t('settings.game.gameplay.title', 'Gameplay')
    case GameSettingsPage.Defaults:
      return t('settings.game.defaults.title', 'Defaults')
    default:
      return page satisfies never
  }
}
