import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'

/**
 * Camera fallback for phones with no hardware scanner attached.
 *
 * Uses the native BarcodeDetector where the browser has it (Android Chrome -
 * decodes 1D and 2D symbologies), and falls back to decoding frames with jsQR
 * everywhere else, which is what keeps this working on iPhones.
 */

type Detector = {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>
}

declare global {
  interface Window {
    BarcodeDetector?: {
      new (options?: { formats?: string[] }): Detector
      getSupportedFormats?: () => Promise<string[]>
    }
  }
}

interface Props {
  onDetect: (code: string) => void
  onClose: () => void
  /** Tap-free mode: stay open and keep reading instead of closing on the first hit. */
  continuous?: boolean
}

/** Ignore the same code for this long so one label is not read repeatedly. */
const REPEAT_BLOCK_MS = 2500

export default function CameraScanner({ onDetect, onClose, continuous = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [count, setCount] = useState(0)
  const [flash, setFlash] = useState<string | null>(null)
  const doneRef = useRef(false)
  const recentRef = useRef<Map<string, number>>(new Map())
  const continuousRef = useRef(continuous)
  continuousRef.current = continuous
  const onDetectRef = useRef(onDetect)
  onDetectRef.current = onDetect

  useEffect(() => {
    let stream: MediaStream | null = null
    let raf = 0
    let detector: Detector | null = null
    let cancelled = false

    const finish = (code: string) => {
      if (doneRef.current) return

      if (continuousRef.current) {
        // Same label still in frame? Ignore it rather than logging it twice.
        const now = Date.now()
        for (const [seen, at] of recentRef.current) {
          if (now - at > REPEAT_BLOCK_MS) recentRef.current.delete(seen)
        }
        if (recentRef.current.has(code)) return
        recentRef.current.set(code, now)

        navigator.vibrate?.(40)
        setCount((c) => c + 1)
        setFlash(code)
        setTimeout(() => setFlash((f) => (f === code ? null : f)), 1200)
        onDetectRef.current(code)
        return
      }

      doneRef.current = true
      navigator.vibrate?.(40)
      onDetectRef.current(code)
    }

    const tick = async () => {
      if (cancelled || doneRef.current) return
      const video = videoRef.current
      const canvas = canvasRef.current

      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        const w = video.videoWidth
        const h = video.videoHeight
        if (w && h) {
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext('2d', { willReadFrequently: true })
          if (ctx) {
            ctx.drawImage(video, 0, 0, w, h)
            try {
              if (detector) {
                const found = await detector.detect(canvas)
                if (found.length > 0 && found[0].rawValue) {
                  finish(found[0].rawValue)
                  if (doneRef.current) return
                }
              } else {
                const image = ctx.getImageData(0, 0, w, h)
                const found = jsQR(image.data, w, h, { inversionAttempts: 'dontInvert' })
                if (found?.data) {
                  finish(found.data)
                  if (doneRef.current) return
                }
              }
            } catch {
              /* a bad frame is not fatal - keep scanning */
            }
          }
        }
      }
      raf = requestAnimationFrame(() => void tick())
    }

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('This browser cannot open the camera. Type the code instead.')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          video.setAttribute('playsinline', 'true')
          await video.play().catch(() => undefined)
        }

        if (window.BarcodeDetector) {
          try {
            const supported = (await window.BarcodeDetector.getSupportedFormats?.()) ?? []
            const wanted = [
              'qr_code',
              'code_128',
              'code_39',
              'ean_13',
              'ean_8',
              'data_matrix',
              'itf',
              'upc_a',
            ].filter((f) => supported.length === 0 || supported.includes(f))
            detector = new window.BarcodeDetector(wanted.length ? { formats: wanted } : undefined)
          } catch {
            detector = null
          }
        }

        setReady(true)
        void tick()
      } catch (err) {
        const name = (err as { name?: string })?.name
        if (name === 'NotAllowedError') {
          setError('Camera access was blocked. Allow it in your browser settings, or type the code.')
        } else if (name === 'NotFoundError') {
          setError('No camera found on this device. Type the code instead.')
        } else if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
          setError('The camera needs a secure (https) connection. Type the code instead.')
        } else {
          setError('Could not start the camera. Type the code instead.')
        }
      }
    }

    void start()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return (
    <div className="scanner-overlay" role="dialog" aria-modal="true" aria-label="Scan a code">
      <div className="scanner-video-wrap">
        <video ref={videoRef} className="scanner-video" muted playsInline />
        <canvas ref={canvasRef} hidden />
        <div className="scanner-frame" aria-hidden="true">
          <span /><span /><span /><span />
        </div>
      </div>

      <div className="scanner-hint">
        {error ? (
          <p className="scanner-error">{error}</p>
        ) : flash ? (
          <p className="scanner-hit">✓ {flash}</p>
        ) : (
          <p>
            {ready ? 'Point the camera at the label' : 'Starting camera…'}
            {continuous && ready && <><br /><small>Tap-free — keep scanning, no need to tap</small></>}
          </p>
        )}
      </div>

      {continuous && count > 0 && (
        <p className="scanner-count">
          {count} scanned
        </p>
      )}

      <button type="button" className="btn btn-lg btn-ghost-light scanner-close" onClick={onClose}>
        {continuous && count > 0 ? 'Done' : 'Cancel'}
      </button>
    </div>
  )
}
