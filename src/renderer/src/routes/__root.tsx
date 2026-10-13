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
      <nav className="nav">
        <Link to="/" activeProps={{ className: 'active' }} activeOptions={{ exact: true }}>
          Home
        </Link>
        <Link to="/about" activeProps={{ className: 'active' }}>
          About
        </Link>
      </nav>
      <main className="content">
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
