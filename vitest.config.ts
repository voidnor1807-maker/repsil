import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@main': resolve('src/main'),
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer')
    }
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node'
  }
})
