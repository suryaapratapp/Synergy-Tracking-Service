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
}

export default config
