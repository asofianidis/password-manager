import { createHashHistory, createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { queryClient } from './lib/query-client'

export const router = createRouter({
  routeTree,
  // Hash history so routing works when the app is loaded from file:// in production
  history: createHashHistory(),
  context: { queryClient },
  defaultPreload: 'intent',
  // Pages scroll inside <main>, not the window
  scrollToTopSelectors: ['#main'],
  // Let TanStack Query own caching; loaders just prime the query cache
  defaultPreloadStaleTime: 0
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
