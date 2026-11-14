import { useEffect, useState } from 'react'

type Direction = 'up' | 'down' | 'left' | 'right'

const FOCUSABLE_SELECTOR = [
  'button:not([disabled]):not([aria-hidden="true"])',
  'a[href]:not([aria-hidden="true"])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[role="button"][tabindex="0"]',
].join(', ')

function getActiveScope(): HTMLElement {
  const modals = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')
  if (modals.length > 0) return modals[modals.length - 1]
  return document.body
}

function getVisibleFocusables(scope: HTMLElement): HTMLElement[] {
  const nodes = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
  return nodes.filter((el) => {
    const rect = el.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== 'hidden'
  })
}

function moveFocus(direction: Direction) {
  const scope = getActiveScope()
  const focusables = getVisibleFocusables(scope)
  if (focusables.length === 0) return

  const current = document.activeElement instanceof HTMLElement && scope.contains(document.activeElement)
    ? document.activeElement
    : null

  if (!current) {
    focusables[0].focus({ preventScroll: false })
    focusables[0].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
    return
  }

  const cr = current.getBoundingClientRect()
  const cx = cr.left + cr.width / 2
  const cy = cr.top + cr.height / 2

  let best: HTMLElement | null = null
  let bestScore = Infinity

  for (const candidate of focusables) {
    if (candidate === current) continue
    const r = candidate.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    const dx = x - cx
    const dy = y - cy

    if (direction === 'right' && dx <= 8) continue
    if (direction === 'left' && dx >= -8) continue
    if (direction === 'down' && dy <= 8) continue
    if (direction === 'up' && dy >= -8) continue

    const primary = direction === 'left' || direction === 'right' ? Math.abs(dx) : Math.abs(dy)
    const secondary = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx)
    const score = primary + secondary * 2.4

    if (score < bestScore) {
      bestScore = score
      best = candidate
    }
  }

  if (best) {
    best.focus({ preventScroll: true })
    best.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }
}

function dispatchKey(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

/**
 * Enables Xbox / DualSense / generic controller navigation via the Web Gamepad API.
 * - D-Pad / Left Stick: spatial focus navigation across cards, episodes, and buttons
 * - A / Cross: activate focused item (or Play/Pause in video player)
 * - B / Circle: go back / close modal or player
 * - In player: LB/RB seek -10s/+10s, Start/X play/pause, Y fullscreen, Back/Select mute
 */
export function useGamepadNavigation(playerOpen: boolean): string | null {
  const [connectedName, setConnectedName] = useState<string | null>(null)

  useEffect(() => {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return

    let rafId = 0
    const prevButtons = new Map<number, boolean>()
    let lastDir: Direction | null = null
    let lastDirAt = 0
    let dirRepeatCount = 0

    const syncConnected = () => {
      const pads = Array.from(navigator.getGamepads()).filter((p): p is Gamepad => Boolean(p && p.connected))
      setConnectedName(pads[0]?.id ?? null)
      return pads
    }

    const onConnect = () => syncConnected()
    const onDisconnect = () => syncConnected()

    window.addEventListener('gamepadconnected', onConnect)
    window.addEventListener('gamepaddisconnected', onDisconnect)

    const tick = (now: number) => {
      const pads = Array.from(navigator.getGamepads()).filter((p): p is Gamepad => Boolean(p && p.connected))
      const pad = pads[0]

      if (pad) {
        setConnectedName((prev) => (prev === pad.id ? prev : pad.id))
        const pressed = (idx: number) => Boolean(pad.buttons[idx]?.pressed)
        const justPressed = (idx: number) => {
          const cur = pressed(idx)
          const prev = prevButtons.get(idx) ?? false
          prevButtons.set(idx, cur)
          return cur && !prev
        }

        // Directional input (D-Pad 12..15 + Left Stick axes 0,1)
        const axX = pad.axes[0] ?? 0
        const axY = pad.axes[1] ?? 0
        let dir: Direction | null = null
        if (pressed(12) || axY < -0.55) dir = 'up'
        else if (pressed(13) || axY > 0.55) dir = 'down'
        else if (pressed(14) || axX < -0.55) dir = 'left'
        else if (pressed(15) || axX > 0.55) dir = 'right'

        if (dir) {
          const threshold = dirRepeatCount === 0 ? 0 : dirRepeatCount === 1 ? 300 : 140
          if (dir !== lastDir || now - lastDirAt >= threshold) {
            lastDir = dir
            lastDirAt = now
            dirRepeatCount = dir === lastDir ? dirRepeatCount + 1 : 1
            if (playerOpen && !document.activeElement?.closest('[data-player-controls]')) {
              if (dir === 'left') dispatchKey('ArrowLeft')
              else if (dir === 'right') dispatchKey('ArrowRight')
              else if (dir === 'up') dispatchKey('ArrowUp')
              else if (dir === 'down') dispatchKey('ArrowDown')
            } else {
              moveFocus(dir)
            }
          }
        } else {
          lastDir = null
          dirRepeatCount = 0
        }

        if (justPressed(0)) {
          // A / Cross
          const active = document.activeElement
          if (active instanceof HTMLElement && active !== document.body) {
            active.click()
          } else if (playerOpen) {
            dispatchKey(' ')
          } else {
            moveFocus('down')
          }
        }

        if (justPressed(1)) {
          // B / Circle
          dispatchKey('Escape')
        }

        if (playerOpen) {
          if (justPressed(2) || justPressed(9)) dispatchKey(' ') // X or Start -> Play/Pause
          if (justPressed(3)) dispatchKey('f') // Y -> Fullscreen
          if (justPressed(4) || justPressed(6)) dispatchKey('ArrowLeft') // LB / LT -> -10s
          if (justPressed(5) || justPressed(7)) dispatchKey('ArrowRight') // RB / RT -> +10s
          if (justPressed(8)) dispatchKey('m') // Back / Select -> Mute
        }
      } else {
        setConnectedName((prev) => (prev === null ? prev : null))
      }

      rafId = window.requestAnimationFrame(tick)
    }

    syncConnected()
    rafId = window.requestAnimationFrame(tick)

    return () => {
      window.cancelAnimationFrame(rafId)
      window.removeEventListener('gamepadconnected', onConnect)
      window.removeEventListener('gamepaddisconnected', onDisconnect)
    }
  }, [playerOpen])

  return connectedName
}
