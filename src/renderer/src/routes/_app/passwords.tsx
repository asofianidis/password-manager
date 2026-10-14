import { useEffect, useMemo, useRef } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Folder, KeyRound, Plus, Search, Star, X } from 'lucide-react'
import type { EntrySummary } from '@shared/types'
import { queries } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { hostOf } from '@renderer/lib/format'
import { MOD, SHIFT, isMod } from '@renderer/lib/keys'
import { openPalette } from '@renderer/lib/workspace'
import { Button, Kbd, Monogram, Segmented } from '@renderer/components/ui'
import { EntryView } from '@renderer/components/EntryView'
import { EntryEditor } from '@renderer/components/EntryEditor'

const FILTERS = ['all', 'weak', 'reused', 'old'] as const
type Filter = (typeof FILTERS)[number]

interface PasswordsSearch {
  q?: string
  id?: string
  filter?: Filter
  folder?: string
  favorites?: boolean
  edit?: boolean
  generate?: boolean
}

export const Route = createFileRoute('/_app/passwords')({
  validateSearch: (search: Record<string, unknown>): PasswordsSearch => ({
    q: typeof search.q === 'string' && search.q ? search.q : undefined,
    id: typeof search.id === 'string' ? search.id : undefined,
    filter: FILTERS.includes(search.filter as Filter) ? (search.filter as Filter) : undefined,
    folder: typeof search.folder === 'string' && search.folder ? search.folder : undefined,
    favorites: search.favorites === true ? true : undefined,
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

const FILTER_TEST: Record<Filter, (e: EntrySummary) => boolean> = {
  all: () => true,
  weak: (e) => e.hasPassword && e.score <= 2,
  reused: (e) => e.reused,
  old: (e) => e.old
}

function PasswordsPage(): React.JSX.Element {
  const { q = '', id, filter = 'all', folder, favorites, edit, generate } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { data: entries } = useSuspenseQuery(queries.entries())
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries])

  const select = (next: Partial<PasswordsSearch>): void => {
    void navigate({
      search: (prev) => ({ ...prev, edit: undefined, generate: undefined, ...next }),
      replace: true
    })
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

  // Entries in the current scope (folder or favorites) before the search and health filters
  const scoped = useMemo(
    () => entries.filter((e) => (!folder || e.folder === folder) && (!favorites || e.favorite)),
    [entries, folder, favorites]
  )

  const filtered = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
    return scoped
      .filter(FILTER_TEST[filter])
      .filter((e) => matches(e, terms))
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
  }, [scoped, q, filter])

  const activeEntry = id && id !== 'new' ? byId.get(id) : undefined
  const title = folder ?? (favorites ? 'Favorites' : 'Vault')

  return (
    <div className="flex h-full">
      <EntryList
        title={title}
        icon={folder ? Folder : favorites ? Star : KeyRound}
        entries={filtered}
        scoped={scoped}
        q={q}
        filter={filter}
        activeId={id}
        onSearch={(value) => select({ q: value || undefined, id })}
        onFilter={(f) => select({ filter: f === 'all' ? undefined : f, id })}
        onSelect={(entryId) => select({ id: entryId })}
      />

      <div className="min-w-0 flex-1">
        {id === 'new' ? (
          <EntryEditor
            key="new"
            defaultFolder={folder}
            onSaved={(entry) => select({ id: entry.id })}
            onCancel={() => select({ id: undefined })}
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
            onDeleted={() => select({ id: undefined })}
          />
        ) : (
          <Welcome hasEntries={entries.length > 0} onNew={() => select({ id: 'new' })} />
        )}
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

function EntryList({
  title,
  icon: Icon,
  entries,
  scoped,
  q,
  filter,
  activeId,
  onSearch,
  onFilter,
  onSelect
}: {
  title: string
  icon: typeof KeyRound
  entries: EntrySummary[]
  scoped: EntrySummary[]
  q: string
  filter: Filter
  activeId?: string
  onSearch: (value: string) => void
  onFilter: (filter: Filter) => void
  onSelect: (id: string) => void
}): React.JSX.Element {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-id="${CSS.escape(activeId ?? '')}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  // Group alphabetically by first letter, like a contacts list
  const groups = useMemo(() => {
    const map = new Map<string, EntrySummary[]>()
    for (const e of entries) {
      const first = e.title.trim()[0]?.toUpperCase() ?? '#'
      const key = /[A-Z]/.test(first) ? first : '#'
      map.set(key, [...(map.get(key) ?? []), e])
    }
    return [...map.entries()]
  }, [entries])

  const count = (f: Filter): number => scoped.filter(FILTER_TEST[f]).length
  const filterOptions = FILTERS.map((f) => ({
    value: f,
    label: f[0].toUpperCase() + f.slice(1),
    count: f === 'all' ? undefined : count(f)
  }))

  const move = (delta: number): void => {
    if (entries.length === 0) return
    const index = entries.findIndex((e) => e.id === activeId)
    const next = index < 0 ? (delta > 0 ? 0 : entries.length - 1) : index + delta
    onSelect(entries[Math.max(0, Math.min(entries.length - 1, next))].id)
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-r border-line">
      <div className="space-y-3 px-4 pt-5 pb-3">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-accent" />
          <h1 className="truncate text-[15px] font-semibold text-bright">{title}</h1>
          <span className="text-xs text-faint tabular-nums">{scoped.length}</span>
          <Button
            size="sm"
            variant="primary"
            className="ml-auto"
            title={`New password (${MOD}N)`}
            onClick={() => onSelect('new')}
          >
            <Plus className="size-3.5" strokeWidth={2.5} />
            New
          </Button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-faint" />
          <input
            autoFocus
            value={q}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                move(1)
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                move(-1)
              } else if (e.key === 'Escape' && q) {
                e.preventDefault()
                onSearch('')
              }
            }}
            placeholder="Filter by name, user or site"
            spellCheck={false}
            className="h-8 w-full rounded-lg bg-canvas pr-8 pl-8 text-[13px] text-bright ring-1 ring-line-strong ring-inset placeholder:text-faint focus:ring-accent/50 focus:outline-none"
          />
          {q ? (
            <button
              onClick={() => onSearch('')}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-faint hover:text-bright"
              aria-label="Clear filter"
            >
              <X className="size-3.5" />
            </button>
          ) : (
            <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[10px] text-faint">
              ↑↓
            </span>
          )}
        </div>
        <Segmented
          className="w-full [&>button]:flex-1 [&>button]:justify-center"
          value={filter}
          options={filterOptions}
          onChange={onFilter}
        />
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {groups.map(([letter, items]) => (
          <div key={letter}>
            <div className="sticky top-0 z-10 bg-panel/95 px-2.5 pt-2 pb-1 text-[11px] font-medium text-faint backdrop-blur">
              {letter}
            </div>
            {items.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                active={entry.id === activeId}
                onClick={() => onSelect(entry.id)}
              />
            ))}
          </div>
        ))}
        {entries.length === 0 && (
          <p className="px-3 py-8 text-center text-xs text-muted">
            {scoped.length === 0 ? 'Nothing here yet.' : 'No matches.'}
          </p>
        )}
      </div>
    </aside>
  )
}

function EntryRow({
  entry,
  active,
  onClick
}: {
  entry: EntrySummary
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  const weak = entry.hasPassword && entry.score <= 2
  const detail = entry.username || hostOf(entry.url)
  return (
    <button
      data-id={entry.id}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
        active ? 'bg-sel' : 'hover:bg-hover'
      )}
    >
      <Monogram title={entry.title} url={entry.url} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={cn('truncate', active ? 'text-bright' : 'text-fg')}>{entry.title}</span>
          {entry.favorite && <Star className="size-3 shrink-0 fill-warn text-warn" />}
        </span>
        {detail && <span className="block truncate text-xs text-faint">{detail}</span>}
      </span>
      {(weak || entry.reused) && (
        <span
          title={weak ? 'Weak password' : 'Reused password'}
          className={cn('size-1.5 shrink-0 rounded-full', weak ? 'bg-danger' : 'bg-warn')}
        />
      )}
    </button>
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
    ['Search everything', `${MOD}K`, () => openPalette('')],
    ['Run a command', `${MOD}${SHIFT}P`, () => openPalette('>')],
    ['New password', `${MOD}N`, onNew],
    ['Lock vault', `${MOD}L`, () => openPalette('>lock')]
  ]
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 bg-dots">
      <div className="text-center">
        <p className="text-[15px] font-medium text-bright">
          {hasEntries ? 'Select a password' : 'Your vault is empty'}
        </p>
        <p className="mt-1 text-xs text-muted">
          {hasEntries
            ? 'Or use the keyboard to get around.'
            : 'Create a password, or import one from Settings.'}
        </p>
      </div>
      <div className="w-72 overflow-hidden rounded-xl border border-line bg-raised/80">
        {shortcuts.map(([label, keys, run]) => (
          <button
            key={label}
            onClick={run}
            className="flex w-full items-center justify-between border-b border-line px-4 py-2.5 text-left text-muted last:border-0 hover:bg-hover hover:text-bright"
          >
            {label}
            <Kbd>{keys}</Kbd>
          </button>
        ))}
      </div>
    </div>
  )
}
