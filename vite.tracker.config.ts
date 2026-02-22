import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  build: {
    outDir: 'dist/tracker',
    lib: {
      entry: resolve(__dirname, 'src/tracker.ts'),
      name: 'SigflareTracker',
      fileName: 'sigflare-tracker',
      formats: ['iife'],
    },
    rollupOptions: {
      output: {
        entryFileNames: 'sigflare-tracker.js',
      },
    },
  },
})
