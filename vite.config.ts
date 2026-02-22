import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  build: {
    outDir: 'dist',
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'sigflare',
      fileName: 'index',
      formats: ['es']
    },
    rollupOptions: {
      output: {
        entryFileNames: 'index.js'
      }
    }
  }
})
