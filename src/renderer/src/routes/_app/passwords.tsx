import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  FileKey2,
  FilePlus2,
  Folder,
  FolderOpen,
  Search,
  ShieldCheck,
  Star,
  X
} from 'lucide-react'
import type { EntrySummary } from '@shared/types'
import { queries } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { hostOf, identifier } from '@renderer/lib/format'
import { MOD, SHIFT, isMod } from '@renderer/lib/keys'
import { closeTab, openPalette, openTab, pruneTabs, tabsStore } from '@renderer/lib/workspace'
import { Button, Input, Kbd, PanelHeader } from '@renderer/components/ui'
import { EntryView } from '@renderer/components/EntryView'
import { EntryEditor } from '@renderer/components/EntryEditor'

const FILTERS = ['all', 'favorites', 'weak', 'reused', 'old'] as const
type Filter = (typeof FILTERS)[number]

interface PasswordsSearch {
  q?: string
  id?: string
  filter?: Filter
  edit?: boolean
  generate?: boolean
}

export const Route = createFileRoute('/_app/passwords')({
  validateSearch: (search: Record<string, unknown>): PasswordsSearch => ({
    q: typeof search.q === 'string' && search.q ? search.q : undefined,
    id: typeof search.id === 'string' ? search.id : undefined,
    filter: FILTERS.includes(search.filter as Filter) ? (search.filter as Filter) : undefined,
    edit: search.edit === true ? true : undefined,
    generate: search.generate === true ? true : undefined
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(queries.entries()),
  component: PasswordsPage
})

function matches(entry: EntrySummary, terms: string[]): boolean {
  const haystack = [entry.title, entry.username, entry.url, entry.folder].join(' ').toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

function decoration(entry: EntrySummary): { letter: string; color: string } | null {
  if (entry.hasPassword && entry.score <= 2) return { letter: 'W', color: 'text-syn-prop' }
  if (entry.reused) return { letter: 'R', color: 'text-syn-type' }
  if (entry.old) return { letter: 'O', color: 'text-ide-accent' }
  return null
}

function PasswordsPage(): React.JSX.Element {
  const { q = '', id, filter = 'all', edit, generate } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { data: entries } = useSuspenseQuery(queries.entries())
  const tabs = tabsStore.use()
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries])

  // Open a tab when the selection changes. Reading byId from an effect event keeps a refetch of
  // the entry list (e.g. right after saving a new entry) from resurrecting a closed "new" tab.
  const openSelected = useEffectEvent((selected: string) => {
    if (selected === 'new' || byId.has(selected)) openTab(selected)
  })
  useEffect(() => {
    if (id) openSelected(id)
  }, [id])
  // Drop tabs for deleted entries (including deletions that arrive via sync)
  useEffect(() => {
    pruneTabs(new Set(byId.keys()))
  }, [byId])

  const select = (next: Partial<PasswordsSearch>): void => {
    void navigate({
      search: (prev) => ({ ...prev, edit: undefined, generate: undefined, ...next }),
      replace: true
    })
  }

  const close = (tab: string): void => {
    select({ id: closeTab(tab, id) })
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (isMod(e) && e.key.toLowerCase() === 'e' && !e.shiftKey && id && id !== 'new' && !edit) {
        e.preventDefault()
        void navigate({ search: (prev) => ({ ...prev, edit: true }), replace: true })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const filtered = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
    return entries
      .filter((e) => {
        if (filter === 'favorites') return e.favorite
        if (filter === 'weak') return e.hasPassword && e.score <= 2
        if (filter === 'reused') return e.reused
        if (filter === 'old') return e.old
        return true
      })
      .filter((e) => matches(e, terms))
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
  }, [entries, q, filter])

  const activeEntry = id && id !== 'new' ? byId.get(id) : undefined

  return (
    <div className="flex h-full">
      <Explorer
        entries={filtered}
        total={entries.length}
        q={q}
        filter={filter}
        activeId={id}
        onSearch={(value) => select({ q: value || undefined, id })}
        onFilter={(f) => select({ filter: f === 'all' ? undefined : f, id })}
        onSelect={(entryId) => select({ id: entryId })}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {tabs.length > 0 && (
          <div className="flex h-9 shrink-0 overflow-x-auto border-b border-ide-border bg-ide-panel">
            {tabs.map((tab) => {
              const entry = byId.get(tab)
              const label =
                tab === 'new' ? 'untitled.ts' : entry ? `${identifier(entry.title)}.ts` : tab
              const deco = entry && decoration(entry)
              const active = tab === id
              return (
                <div
                  key={tab}
                  onClick={() => select({ id: tab })}
                  onMouseDown={(e) => e.button === 1 && (e.preventDefault(), close(tab))}
                  className={cn(
                    'group relative flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-ide-border pr-1.5 pl-3 text-xs',
                    active ? 'bg-ide-bg text-ide-bright' : 'text-ide-muted hover:bg-ide-hover'
                  )}
                >
                  {active && <span className="absolute inset-x-0 top-0 h-px bg-ide-accent" />}
                  <FileKey2 className={cn('size-3.5', deco?.color ?? 'text-syn-type')} />
                  <span
                    className={cn(
                      deco && deco.letter !== 'O' && deco.color,
                      tab === 'new' && 'italic'
                    )}
                  >
                    {label}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      close(tab)
                    }}
                    className={cn(
                      'flex size-5 items-center justify-center rounded-sm hover:bg-ide-sel',
                      !active && 'opacity-0 group-hover:opacity-100'
                    )}
                    aria-label={`Close ${label}`}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        <div className="min-h-0 flex-1">
          {id === 'new' ? (
            <EntryEditor
              key="new"
              onSaved={(entry) => {
                tabsStore.set((t) => t.map((x) => (x === 'new' ? entry.id : x)))
                select({ id: entry.id })
              }}
              onCancel={() => close('new')}
            />
          ) : activeEntry && edit ? (
            <EntryEditorLoader
              key={`${activeEntry.id}-edit`}
              id={activeEntry.id}
              autoGenerate={generate}
              onDone={() => select({ id: activeEntry.id })}
            />
          ) : activeEntry ? (
            <EntryView
              key={activeEntry.id}
              id={activeEntry.id}
              onEdit={(options) =>
                void navigate({
                  search: (prev) => ({
                    ...prev,
                    edit: true,
                    generate: options?.generate || undefined
                  }),
                  replace: true
                })
              }
              onDeleted={() => close(activeEntry.id)}
            />
          ) : (
            <Welcome hasEntries={entries.length > 0} onNew={() => select({ id: 'new' })} />
          )}
        </div>
      </div>
    </div>
  )
}

function EntryEditorLoader({
  id,
  autoGenerate,
  onDone
}: {
  id: string
  autoGenerate?: boolean
  onDone: () => void
}): React.JSX.Element | null {
  const { data: entry } = useSuspenseQuery(queries.entry(id))
  return (
    <EntryEditor entry={entry} autoGenerate={autoGenerate} onSaved={onDone} onCancel={onDone} />
  )
}

function Explorer({
  entries,
  total,
  q,
  filter,
  activeId,
  onSearch,
  onFilter,
  onSelect
}: {
  entries: EntrySummary[]
  total: number
  q: string
  filter: Filter
  activeId?: string
  onSearch: (value: string) => void
  onFilter: (filter: Filter) => void
  onSelect: (id: string) => void
}): React.JSX.Element {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const flat = q.length > 0 || filter !== 'all'

  const groups = useMemo(() => {
    const folders = new Map<string, EntrySummary[]>()
    const root: EntrySummary[] = []
    for (const e of entries) {
      if (e.folder) folders.set(e.folder, [...(folders.get(e.folder) ?? []), e])
      else root.push(e)
    }
    return {
      favorites: entries.filter((e) => e.favorite),
      folders: [...folders.entries()].sort(([a], [b]) => a.localeCompare(b)),
      root
    }
  }, [entries])

  const toggle = (key: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const item = (entry: EntrySummary, depth: number, keyPrefix = ''): React.JSX.Element => {
    const deco = decoration(entry)
    return (
      <button
        key={keyPrefix + entry.id}
        onClick={() => onSelect(entry.id)}
        title={[entry.username, hostOf(entry.url)].filter(Boolean).join(' · ')}
        className={cn(
          'flex h-[22px] w-full items-center gap-1.5 pr-2 text-left',
          activeId === entry.id
            ? 'bg-ide-sel text-ide-bright outline outline-1 -outline-offset-1 outline-ide-accent/50'
            : 'hover:bg-ide-hover'
        )}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        <FileKey2 className={cn('size-3.5 shrink-0', deco?.color ?? 'text-syn-type')} />
        <span className={cn('truncate', deco && deco.letter !== 'O' && deco.color)}>
          {entry.title}
        </span>
        {flat && entry.username && (
          <span className="truncate text-[11px] text-ide-faint">{entry.username}</span>
        )}
        {deco && <span className={cn('ml-auto pl-1 text-[11px]', deco.color)}>{deco.letter}</span>}
      </button>
    )
  }

  const folder = (
    key: string,
    label: string,
    children: EntrySummary[],
    icon?: 'star'
  ): React.JSX.Element => {
    const isCollapsed = collapsed.has(key)
    const Chevron = isCollapsed ? ChevronRight : ChevronDown
    const Icon = icon === 'star' ? Star : isCollapsed ? Folder : FolderOpen
    return (
      <div key={key}>
        <button
          onClick={() => toggle(key)}
          className="flex h-[22px] w-full items-center gap-1 pr-2 pl-1 text-left hover:bg-ide-hover"
        >
          <Chevron className="size-3.5 shrink-0 text-ide-muted" />
          <Icon
            className={cn('size-3.5 shrink-0', icon === 'star' ? 'text-syn-type' : 'text-syn-fn')}
          />
          <span className="truncate">{label}</span>
          <span className="ml-auto text-[11px] text-ide-faint">{children.length}</span>
        </button>
        {!isCollapsed && children.map((e) => item(e, 1, `${key}:`))}
      </div>
    )
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-ide-border bg-ide-panel">
      <PanelHeader
        title="Explorer"
        actions={
          <>
            <Button
              size="icon"
              variant="ghost"
              title={`New password (${MOD}N)`}
              onClick={() => onSelect('new')}
            >
              <FilePlus2 className="size-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              title="Collapse folders"
              onClick={() => setCollapsed(new Set(['__fav', ...groups.folders.map(([f]) => f)]))}
            >
              <ChevronsDownUp className="size-3.5" />
            </Button>
          </>
        }
      />
      <div className="space-y-1.5 px-2 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-ide-faint" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={`Filter ${total} credentials`}
            className="pl-7"
          />
        </div>
        <div className="flex gap-0.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => onFilter(f)}
              className={cn(
                'rounded-sm px-1.5 py-0.5 text-[11px]',
                filter === f ? 'bg-ide-sel text-ide-bright' : 'text-ide-muted hover:bg-ide-hover'
              )}
            >
              {f === 'favorites' ? 'fav' : f}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <div className="flex h-[22px] items-center px-2 text-[11px] font-semibold tracking-wider text-ide-muted uppercase">
          Vault
        </div>
        {flat ? (
          entries.map((e) => item(e, 0))
        ) : (
          <>
            {groups.favorites.length > 0 && folder('__fav', 'favorites', groups.favorites, 'star')}
            {groups.folders.map(([name, children]) => folder(name, name, children))}
            {groups.root.map((e) => item(e, 0))}
          </>
        )}
        {entries.length === 0 && (
          <p className="px-3 py-2 text-xs text-ide-faint">
            {total === 0 ? 'No credentials yet.' : 'No matches.'}
          </p>
        )}
      </div>
    </aside>
  )
}

function Welcome({
  hasEntries,
  onNew
}: {
  hasEntries: boolean
  onNew: () => void
}): React.JSX.Element {
  const shortcuts: [string, string, () => void][] = [
    ['Go to Password', `${MOD}P`, () => openPalette('')],
    ['Show All Commands', `${MOD}${SHIFT}P`, () => openPalette('>')],
    ['New Password', `${MOD}N`, onNew],
    ['Lock Vault', `${MOD}L`, () => openPalette('>lock')]
  ]
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 text-ide-muted">
      <ShieldCheck className="size-28 text-ide-hover" strokeWidth={1} />
      <table className="text-xs">
        <tbody>
          {shortcuts.map(([label, keys, run]) => (
            <tr key={label} className="cursor-pointer hover:text-ide-fg" onClick={run}>
              <td className="py-1 pr-6 text-right">{label}</td>
              <td className="py-1">
                <Kbd>{keys}</Kbd>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!hasEntries && (
        <p className="text-xs text-syn-comment">
          {'// your vault is empty — create a password or import one from Settings'}
        </p>
      )}
    </div>
  )
}
