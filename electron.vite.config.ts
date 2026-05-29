import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // franc-min (and its trigram deps) are ESM-only; bundle them into the CJS
    // main process instead of leaving a require() that Electron can't resolve.
    plugins: [externalizeDepsPlugin({ exclude: ['franc-min'] })],
    resolve: {
      alias: {
        '@main': resolve('src/main'),
        '@shared': resolve('src/shared')
      }
    },
    build: {
      lib: {
        entry: resolve('src/main/index.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      lib: {
        entry: resolve('src/preload/preload.ts')
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@shared': resolve('src/shared'),
        '@': resolve('src/renderer')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve('src/renderer/index.html'),
        output: {
          manualChunks: {
            react: ['react', 'react-dom'],
            i18n: ['i18next', 'react-i18next'],
            motion: ['framer-motion']
          }
        }
      }
    }
  }
})
