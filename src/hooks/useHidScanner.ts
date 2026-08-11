import { useEffect, useRef, useState } from 'react'

/**
 * Listens for hardware barcode scanners anywhere in the app.
 *
 * Bluetooth/USB ring scanners and the Nordic ID handhelds present themselves
 * to the phone as a keyboard: on a scan they "type" the code far faster than
 * a person can, usually followed by Enter. We watch the gaps between
 * keystrokes to tell a scan apart from someone typing, so no pairing step,
 * driver or device-specific code is needed - if the phone sees the scanner,
 * the app sees the scanner.
 *
 * Keystrokes aimed at a real input are left alone; those fields handle their
 * own Enter key so manual typing keeps working exactly as expected.
 */

/** Max gap between characters that still counts as machine-typed. */
const MACHINE_GAP_MS = 60
/** Scanners with no Enter suffix: flush once input goes quiet. */
const FLUSH_MS = 120
const MIN_LENGTH = 3

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable ||
    el.getAttribute('role') === 'textbox'
  )
}

export function useHidScanner(onScan: (code: string) => void, enabled = true) {
  const [hardwareSeen, setHardwareSeen] = useState(false)
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan

  useEffect(() => {
    if (!enabled) return

    let buffer = ''
    let lastKey = 0
    let machineTyped = true
    let flushTimer: ReturnType<typeof setTimeout> | undefined

    const reset = () => {
      buffer = ''
      machineTyped = true
      if (flushTimer) clearTimeout(flushTimer)
      flushTimer = undefined
    }

    const commit = () => {
      const code = buffer.trim()
      reset()
      if (code.length < MIN_LENGTH || !machineTyped) return
      setHardwareSeen(true)
      onScanRef.current(code)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      // Let real form fields own their keystrokes.
      if (isEditable(e.target)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const now = performance.now()
      const gap = now - lastKey
      lastKey = now

      if (e.key === 'Enter') {
        if (buffer.length >= MIN_LENGTH) {
          e.preventDefault()
          commit()
        } else {
          reset()
        }
        return
      }

      // Only single printable characters form part of a barcode.
      if (e.key.length !== 1) return

      if (buffer.length > 0 && gap > MACHINE_GAP_MS) machineTyped = false
      buffer += e.key

      if (flushTimer) clearTimeout(flushTimer)
      flushTimer = setTimeout(() => {
        if (buffer.length >= MIN_LENGTH) commit()
        else reset()
      }, FLUSH_MS)
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      if (flushTimer) clearTimeout(flushTimer)
    }
  }, [enabled])

  return { hardwareSeen }
}
