import { useEffect, useMemo, type ReactNode } from 'react'
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
  Activity,
  ArrowLeftRight,
  Folder,
  Lock,
  Search,
  Settings,
  Sparkles,
  Star,
  Vault,
  type LucideIcon
} from 'lucide-react'
import { ENTRY_TYPES } from '@shared/types'
import { ENTRY_TYPE_LABELS } from '@shared/entries'
import { api, queries } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { timeAgo } from '@renderer/lib/format'
import { MOD, SHIFT, isMac, isMod } from '@renderer/lib/keys'
import { toastError } from '@renderer/lib/toast'
import { openPalette } from '@renderer/lib/workspace'
import { CommandPalette } from '@renderer/components/CommandPalette'
import { TYPE_ICONS } from '@renderer/lib/entry-types'
import { UpdateButton } from '@renderer/components/UpdateButton'
import { PendingKeyBanner } from '@renderer/components/PendingKeyBanner'
import { Eyebrow, Kbd, LogoMark } from '@renderer/components/ui'

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context }) => {
    const status = await context.queryClient.fetchQuery(queries.status())
    if (status.state !== 'unlocked') throw redirect({ to: '/unlock' })
  },
  component: AppLayout
})

type NavTarget = '/' | '/passwords' | '/generator' | '/sync' | '/settings'

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
    <div className="flex h-screen">
      <Sidebar />
      <main
        id="main"
        className="my-2 mr-2 min-w-0 flex-1 overflow-y-auto rounded-(--radius-panel) border border-line bg-panel shadow-xl shadow-black/30"
      >
        <PendingKeyBanner />
        <Outlet />
      </main>
      <CommandPalette />
    </div>
  )
}

function NavItem({
  to,
  search,
  icon: Icon,
  label,
  active,
  trailing
}: {
  to: NavTarget
  search?: Record<string, unknown>
  icon: LucideIcon
  label: string
  active: boolean
  trailing?: ReactNode
}): React.JSX.Element {
  return (
    <Link
      to={to}
      search={search}
      className={cn(
        'group flex h-8 items-center gap-2.5 rounded-lg px-2.5 transition-colors',
        active ? 'bg-sel text-bright' : 'text-muted hover:bg-hover hover:text-fg'
      )}
    >
      <Icon
        className={cn(
          'size-4 shrink-0',
          active ? 'text-accent' : 'text-faint group-hover:text-muted'
        )}
        strokeWidth={2}
      />
      <span className="truncate">{label}</span>
      {trailing && <span className="ml-auto flex items-center">{trailing}</span>}
    </Link>
  )
}

function Count({ children, tone }: { children: ReactNode; tone?: 'danger' }): React.JSX.Element {
  return (
    <span
      className={cn(
        'min-w-5 rounded-full px-1.5 text-center text-[11px] leading-[18px] tabular-nums',
        tone === 'danger' ? 'bg-danger/15 text-danger' : 'text-faint'
      )}
    >
      {children}
    </span>
  )
}

function Sidebar(): React.JSX.Element {
  const location = useRouterState({ select: (s) => s.location })
  const { data: entries = [] } = useQuery(queries.entries())
  const { data: settings } = useQuery(queries.settings())
  const { data: sync } = useQuery(queries.syncStatus())

  const path = location.pathname
  const search = location.search as { folder?: string; favorites?: boolean; type?: string }
  const issues = entries.filter((e) => e.hasPassword && (e.score <= 2 || e.reused)).length
  const favorites = entries.filter((e) => e.favorite).length
  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of entries) counts.set(e.type, (counts.get(e.type) ?? 0) + 1)
    return counts
  }, [entries])
  const folders = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of entries) if (e.folder) counts.set(e.folder, (counts.get(e.folder) ?? 0) + 1)
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [entries])

  const peers = settings?.sync.peers ?? []
  const lastSync = Math.max(0, ...peers.map((p) => p.lastSyncAt ?? 0))
  const failing = peers.some((p) => p.lastError)
  const onVault = path === '/passwords'
  const scoped = Boolean(search.folder || search.favorites || search.type)

  return (
    <aside className="flex w-60 shrink-0 flex-col">
      <div className={cn('flex h-12 shrink-0 items-center drag', isMac ? 'pl-[84px]' : 'pl-4')}>
        {!isMac && <LogoMark />}
      </div>

      <div className="flex items-center gap-2.5 px-4 pb-4">
        {isMac && <LogoMark />}
        <div className="min-w-0 leading-tight">
          <p className="truncate font-semibold text-bright">Password Manager</p>
          <p className="truncate text-[11px] text-faint">
            {settings?.deviceName ?? 'this device'} · unlocked
          </p>
        </div>
      </div>

      <div className="px-3 pb-3">
        <button
          onClick={() => openPalette('')}
          className="flex h-8 w-full items-center gap-2 rounded-lg bg-panel px-2.5 text-muted ring-1 ring-line transition-colors ring-inset hover:text-fg hover:ring-line-strong"
        >
          <Search className="size-3.5" />
          <span>Search</span>
          <Kbd className="ml-auto">{MOD}K</Kbd>
        </button>
      </div>

      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3">
        <NavItem
          to="/passwords"
          icon={Vault}
          label="Vault"
          active={onVault && !scoped}
          trailing={<Count>{entries.length}</Count>}
        />
        <NavItem
          to="/"
          icon={Activity}
          label="Health"
          active={path === '/'}
          trailing={issues > 0 ? <Count tone="danger">{issues}</Count> : undefined}
        />
        <NavItem to="/generator" icon={Sparkles} label="Generator" active={path === '/generator'} />
        <NavItem
          to="/sync"
          icon={ArrowLeftRight}
          label="Sync"
          active={path === '/sync'}
          trailing={
            peers.length > 0 ? (
              <span
                className={cn(
                  'mr-1.5 size-1.5 rounded-full',
                  failing ? 'bg-danger' : sync?.syncing ? 'animate-pulse bg-accent' : 'bg-ok'
                )}
              />
            ) : undefined
          }
        />

        <Eyebrow className="px-2.5 pt-5 pb-1.5">Categories</Eyebrow>
        {ENTRY_TYPES.map((type) => (
          <NavItem
            key={type}
            to="/passwords"
            search={{ type }}
            icon={TYPE_ICONS[type]}
            label={ENTRY_TYPE_LABELS[type].many}
            active={onVault && search.type === type}
            trailing={typeCounts.get(type) ? <Count>{typeCounts.get(type)}</Count> : undefined}
          />
        ))}

        {(favorites > 0 || folders.length > 0) && (
          <>
            <Eyebrow className="px-2.5 pt-5 pb-1.5">Collections</Eyebrow>
            {favorites > 0 && (
              <NavItem
                to="/passwords"
                search={{ favorites: true }}
                icon={Star}
                label="Favorites"
                active={onVault && search.favorites === true}
                trailing={<Count>{favorites}</Count>}
              />
            )}
            {folders.map(([name, count]) => (
              <NavItem
                key={name}
                to="/passwords"
                search={{ folder: name }}
                icon={Folder}
                label={name}
                active={onVault && search.folder === name}
                trailing={<Count>{count}</Count>}
              />
            ))}
          </>
        )}
      </nav>

      <div className="space-y-2 p-3">
        <UpdateButton className="w-full" />
        {sync?.pairing && (
          <Link
            to="/sync"
            className="flex h-8 items-center gap-2 rounded-lg bg-warn/10 px-2.5 text-xs text-warn ring-1 ring-warn/25 ring-inset"
          >
            Pairing open · <span className="font-mono">{sync.pairing.code}</span>
          </Link>
        )}
        <Link
          to="/sync"
          className="block rounded-lg px-2.5 py-1.5 text-[11px] text-faint hover:bg-hover hover:text-muted"
        >
          {peers.length === 0
            ? 'Sync is off'
            : `${peers.length} device${peers.length === 1 ? '' : 's'}${lastSync ? ` · synced ${timeAgo(lastSync)}` : ''}`}
          {failing && <span className="text-danger"> · error</span>}
        </Link>
        <div className="flex gap-1">
          <button
            onClick={lock}
            title={`Lock vault (${MOD}L)`}
            className="flex h-8 flex-1 items-center gap-2 rounded-lg px-2.5 text-muted transition-colors hover:bg-hover hover:text-bright"
          >
            <Lock className="size-4 text-faint" />
            Lock
            <Kbd className="ml-auto">{MOD}L</Kbd>
          </button>
          <Link
            to="/settings"
            title={`Settings (${MOD},)`}
            className={cn(
              'flex size-8 items-center justify-center rounded-lg transition-colors',
              path === '/settings'
                ? 'bg-sel text-accent'
                : 'text-faint hover:bg-hover hover:text-bright'
            )}
          >
            <Settings className="size-4" />
          </Link>
        </div>
        <p className="px-2.5 text-[10px] text-faint/70">
          {MOD}
          {SHIFT}P commands
        </p>
      </div>
    </aside>
  )
}
