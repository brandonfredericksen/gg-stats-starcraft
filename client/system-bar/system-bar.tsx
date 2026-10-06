import { useAtomValue } from 'jotai'
import keycode from 'keycode'
import * as React from 'react'
import { useLayoutEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { DEV_INDICATOR } from '../../common/flags'
import { TypedIpcRenderer } from '../../common/ipc'
import { useFitLevel } from '../dom/use-fit-level'
import { autoCaptureStatusAtom } from '../games/replay-stats-status'
import { MaterialIcon } from '../icons/material/material-icon'
import Logo from '../logos/logo-no-bg.svg?react'
import { useButtonHotkey } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { Tooltip } from '../material/tooltip'
import { zIndexSystemBar } from '../material/zindex'
import { HistoryButtons, useCurrentSection } from '../navigation/page-nav'
import { push } from '../navigation/routing'
import { useAppDispatch } from '../redux-hooks'
import { clearWaitingAnalyses, setAnalysisPaused } from '../replays/analyze-latest'
import { closeSettings, openSettings, useIsSettingsOpen } from '../settings/action-creators'
import { GameSettingsPage } from '../settings/settings-page'
import {
  starcraftChecked as starcraftCheckedAtom,
  starcraftPathValid as starcraftPathValidAtom,
  starcraftVersionValid as starcraftVersionValidAtom,
} from '../starcraft/health-state'
import { bahnschrift, labelLarge, labelMedium, titleMedium } from '../styles/typography'
import { RestartToUpdateButton } from '../updates/update-status'
import { openLastGame } from './last-game'
import { SizeLeft, SizeRight, SizeTop, WINDOW_CONTROLS_WIDTH } from './window-controls'

export const SYSTEM_BAR_HEIGHT = 60

const ipcRenderer = new TypedIpcRenderer()

function resumeAfterErrors() {
  ipcRenderer.invoke('autoCaptureResume')?.catch(swallowNonBuiltins)
}

const ALT_S = { keyCode: keycode('s'), altKey: true }
const ALT_G = { keyCode: keycode('g'), altKey: true }

const Container = styled.header`
  flex-grow: 0;
  flex-shrink: 0;

  width: 100%;
  height: ${SYSTEM_BAR_HEIGHT}px;
  margin: 0;
  padding: 0 calc(${WINDOW_CONTROLS_WIDTH}px + 12px) 0 24px;
  position: relative;

  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 20px;

  background-color: var(--theme-surface);
  overflow: hidden;
  z-index: ${zIndexSystemBar};

  -webkit-app-region: drag;
`

const Lockup = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
`

const LogoMark = styled(Logo)`
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
`

const Wordmark = styled.div`
  ${titleMedium};
  ${bahnschrift};
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 1;
  /* Bahnschrift's capitals sit high in their line box, so centering the box leaves them raised. */
  transform: translateY(2px);
`

const Nav = styled.nav`
  height: 100%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
`

type NavTab = 'library' | 'stats' | 'coach' | 'last-game' | 'settings'

const NavItem = styled.button<{ $active: boolean; $tab: NavTab }>`
  ${buttonReset};
  ${labelLarge};
  height: 32px;
  padding: 0 14px 0 11px;

  display: flex;
  align-items: center;
  gap: 7px;

  background-color: ${props =>
    props.$active ? `var(--theme-tab-${props.$tab}-tint)` : 'transparent'};
  border-radius: var(--radius-full);
  box-shadow: inset 0 0 0 1px
    ${props => (props.$active ? `var(--theme-tab-${props.$tab}-ring)` : 'transparent')};
  color: ${props =>
    props.$active ? 'var(--theme-on-surface)' : 'var(--theme-on-surface-variant)'};

  & > :first-child {
    color: var(--theme-tab-${props => props.$tab});
  }
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
  cursor: pointer;
  -webkit-app-region: no-drag;

  &:hover {
    background-color: ${props =>
      props.$active ? `var(--theme-tab-${props.$tab}-tint)` : 'var(--theme-container-high)'};
    color: var(--theme-on-surface);
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

const Spacer = styled.div`
  flex: 1;
`

/** The capture status, which opens a menu to pause or resume analyzing. */
const CaptureStatusButton = styled.button`
  ${buttonReset};
  ${labelMedium};
  flex-shrink: 0;
  height: 28px;
  padding: 0 10px;

  display: flex;
  align-items: center;
  gap: 8px;

  border-radius: var(--radius-full);
  color: var(--theme-on-surface-variant);
  white-space: nowrap;
  cursor: pointer;
  -webkit-app-region: no-drag;

  &:hover {
    background-color: var(--theme-container-high);
    color: var(--theme-on-surface);
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

/** Just the indicator, which takes the mouse so its tooltip can show over the draggable bar. */
const PausedIcon = styled(MaterialIcon).attrs({ icon: 'pause', size: 16 })`
  margin: 0 -3px;
  color: var(--theme-on-surface-variant);
`

const CaptureDot = styled.span<{ $color: string }>`
  width: 8px;
  height: 8px;
  flex-shrink: 0;

  background-color: ${props => props.$color};
  border-radius: var(--radius-full);
`

const CaptureSpinner = styled.span`
  width: 10px;
  height: 10px;
  flex-shrink: 0;

  border: 2px solid var(--theme-info);
  border-right-color: transparent;
  border-radius: var(--radius-full);
  animation: capture-spin 0.8s linear infinite;

  @keyframes capture-spin {
    to {
      transform: rotate(360deg);
    }
  }
`

/** Whether new games are picked up and analyzed, and what's being analyzed now. */
interface CaptureStatusView {
  indicator: React.ReactNode
  label: string
  /** StarCraft can't be started, so nothing can be analyzed until its settings are fixed. */
  starcraftProblem?: boolean
}

function useCaptureStatus(): CaptureStatusView {
  const { t } = useTranslation()
  const { enabled, paused, pausedByUser, queued, running } = useAtomValue(autoCaptureStatusAtom)
  const starcraftChecked = useAtomValue(starcraftCheckedAtom)
  const starcraftPathValid = useAtomValue(starcraftPathValidAtom)
  const starcraftVersionValid = useAtomValue(starcraftVersionValidAtom)

  // Checked first: without StarCraft every analysis fails, and the rest would only say it stopped.
  if (starcraftChecked && (!starcraftPathValid || !starcraftVersionValid)) {
    return {
      indicator: <CaptureDot $color='var(--theme-negative)' />,
      label: starcraftPathValid
        ? t('autoCapture.status.starcraftVersion', 'StarCraft version not supported')
        : t('autoCapture.status.starcraftMissing', 'StarCraft not found'),
      starcraftProblem: true,
    }
  } else if (pausedByUser) {
    if (running) {
      return {
        indicator: <CaptureSpinner />,
        label: t('autoCapture.status.pausing', 'Pausing after this game'),
      }
    }
    return {
      indicator: <PausedIcon />,
      label: queued.length
        ? t('autoCapture.status.pausedQueued', {
            defaultValue: 'Analysis paused, {{count}} waiting',
            count: queued.length,
          })
        : t('autoCapture.status.pausedByUser', 'Analysis paused'),
    }
  } else if (!enabled) {
    return {
      indicator: <CaptureDot $color='var(--theme-outline)' />,
      label: t('autoCapture.status.off', 'Not watching for games'),
    }
  } else if (paused) {
    return {
      indicator: <CaptureDot $color='var(--theme-best)' />,
      label: t('autoCapture.status.stopped', 'Analysis stopped after errors'),
    }
  } else if (running) {
    return {
      indicator: <CaptureSpinner />,
      label: queued.length
        ? t('autoCapture.status.analyzingQueued', {
            defaultValue: 'Analyzing a game, {{count}} waiting',
            count: queued.length,
          })
        : t('autoCapture.status.analyzing', 'Analyzing a game'),
    }
  }
  return {
    indicator: <CaptureDot $color='var(--theme-positive)' />,
    label: t('autoCapture.status.watching', 'Watching for new games'),
  }
}

/**
 * Whether new games are picked up and analyzed, as a button that opens what can be done about it:
 * pausing or resuming, trying again after errors, and dropping the games waiting.
 */
function CaptureStatus({
  status,
  indicatorOnly,
}: {
  status: CaptureStatusView
  /** Shows only the dot, with the status in a tooltip, for a narrow window. */
  indicatorOnly: boolean
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const { paused, pausedByUser, queued, running } = useAtomValue(autoCaptureStatusAtom)
  const [anchor, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('right', 'bottom')
  const [open, openMenu, closeMenu] = usePopoverController({ refreshAnchorPos })
  const run = (action: () => void) => () => {
    closeMenu()
    action()
  }

  const button = (
    <CaptureStatusButton
      ref={anchor}
      type='button'
      aria-haspopup={status.starcraftProblem ? undefined : 'menu'}
      aria-label={indicatorOnly ? status.label : undefined}
      onClick={event =>
        status.starcraftProblem
          ? dispatch(openSettings(GameSettingsPage.StarCraft))
          : openMenu(event)
      }>
      {status.indicator}
      {indicatorOnly ? null : status.label}
    </CaptureStatusButton>
  )

  return (
    <>
      {indicatorOnly || status.starcraftProblem ? (
        <Tooltip
          text={
            status.starcraftProblem
              ? t('autoCapture.status.starcraftFix', "Set StarCraft's location in Settings")
              : status.label
          }
          position='bottom'
          tabIndex={-1}>
          {button}
        </Tooltip>
      ) : (
        button
      )}
      <Popover
        open={open}
        onDismiss={closeMenu}
        anchorX={anchorX ?? 0}
        anchorY={anchorY ?? 0}
        originX='right'
        originY='top'>
        <MenuList dense={true}>
          {pausedByUser ? (
            <MenuItem
              icon={<MaterialIcon icon='play_arrow' />}
              text={t('autoCapture.menu.resume', 'Resume analyzing')}
              onClick={run(() => setAnalysisPaused(false))}
            />
          ) : (
            <MenuItem
              icon={<MaterialIcon icon='pause' />}
              text={t('autoCapture.menu.pause', 'Pause analyzing')}
              secondaryText={
                running
                  ? t('autoCapture.menu.pauseRunning', 'The game being analyzed finishes first')
                  : undefined
              }
              onClick={run(() => setAnalysisPaused(true))}
            />
          )}
          {paused ? (
            <MenuItem
              icon={<MaterialIcon icon='refresh' />}
              text={t('autoCapture.menu.tryAgain', 'Try analyzing again')}
              onClick={run(resumeAfterErrors)}
            />
          ) : null}
          {queued.length ? (
            <MenuItem
              icon={<MaterialIcon icon='clear_all' />}
              text={t('autoCapture.menu.clear', {
                defaultValue: 'Stop the {{count}} waiting',
                count: queued.length,
              })}
              onClick={run(clearWaitingAnalyses)}
            />
          ) : null}
        </MenuList>
      </Popover>
    </>
  )
}

/**
 * How the bar gives up room in a narrow window, so the tabs never wrap. Each level keeps the ones
 * before it.
 */
const FitLevel = {
  Full: 0,
  /** The capture status shows only its dot, with what it means in a tooltip. */
  StatusDotOnly: 1,
  /** The app's name is left out, next to its logo. */
  NoWordmark: 2,
} as const

const DevIndicator = styled.button`
  ${buttonReset};
  ${labelMedium};
  flex-shrink: 0;
  height: 22px;
  padding: 0 10px;

  background-color: var(--theme-container-highest);
  border-radius: var(--radius-full);
  color: var(--theme-on-surface-variant);
  font-weight: 700;
  letter-spacing: 0.06em;
  cursor: pointer;
  -webkit-app-region: no-drag;
`

/** The bar across the top of the window: the app's name, where to go, and the window controls. */
export function SystemBar() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const isSettingsOpen = useIsSettingsOpen()
  const section = useCurrentSection()
  const isReplays = section === 'library'
  const isMyStats = section === 'myStats'
  const isCoach = section === 'coach'
  const isLastGame = section === 'lastGame'
  const [settingsButton, setSettingsButton] = useState<HTMLButtonElement | null>(null)
  useButtonHotkey({ elem: settingsButton, hotkey: ALT_S })
  const [lastGameButton, setLastGameButton] = useState<HTMLButtonElement | null>(null)
  useButtonHotkey({ elem: lastGameButton, hotkey: ALT_G })

  useLayoutEffect(() => {
    document.body.style.setProperty('--gg-system-bar-height', `${SYSTEM_BAR_HEIGHT}px`)
    return () => {
      document.body.style.removeProperty('--gg-system-bar-height')
    }
  }, [])

  const captureStatus = useCaptureStatus()
  const [containerRef, fitLevel] = useFitLevel<HTMLElement>(
    FitLevel.NoWordmark,
    captureStatus.label,
  )

  return (
    <Container ref={containerRef}>
      <SizeTop />
      <SizeLeft />
      <SizeRight />
      <Lockup>
        <LogoMark aria-hidden={true} />
        {fitLevel < FitLevel.NoWordmark ? <Wordmark>GG Stats</Wordmark> : null}
      </Lockup>
      <HistoryButtons />
      <Nav>
        <NavItem
          type='button'
          $tab='library'
          $active={isReplays && !isSettingsOpen}
          onClick={() => push('/replays')}>
          <MaterialIcon icon='video_library' size={20} />
          {t('replays.activity.library', 'Library')}
        </NavItem>
        <NavItem type='button' $tab='stats' $active={isMyStats} onClick={() => push('/my-stats')}>
          <MaterialIcon icon='bar_chart' size={20} />
          {t('myStats.label', 'My stats')}
        </NavItem>
        <NavItem type='button' $tab='coach' $active={isCoach} onClick={() => push('/coach')}>
          <MaterialIcon icon='sports' size={20} />
          {t('myStats.coach.title', 'Coach')}
        </NavItem>
        <Tooltip
          text={t('lastGame.tooltip', 'Stats for your newest game (Alt + G)')}
          position='bottom'>
          <NavItem
            ref={setLastGameButton}
            type='button'
            $tab='last-game'
            $active={isLastGame}
            data-testid='last-game-button'
            onClick={() => dispatch(openLastGame())}>
            <MaterialIcon icon='history' size={20} />
            {t('lastGame.label', 'Last game')}
          </NavItem>
        </Tooltip>
        <Tooltip text={t('settings.activity.title', 'Settings (Alt + S)')} position='bottom'>
          <NavItem
            ref={setSettingsButton}
            type='button'
            $tab='settings'
            $active={isSettingsOpen}
            data-testid='settings-button'
            onClick={() => dispatch(isSettingsOpen ? closeSettings() : openSettings())}>
            <MaterialIcon icon='settings' size={20} />
            {t('settings.activity.label', 'Settings')}
          </NavItem>
        </Tooltip>
      </Nav>
      <Spacer />
      <RestartToUpdateButton />
      <CaptureStatus status={captureStatus} indicatorOnly={fitLevel >= FitLevel.StatusDotOnly} />
      {DEV_INDICATOR ? (
        <DevIndicator type='button' onClick={() => push('/dev')}>
          DEV
        </DevIndicator>
      ) : null}
    </Container>
  )
}
