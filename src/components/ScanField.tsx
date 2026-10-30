import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { normaliseCode } from '../lib/format'
import { canOpenSettings, ensureCamera, openAppSettings } from '../lib/nativeCamera'

const CameraScanner = lazy(() => import('./CameraScanner'))

const TAP_FREE_KEY = 'tracker.tapFreeScanning'
/** How long the field must stay unchanged before a tap-free submit fires. */
const QUIET_MS = 350
const MIN_LENGTH = 4

interface Props {
  onSubmit: (code: string) => void
  /** Kept for callers that still pass it; the field no longer spells it out. */
  hardwareSeen?: boolean
  label?: string
  placeholder?: string
  busy?: boolean
  autoFocus?: boolean
  disabled?: boolean
  /** What went wrong with the last scan - shown right under the field, in red. */
  error?: string | null
  /** Why the field is switched off, shown instead of the error. */
  hint?: string | null
}

/**
 * One control, three ways in: a paired hardware scanner types straight into
 * it, the camera decodes a label, or the user types the code.
 *
 * Tap-free mode removes the confirm step entirely - the code commits as soon
 * as it lands, and the camera keeps scanning so a whole bay can be worked
 * through without touching the screen.
 */
export default function ScanField({
  onSubmit,
  label = 'Scan or type the code',
  placeholder = 'Code',
  busy = false,
  autoFocus = false,
  disabled = false,
  error = null,
  hint = null,
}: Props) {
  const [value, setValue] = useState('')
  const [camera, setCamera] = useState(false)
  const [cameraBlocked, setCameraBlocked] = useState(false)
  const [tapFree, setTapFree] = useState(() => localStorage.getItem(TAP_FREE_KEY) === '1')
  const inputRef = useRef<HTMLInputElement>(null)
  const quietTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const onSubmitRef = useRef(onSubmit)
  onSubmitRef.current = onSubmit

  useEffect(() => {
    localStorage.setItem(TAP_FREE_KEY, tapFree ? '1' : '0')
  }, [tapFree])

  // Only steal focus on devices with a physical keyboard - popping the on-screen
  // keyboard open the moment a fitter lands on the page is hostile.
  useEffect(() => {
    if (!autoFocus || disabled) return
    const coarse = window.matchMedia?.('(pointer: coarse)').matches
    if (!coarse) inputRef.current?.focus()
  }, [autoFocus, disabled])

  useEffect(() => () => clearTimeout(quietTimer.current), [])

  const submit = (raw: string) => {
    clearTimeout(quietTimer.current)
    const code = normaliseCode(raw)
    if (!code) return
    setValue('')
    onSubmitRef.current(code)
  }

  // Ask for the camera at the moment it is wanted. If Android has been told "no"
  // for good, say how to switch it on instead of showing a camera that stays black.
  const openCamera = async () => {
    setCameraBlocked(false)
    if ((await ensureCamera()) === 'granted') setCamera(true)
    else setCameraBlocked(true)
  }

  const handleChange = (next: string) => {
    setValue(next)
    clearTimeout(quietTimer.current)
    if (!tapFree || disabled || busy) return
    if (normaliseCode(next).length < MIN_LENGTH) return
    // A scanner fills the field in one burst; a person is still typing.
    quietTimer.current = setTimeout(() => submit(next), QUIET_MS)
  }

  return (
    <div className="scan-field">
      <div className="scan-head">
        <label className="field-label" htmlFor="scan-input">
          {label}
        </label>
        <label className="tapfree-toggle">
          <input type="checkbox" checked={tapFree} onChange={(e) => setTapFree(e.target.checked)} />
          <span>Tap-free</span>
        </label>
      </div>

      <div className="scan-row">
        <input
          id="scan-input"
          ref={inputRef}
          className="input input-scan"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit(value)
            }
          }}
          placeholder={placeholder}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          enterKeyHint="go"
          inputMode="text"
          disabled={disabled || busy}
          aria-invalid={error ? true : undefined}
        />
        <button
          type="button"
          className="btn btn-camera"
          onClick={() => void openCamera()}
          disabled={disabled || busy}
          aria-label="Scan with the camera"
        >
          <CameraIcon />
        </button>
        {!tapFree && (
          <button
            type="button"
            className="btn btn-primary btn-go"
            onClick={() => submit(value)}
            disabled={disabled || busy || !value.trim()}
          >
            {busy ? '…' : 'Add'}
          </button>
        )}
      </div>

      {cameraBlocked && (
        <div className="scan-error" role="alert">
          <span className="scan-error-icon" aria-hidden="true">
            !
          </span>
          <span className="scan-error-body">
            The camera is switched off for this app.
            {canOpenSettings() && (
              <button type="button" className="btn btn-sm scan-error-btn" onClick={openAppSettings}>
                Open settings
              </button>
            )}
          </span>
        </div>
      )}

      {error ? (
        <div className="scan-error" role="alert">
          <span className="scan-error-icon" aria-hidden="true">
            !
          </span>
          <span>{error}</span>
        </div>
      ) : hint ? (
        <p className="scan-hint">{hint}</p>
      ) : null}

      {/*
        The scanner covers the whole screen, so it must sit directly in <body>. Inside a card
        it would be confined to the card: a frosted (backdrop-filter) card turns `position: fixed`
        into "fixed to this card".
      */}
      {camera &&
        createPortal(
          <Suspense fallback={<div className="scanner-overlay scanner-loading">Opening camera…</div>}>
            <CameraScanner
              continuous={tapFree}
              onDetect={(code) => {
                if (!tapFree) setCamera(false)
                submit(code)
              }}
              onClose={() => setCamera(false)}
            />
          </Suspense>,
          document.body,
        )}
    </div>
  )
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 9a2 2 0 0 1 2-2h2l1.2-2h7.6L17 7h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z" />
      <circle cx="12" cy="13" r="3.4" />
    </svg>
  )
}
