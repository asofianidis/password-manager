import { useEffect } from 'react'
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
  useRouterState
} from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  Files,
  GitCompareArrows,
  LockKeyhole,
  LockOpen,
  Monitor,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  SquareTerminal,
  XCircle,
  type LucideIcon
} from 'lucide-react'
import { api, queries } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { timeAgo } from '@renderer/lib/format'
import { MOD, isMac, isMod } from '@renderer/lib/keys'
import { toastError } from '@renderer/lib/toast'
import { openPalette } from '@renderer/lib/workspace'
import { CommandPalette } from '@renderer/components/CommandPalette'

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context }) => {
    const status = await context.queryClient.fetchQuery(queries.status())
    if (status.state !== 'unlocked') throw redirect({ to: '/unlock' })
  },
  component: AppLayout
})

type NavTarget = '/' | '/passwords' | '/generator' | '/sync' | '/settings'

const ACTIVITY: { to: NavTarget; label: string; icon: LucideIcon }[] = [
  { to: '/passwords', label: 'Explorer', icon: Files },
  { to: '/', label: 'Problems', icon: ShieldAlert },
  { to: '/generator', label: 'Generator', icon: SquareTerminal },
  { to: '/sync', label: 'Sync', icon: GitCompareArrows }
]

const lock = (): void => void api.invoke('vault:lock').catch(toastError)

function useGlobalShortcuts(): void {
  const navigate = useNavigate()
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!isMod(e)) return
      const key = e.key.toLowerCase()
      const go = (to: NavTarget, search?: Record<string, unknown>): void => {
        e.preventDefault()
        void navigate({ to, search })
      }
      if (e.shiftKey && key === 'p') {
        e.preventDefault()
        openPalette('>')
      } else if (key === 'k' || key === 'p') {
        e.preventDefault()
        openPalette('')
      } else if (key === 'n' && !e.shiftKey) go('/passwords', { id: 'new' })
      else if (key === 'l' && !e.shiftKey) {
        e.preventDefault()
        lock()
      } else if (key === ',') go('/settings')
      else if (e.shiftKey && key === 'e') go('/passwords')
      else if (e.shiftKey && key === 'm') go('/')
      else if (e.shiftKey && key === 'g') go('/generator')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate])
}

function AppLayout(): React.JSX.Element {
  useGlobalShortcuts()
  return (
    <div className="flex h-screen flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <ActivityBar />
        <main id="main" className="min-w-0 flex-1 overflow-y-auto bg-ide-bg">
          <Outlet />
        </main>
      </div>
      <StatusBar />
      <CommandPalette />
    </div>
  )
}

function TitleBar(): React.JSX.Element {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const page =
    ACTIVITY.find((a) => a.to === pathname)?.label ?? (pathname === '/settings' ? 'Settings' : '')
  return (
    <header
      className={cn(
        'relative flex h-9 shrink-0 items-center border-b border-ide-border bg-ide-chrome pr-3 text-xs text-ide-muted drag',
        isMac ? 'pl-20' : 'pl-3'
      )}
    >
      <span className="truncate">
        password-manager{page && <span className="text-ide-faint"> — {page.toLowerCase()}</span>}
      </span>
      <button
        onClick={() => openPalette('')}
        className="absolute top-1/2 left-1/2 flex h-6 w-[min(36rem,50vw)] -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-2 rounded-md border border-ide-border bg-ide-panel text-ide-muted no-drag hover:border-ide-faint hover:text-ide-fg"
      >
        <Search className="size-3.5" />
        <span className="truncate">Search passwords and commands</span>
        <span className="text-ide-faint">{MOD}K</span>
      </button>
    </header>
  )
}

function ActivityBar(): React.JSX.Element {
  const { data: entries } = useQuery(queries.entries())
  const problems = entries?.filter((e) => e.hasPassword && (e.score <= 2 || e.reused)).length ?? 0

  const item = (
    to: NavTarget,
    label: string,
    Icon: LucideIcon,
    badge?: number
  ): React.JSX.Element => (
    <Link
      key={to}
      to={to}
      title={label}
      activeOptions={{ exact: to === '/', includeSearch: false }}
      className="group relative flex h-12 w-full items-center justify-center text-ide-faint hover:text-ide-fg data-[status=active]:text-ide-bright"
    >
      <span className="absolute inset-y-2.5 left-0 w-0.5 bg-ide-accent opacity-0 group-data-[status=active]:opacity-100" />
      <Icon className="size-6" strokeWidth={1.5} />
      {badge ? (
        <span className="absolute right-2 bottom-2 min-w-4 rounded-full bg-ide-button px-1 text-center text-[10px] leading-4 text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </Link>
  )

  return (
    <nav className="flex w-12 shrink-0 flex-col items-center border-r border-ide-border bg-ide-chrome">
      {ACTIVITY.map(({ to, label, icon }) =>
        item(to, label, icon, to === '/' ? problems : undefined)
      )}
      <div className="mt-auto w-full">
        <button
          onClick={lock}
          title={`Lock vault (${MOD}L)`}
          className="flex h-12 w-full items-center justify-center text-ide-faint hover:text-ide-fg"
        >
          <LockKeyhole className="size-6" strokeWidth={1.5} />
        </button>
        {item('/settings', 'Settings', Settings)}
      </div>
    </nav>
  )
}

function StatusBar(): React.JSX.Element {
  const { data: entries = [] } = useQuery(queries.entries())
  const { data: settings } = useQuery(queries.settings())
  const { data: sync } = useQuery(queries.syncStatus())
  const weak = entries.filter((e) => e.hasPassword && e.score <= 2).length
  const reused = entries.filter((e) => e.reused).length
  const peers = settings?.sync.peers ?? []
  const lastSync = Math.max(0, ...peers.map((p) => p.lastSyncAt ?? 0))
  const failing = peers.some((p) => p.lastError)

  const itemClass = 'flex h-full items-center gap-1 px-2 hover:bg-white/10'

  return (
    <footer className="flex h-6 shrink-0 items-center justify-between bg-ide-status text-[11px] text-white/90">
      <div className="flex h-full items-center">
        <button onClick={lock} className={cn(itemClass, 'bg-white/10 px-3')} title="Lock vault">
          <LockOpen className="size-3" />
          vault
        </button>
        <Link to="/sync" className={itemClass} title="Sync">
          <RefreshCw className={cn('size-3', sync?.syncing && 'animate-spin')} />
          {peers.length === 0
            ? 'sync: off'
            : `${peers.length} remote${peers.length === 1 ? '' : 's'}${lastSync ? ` · ${timeAgo(lastSync)}` : ''}`}
          {failing && <span className="text-syn-type">!</span>}
        </Link>
        <Link to="/" className={itemClass} title="Problems">
          <XCircle className="size-3" />
          {weak}
          <AlertTriangle className="ml-1 size-3" />
          {reused}
        </Link>
        {sync?.pairing && (
          <Link to="/sync" className={cn(itemClass, 'bg-syn-type/30')}>
            pairing: {sync.pairing.code}
          </Link>
        )}
      </div>
      <div className="flex h-full items-center">
        <span className={itemClass}>{entries.length} credentials</span>
        <span className={itemClass}>AES-256-GCM</span>
        {sync?.serverRunning && <span className={itemClass}>:{settings?.sync.port}</span>}
        <span className={itemClass}>
          <Monitor className="size-3" />
          {settings?.deviceName}
        </span>
        <button onClick={() => openPalette('>')} className={itemClass}>
          {MOD}⇧P
        </button>
      </div>
    </footer>
  )
}
