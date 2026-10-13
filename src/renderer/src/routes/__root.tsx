import type { QueryClient } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { Link, Outlet, createRootRouteWithContext } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'

interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout
})

function RootLayout(): React.JSX.Element {
  return (
    <>
      <nav className="flex gap-4 border-b border-zinc-800 px-5 py-3 font-semibold">
        <Link
          to="/"
          className="text-zinc-400 hover:text-zinc-100 data-[status=active]:text-zinc-100"
          activeOptions={{ exact: true }}
        >
          Home
        </Link>
        <Link
          to="/about"
          className="text-zinc-400 hover:text-zinc-100 data-[status=active]:text-zinc-100"
        >
          About
        </Link>
      </nav>
      <main className="p-5">
        <Outlet />
      </main>
      {import.meta.env.DEV && (
        <>
          <ReactQueryDevtools buttonPosition="bottom-left" />
          <TanStackRouterDevtools position="bottom-right" />
        </>
      )}
    </>
  )
}
