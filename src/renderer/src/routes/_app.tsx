import { Link, Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  KeyRound,
  LayoutDashboard,
  Lock,
  RefreshCw,
  Settings,
  Wand2,
  type LucideIcon
} from 'lucide-react'
import { api, queries } from '@renderer/lib/api'
import { toastError } from '@renderer/lib/toast'

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context }) => {
    const status = await context.queryClient.fetchQuery(queries.status())
    if (status.state !== 'unlocked') throw redirect({ to: '/unlock' })
  },
  component: AppLayout
})

const NAV: {
  to: '/' | '/passwords' | '/generator' | '/sync' | '/settings'
  label: string
  icon: LucideIcon
}[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/passwords', label: 'Passwords', icon: KeyRound },
  { to: '/generator', label: 'Generator', icon: Wand2 },
  { to: '/sync', label: 'Sync', icon: RefreshCw },
  { to: '/settings', label: 'Settings', icon: Settings }
]

function AppLayout(): React.JSX.Element {
  const lock = useMutation({ mutationFn: () => api.invoke('vault:lock'), onError: toastError })
  const { data: settings } = useQuery(queries.settings())

  return (
    <div className="flex h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950 px-3 pt-12 pb-4 [-webkit-app-region:drag]">
        <nav className="flex flex-col gap-1 [-webkit-app-region:no-drag]">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === '/', includeSearch: false }}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 data-[status=active]:bg-zinc-800/80 data-[status=active]:text-zinc-100"
            >
              <Icon className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto space-y-3 [-webkit-app-region:no-drag]">
          {settings && <p className="truncate px-3 text-xs text-zinc-500">{settings.deviceName}</p>}
          <button
            onClick={() => lock.mutate()}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
          >
            <Lock className="size-4" />
            Lock vault
          </button>
        </div>
      </aside>
      <main id="main" className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
