import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { DataProvider } from './context/DataContext'
import { ToastProvider } from './components/ui'
import './styles.css'
import { appStarted, checkForAppUpdateInBackground } from './lib/appUpdate'

/**
 * If the app cannot start, say so on the page. A crash before React mounts
 * otherwise leaves a blank white screen, which looks identical to a failed
 * deploy and tells whoever is looking at it nothing at all.
 */
function showStartupError(detail: string) {
  const root = document.getElementById('root')
  if (!root) return
  root.innerHTML = `
    <div class="startup-error">
      <h1>Tex-Trak could not start</h1>
      <p>The app loaded but hit an error before it could show anything.</p>
      <p class="startup-error-detail"></p>
      <p class="startup-error-hint">
        Try reloading. If it keeps happening, send this message to your administrator.
      </p>
    </div>`
  // textContent, not innerHTML - the message can contain anything.
  const slot = root.querySelector('.startup-error-detail')
  if (slot) slot.textContent = detail
}

try {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <DataProvider>
              <App />
            </DataProvider>
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </StrictMode>,
  )
} catch (err) {
  showStartupError(err instanceof Error ? err.message : String(err))
}

// Tell the live-update system this version started fine (or note that it was rolled back),
// then quietly look for a newer one.
void appStarted()
checkForAppUpdateInBackground()

// The installed Android app ships its own copy of the interface, so the web
// build's offline cache is unnecessary there - and a stale one could outlive
// an app update.
const insideNativeApp = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()

if ('serviceWorker' in navigator && import.meta.env.PROD && !insideNativeApp) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* the app works fine without offline support */
    })
  })
}
