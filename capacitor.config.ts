import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  // Reverse-domain id. Fixed once the app is on the Play Store - it cannot be
  // changed afterwards without publishing as a different app.
  appId: 'com.circai.textrak',
  appName: 'Tex-Trak',
  // The Vite build output. The app ships with its own copy of the interface,
  // so it opens instantly and the shell never needs a network round trip.
  webDir: 'dist',
  android: {
    // https://localhost: a secure context, which the camera scanner requires.
    allowMixedContent: false,
  },
  plugins: {
    // Live updates of the app's screens (see src/lib/appUpdate.ts). Fully manual: the app
    // decides when to check, from our own app_releases table - nothing is fetched from, or
    // reported to, any outside service, so the vendor's default addresses are blanked.
    CapacitorUpdater: {
      autoUpdate: false,
      updateUrl: '',
      statsUrl: '',
      channelUrl: '',
      // A new version that has not said "I started fine" within this long is thrown away,
      // and the phone goes back to the last version that worked.
      appReadyTimeout: 15000,
    },
  },
}

export default config
