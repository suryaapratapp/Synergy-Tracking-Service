/**
 * Camera permission on the Android app.
 *
 * Tapping the camera button asks Android for the camera right then, with
 * Android's own dialog. If it was refused for good, Android will not ask
 * again, so we say so and offer a button that opens the app's Settings page.
 * In a normal browser there is no bridge and the browser handles it.
 */

interface NativeBridge {
  cameraState: () => string
  requestCamera: () => void
  openSettings: () => void
}

declare global {
  interface Window {
    TexTrakNative?: NativeBridge
    __texTrakCamera?: (granted: boolean) => void
  }
}

export type CameraAccess = 'granted' | 'denied'

export function canOpenSettings(): boolean {
  return !!window.TexTrakNative
}

export function openAppSettings() {
  window.TexTrakNative?.openSettings()
}

export function ensureCamera(): Promise<CameraAccess> {
  const native = window.TexTrakNative
  if (!native) return Promise.resolve('granted') // a browser asks for itself when the camera starts

  const state = native.cameraState()
  if (state === 'granted') return Promise.resolve('granted')
  if (state === 'denied') return Promise.resolve('denied')

  return new Promise((resolve) => {
    window.__texTrakCamera = (granted) => {
      window.__texTrakCamera = undefined
      resolve(granted ? 'granted' : 'denied')
    }
    native.requestCamera()
  })
}
