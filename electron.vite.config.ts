import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

// Vite 8 (rolldown) only keeps "use strict" that the source already has. The main and preload
// bundles are CommonJS, so add it: the TypeScript they come from is written as strict ES modules.
const output = { strict: true }

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          // Run by browsers as the native messaging host (see src/main/browser/install.ts)
          'native-host': resolve('src/main/browser/native-host.ts')
        },
        output
      }
    }
  },
  preload: {
    build: { rollupOptions: { output } }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [
      // Must come before the React plugin
      tanstackRouter({
        target: 'react',
        autoCodeSplitting: true,
        routesDirectory: resolve('src/renderer/src/routes'),
        generatedRouteTree: resolve('src/renderer/src/routeTree.gen.ts')
      }),
      react(),
      tailwindcss()
    ]
  }
})
