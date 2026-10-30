import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Lists every file the build produced inside the service worker, so the whole
 * app is saved on the first visit and opens with no signal. Also stamps the
 * build so each release gets its own cache.
 */
function precacheManifest(): Plugin {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name)
      return statSync(full).isDirectory() ? walk(full) : [full]
    })

  return {
    name: 'tex-trak-precache',
    apply: 'build',
    closeBundle() {
      const dist = resolve('dist')
      const swPath = join(dist, 'sw.js')
      const skip = new Set(['sw.js', '_redirects', '.DS_Store'])
      const files = walk(dist)
        .map((f) => '/' + relative(dist, f).split('\\').join('/'))
        .filter((f) => !skip.has(f.slice(1)) && !f.endsWith('.map'))
      const sw = readFileSync(swPath, 'utf8')
        .replace('__BUILD__', Date.now().toString(36))
        .replace('const PRECACHE = []', `const PRECACHE = ${JSON.stringify(files)}`)
      writeFileSync(swPath, sw)
    },
  }
}

/** The app version shown in the app: the Android versionName, so the two always agree. */
function appVersion(): string {
  try {
    return /versionName\s+"([^"]+)"/.exec(readFileSync(resolve('android/app/build.gradle'), 'utf8'))?.[1] ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  plugins: [react(), precacheManifest()],
  server: { port: 5180, host: true },
  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@supabase')) return 'supabase'
          if (id.includes('jsqr')) return 'scanner'
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|scheduler)/.test(id)) return 'vendor'
          return undefined
        },
      },
    },
  },
})
