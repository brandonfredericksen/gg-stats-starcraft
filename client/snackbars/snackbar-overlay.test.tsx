import { act, fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SnackbarController, SnackbarOptions } from './snackbar-controller-registry'
import { DURATION_LONG, DURATION_SHORT } from './snackbar-durations'
import { SnackbarOverlay, useSnackbarController } from './snackbar-overlay'

const windowFocus = vi.hoisted(() => ({ focused: true }))

vi.mock('../dom/window-focus', () => ({
  useWindowFocus: () => windowFocus.focused,
}))

let capturedController: SnackbarController | undefined

function ControllerGrabber() {
  const controller = useSnackbarController()

  useEffect(() => {
    capturedController = controller
  }, [controller])

  return null
}

describe('client/snackbars/snackbar-overlay', () => {
  beforeEach(() => {
    capturedController = undefined
    windowFocus.focused = true
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const doRender = () => {
    const result = render(
      <SnackbarOverlay>
        <ControllerGrabber />
      </SnackbarOverlay>,
    )

    return {
      rerender: () =>
        result.rerender(
          <SnackbarOverlay>
            <ControllerGrabber />
          </SnackbarOverlay>,
        ),
      show: (message: string, options?: SnackbarOptions) => {
        act(() => {
          capturedController!.showSnackbar(message, options)
        })
      },
      advance: (millis: number) => {
        act(() => {
          vi.advanceTimersByTime(millis)
        })
      },
    }
  }

  test('a burst shows only the newest few, and closing one never brings back an older one', () => {
    const { show } = doRender()

    for (const message of ['a', 'b', 'c', 'd', 'e']) {
      show(message, { durationMillis: DURATION_LONG })
    }

    expect(screen.queryByText('a')).toBeNull()
    expect(screen.queryByText('b')).toBeNull()
    expect(screen.getAllByRole('status')).toHaveLength(3)

    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[2])

    expect(screen.queryByText('e')).toBeNull()
    expect(screen.queryByText('b')).toBeNull()
    expect(screen.getAllByRole('status')).toHaveLength(2)
  })

  test('a repeated message counts up on the one showing instead of stacking a copy', () => {
    const { show } = doRender()

    show('a')
    show('b')
    show('a')
    show('a')

    const statuses = screen.getAllByRole('status')
    expect(statuses).toHaveLength(2)
    // The repeat moved to the newest spot
    expect(statuses[1].textContent).toContain('a')
    expect(statuses[1].textContent).toContain('×3')
  })

  test('a snackbar goes away once its duration passes', () => {
    const { show, advance } = doRender()

    show('a')
    advance(DURATION_SHORT - 1)
    expect(screen.getByText('a')).toBeDefined()

    advance(1)
    expect(screen.queryByText('a')).toBeNull()
  })

  test('a repeat starts the countdown over', () => {
    const { show, advance } = doRender()

    show('a')
    advance(DURATION_SHORT - 1000)
    show('a')
    advance(DURATION_SHORT - 1)
    expect(screen.getByText('a')).toBeDefined()

    advance(1)
    expect(screen.queryByText('a')).toBeNull()
  })

  test('hovering any snackbar holds them all, and leaving picks up where they left off', () => {
    const { show, advance } = doRender()

    show('a')
    show('b')
    advance(1000)
    fireEvent.mouseEnter(screen.getByText('a').closest('[role=status]')!.parentElement!)
    advance(DURATION_LONG)
    expect(screen.getByText('a')).toBeDefined()
    expect(screen.getByText('b')).toBeDefined()

    fireEvent.mouseLeave(screen.getByText('a').closest('[role=status]')!.parentElement!)
    advance(DURATION_SHORT - 1001)
    expect(screen.getByText('b')).toBeDefined()

    advance(1)
    expect(screen.queryByText('a')).toBeNull()
    expect(screen.queryByText('b')).toBeNull()
  })

  test('closing the hovered snackbar lets the rest count down again', () => {
    const { show, advance } = doRender()

    show('a')
    show('b')
    const a = screen.getByText('a').closest('[role=status]')!
    fireEvent.mouseEnter(a.parentElement!)
    // Removing an element from under the mouse doesn't send a leave event
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0])

    advance(DURATION_SHORT)
    expect(screen.queryByText('b')).toBeNull()
  })

  test('snackbars wait while the window is unfocused', () => {
    const { show, advance, rerender } = doRender()

    windowFocus.focused = false
    rerender()
    show('a')
    advance(DURATION_LONG)
    expect(screen.getByText('a')).toBeDefined()

    windowFocus.focused = true
    rerender()
    advance(DURATION_SHORT)
    expect(screen.queryByText('a')).toBeNull()
  })

  test('using the action runs it and closes the snackbar', () => {
    const { show } = doRender()
    const onClick = vi.fn()

    show('a', { durationMillis: DURATION_LONG, action: { label: 'View stats', onClick } })
    fireEvent.click(screen.getByRole('button', { name: 'View stats' }))

    expect(onClick).toHaveBeenCalledOnce()
    expect(screen.queryByText('a')).toBeNull()
  })

  test('an error is announced as an alert', () => {
    const { show } = doRender()

    show('Something broke', { tone: 'error' })

    expect(screen.getByRole('alert').textContent).toContain('Something broke')
  })
})
