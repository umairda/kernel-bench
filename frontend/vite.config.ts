import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { execSync } from 'node:child_process'

function getBuildSha() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

const buildSha = getBuildSha()
const buildDate = new Date().toISOString()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_BUILD_SHA__: JSON.stringify(buildSha),
    __APP_BUILD_DATE__: JSON.stringify(buildDate),
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
  },
})
