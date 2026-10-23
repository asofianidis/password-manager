import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { ChevronDown, Folder, Paperclip, Plus, Search, Star, Vault, X } from 'lucide-react'
import { ENTRY_TYPES, type EntrySummary, type EntryType } from '@shared/types'
import { ENTRY_TYPE_LABELS } from '@shared/entries'
import { queries } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { hostOf } from '@renderer/lib/format'
import { MOD, SHIFT, isMod } from '@renderer/lib/keys'
import { openPalette } from '@renderer/lib/workspace'
import { Button, Kbd, Segmented } from '@renderer/components/ui'
import { EntryView } from '@renderer/components/EntryView'
import { EntryEditor } from '@renderer/components/EntryEditor'
import { EntryIcon } from '@renderer/components/EntryIcon'
import { TYPE_ICONS } from '@renderer/lib/entry-types'

const FILTERS = ['all', 'weak', 'reused', 'old'] as const
type Filter = (typeof FILTERS)[number]

interface PasswordsSearch {
  q?: string
  id?: string
  /** Show only entries of this type */
  type?: EntryType
  /** What to create when id is 'new' */
  create?: EntryType
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
    type: ENTRY_TYPES.includes(search.type as EntryType) ? (search.type as EntryType) : undefined,
    create: ENTRY_TYPES.includes(search.create as EntryType)
      ? (search.create as EntryType)
      : undefined,
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
  const haystack = [entry.title, entry.username, entry.detail, entry.url, entry.folder]
    .join(' ')
    .toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

const FILTER_TEST: Record<Filter, (e: EntrySummary) => boolean> = {
  all: () => true,
  weak: (e) => e.hasPassword && e.score <= 2,
  reused: (e) => e.reused,
  old: (e) => e.old
}

function PasswordsPage(): React.JSX.Element {
  const search = Route.useSearch()
  const { q = '', id, type, create, folder, favorites, edit, generate } = search
  // Password health filters only mean something for logins
  const healthFilters = !type || type === 'login'
  const filter = healthFilters ? (search.filter ?? 'all') : 'all'
  const navigate = useNavigate({ from: Route.fullPath })
  const { data: entries } = useSuspenseQuery(queries.entries())
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries])

  const select = (next: Partial<PasswordsSearch>): void => {
    void navigate({
      search: (prev) => ({
        ...prev,
        edit: undefined,
        generate: undefined,
        create: undefined,
        ...next
      }),
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

  // Entries in the current scope (type, folder, or favorites) before the search and health filters
  const scoped = useMemo(
    () =>
      entries.filter(
        (e) =>
          (!type || e.type === type) &&
          (!folder || e.folder === folder) &&
          (!favorites || e.favorite)
      ),
    [entries, type, folder, favorites]
  )

  const filtered = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
    return scoped
      .filter(FILTER_TEST[filter])
      .filter((e) => matches(e, terms))
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
  }, [scoped, q, filter])

  const activeEntry = id && id !== 'new' ? byId.get(id) : undefined
  const title = folder ?? (favorites ? 'Favorites' : type ? ENTRY_TYPE_LABELS[type].many : 'Vault')
  const newType = create ?? type ?? 'login'

  return (
    <div className="flex h-full">
      <EntryList
        title={title}
        icon={folder ? Folder : favorites ? Star : type ? TYPE_ICONS[type] : Vault}
        entries={filtered}
        scoped={scoped}
        q={q}
        filter={filter}
        healthFilters={healthFilters}
        type={type}
        activeId={id}
        onSearch={(value) => select({ q: value || undefined, id })}
        onFilter={(f) => select({ filter: f === 'all' ? undefined : f, id })}
        onSelect={(entryId) => select({ id: entryId })}
        onNew={(t) => select({ id: 'new', create: t })}
      />

      <div className="min-w-0 flex-1">
        {id === 'new' ? (
          <EntryEditor
            key={`new-${newType}`}
            type={newType}
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
          <Welcome
            hasEntries={scoped.length > 0}
            type={type}
            onNew={() => select({ id: 'new', create: type })}
          />
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
  healthFilters,
  type,
  activeId,
  onSearch,
  onFilter,
  onSelect,
  onNew
}: {
  title: string
  icon: typeof Vault
  entries: EntrySummary[]
  scoped: EntrySummary[]
  q: string
  filter: Filter
  healthFilters: boolean
  type?: EntryType
  activeId?: string
  onSearch: (value: string) => void
  onFilter: (filter: Filter) => void
  onSelect: (id: string) => void
  onNew: (type?: EntryType) => void
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
          <NewButton type={type} onNew={onNew} />
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
            placeholder={type && type !== 'login' ? 'Filter' : 'Filter by name, user or site'}
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
        {healthFilters && (
          <Segmented
            className="w-full [&>button]:flex-1 [&>button]:justify-center"
            value={filter}
            options={filterOptions}
            onChange={onFilter}
          />
        )}
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
  const detail = entry.detail || hostOf(entry.url)
  return (
    <button
      data-id={entry.id}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
        active ? 'bg-sel' : 'hover:bg-hover'
      )}
    >
      <EntryIcon type={entry.type} title={entry.title} url={entry.url} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={cn('truncate', active ? 'text-bright' : 'text-fg')}>{entry.title}</span>
          {entry.favorite && <Star className="size-3 shrink-0 fill-warn text-warn" />}
          {entry.attachments > 0 && <Paperclip className="size-3 shrink-0 text-faint" />}
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

/** Creates an entry of the list's type, or offers a choice of type in the whole vault. */
function NewButton({
  type,
  onNew
}: {
  type?: EntryType
  onNew: (type?: EntryType) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  if (type) {
    return (
      <Button
        size="sm"
        variant="primary"
        className="ml-auto"
        title={type === 'login' ? `New login (${MOD}N)` : `New ${ENTRY_TYPE_LABELS[type].one}`}
        onClick={() => onNew(type)}
      >
        <Plus className="size-3.5" strokeWidth={2.5} />
        New
      </Button>
    )
  }
  return (
    <div className="relative ml-auto">
      <Button size="sm" variant="primary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Plus className="size-3.5" strokeWidth={2.5} />
        New
        <ChevronDown className="size-3" />
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onMouseDown={() => setOpen(false)} />
          <div className="absolute top-full right-0 z-30 mt-1 w-44 animate-rise overflow-hidden rounded-xl border border-line-strong bg-raised py-1 shadow-2xl shadow-black/50">
            {ENTRY_TYPES.map((t) => {
              const Icon = TYPE_ICONS[t]
              return (
                <button
                  key={t}
                  onClick={() => {
                    setOpen(false)
                    onNew(t)
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] text-fg hover:bg-hover hover:text-bright"
                >
                  <Icon className="size-3.5 text-muted" />
                  {ENTRY_TYPE_LABELS[t].one}
                  {t === 'login' && <Kbd className="ml-auto">{MOD}N</Kbd>}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function Welcome({
  hasEntries,
  type,
  onNew
}: {
  hasEntries: boolean
  type?: EntryType
  onNew: () => void
}): React.JSX.Element {
  const noun = type ? ENTRY_TYPE_LABELS[type].one.toLowerCase() : 'item'
  const shortcuts: [string, string, () => void][] = [
    ['Search everything', `${MOD}K`, () => openPalette('')],
    ['Run a command', `${MOD}${SHIFT}P`, () => openPalette('>')],
    [
      type && type !== 'login' ? `New ${noun}` : 'New login',
      type && type !== 'login' ? '' : `${MOD}N`,
      onNew
    ],
    ['Lock vault', `${MOD}L`, () => openPalette('>lock')]
  ]
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 bg-dots">
      <div className="text-center">
        <p className="text-[15px] font-medium text-bright">
          {hasEntries ? `Select ${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun}` : 'Nothing here yet'}
        </p>
        <p className="mt-1 text-xs text-muted">
          {hasEntries
            ? 'Or use the keyboard to get around.'
            : type && type !== 'login'
              ? `Add your first ${noun}.`
              : 'Create one, or import passwords from Settings.'}
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
            {keys && <Kbd>{keys}</Kbd>}
          </button>
        ))}
      </div>
    </div>
  )
}
