import { useEffect } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { Outlet, createRootRouteWithContext, useRouter } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { api, queries } from '@renderer/lib/api'
import { Toaster } from '@renderer/components/ui'
import { resetWorkspace } from '@renderer/lib/workspace'

interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout
})

/** Keeps the query cache in step with vault events pushed from the main process. */
function useVaultEvents(): void {
  const queryClient = useQueryClient()
  const router = useRouter()

  useEffect(() => {
    return api.onEvent((event) => {
      if (event === 'locked') {
        // Drop everything derived from the decrypted vault
        queryClient.removeQueries({ queryKey: ['vault'] })
        resetWorkspace()
        void queryClient.invalidateQueries(queries.status())
        void router.navigate({ to: '/unlock' })
      } else if (event === 'changed') {
        void queryClient.invalidateQueries({ queryKey: ['vault'] })
      } else if (event === 'sync-status') {
        void queryClient.invalidateQueries({ queryKey: ['sync'] })
        void queryClient.invalidateQueries(queries.settings())
      } else if (event === 'update-status') {
        void queryClient.invalidateQueries(queries.update())
      }
    })
  }, [queryClient, router])
}

function RootLayout(): React.JSX.Element {
  useVaultEvents()
  return (
    <>
      <Outlet />
      <Toaster />
      {import.meta.env.DEV && (
        <>
          <ReactQueryDevtools buttonPosition="bottom-left" />
          <TanStackRouterDevtools position="bottom-right" />
        </>
      )}
    </>
  )
}
