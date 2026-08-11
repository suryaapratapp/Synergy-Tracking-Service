import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
