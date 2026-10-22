import { defineConfig } from 'vitest/config'

/** Runs the desktop code that produces the Android app's interop fixtures. See README.md. */
export default defineConfig({
  test: {
    include: ['android/scripts/*.test.ts'],
    environment: 'node',
    testTimeout: 0
  }
})
