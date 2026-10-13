import { useMemo } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { KeyRound, Plus, Search, Star } from 'lucide-react'
import type { EntrySummary } from '@shared/types'
import { queries } from '@renderer/lib/api'
import { hostOf } from '@renderer/lib/format'
import { Button, Input, StrengthBadge } from '@renderer/components/ui'
import { cn } from '@renderer/lib/cn'
import { EntryDetail } from '@renderer/components/EntryDetail'
import { EntryForm } from '@renderer/components/EntryForm'
import { Monogram } from '@renderer/components/Monogram'

const FILTERS = ['all', 'favorites', 'weak', 'reused', 'old'] as const
type Filter = (typeof FILTERS)[number]

interface PasswordsSearch {
  q?: string
  id?: string
  filter?: Filter
  edit?: boolean
}

export const Route = createFileRoute('/_app/passwords')({
  validateSearch: (search: Record<string, unknown>): PasswordsSearch => ({
    q: typeof search.q === 'string' && search.q ? search.q : undefined,
    id: typeof search.id === 'string' ? search.id : undefined,
    filter: FILTERS.includes(search.filter as Filter) ? (search.filter as Filter) : undefined,
    edit: search.edit === true ? true : undefined
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(queries.entries()),
  component: PasswordsPage
})

function matches(entry: EntrySummary, terms: string[]): boolean {
  const haystack = [entry.title, entry.username, entry.url, entry.folder].join(' ').toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

function PasswordsPage(): React.JSX.Element {
  const { q = '', id, filter = 'all', edit } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { data: entries } = useSuspenseQuery(queries.entries())

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
      .sort(
        (a, b) =>
          Number(b.favorite) - Number(a.favorite) ||
          a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
      )
  }, [entries, q, filter])

  const select = (next: Partial<PasswordsSearch>): void => {
    void navigate({ search: (prev) => ({ ...prev, edit: undefined, ...next }), replace: true })
  }

  return (
    <div className="flex h-full">
      <div className="flex w-96 shrink-0 flex-col border-r border-zinc-800">
        <div className="space-y-3 border-b border-zinc-800 p-4 pt-10">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold">Passwords</h1>
            <Button size="sm" variant="primary" onClick={() => select({ id: 'new' })}>
              <Plus className="size-4" />
              New
            </Button>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-500" />
            <Input
              autoFocus
              value={q}
              onChange={(e) => select({ q: e.target.value || undefined, id })}
              placeholder={`Search ${entries.length} passwords`}
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => select({ filter: f === 'all' ? undefined : f, id })}
                className={cn(
                  'rounded-full px-2.5 py-1 text-xs font-medium capitalize',
                  filter === f
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'text-zinc-400 hover:bg-zinc-800'
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <ul className="flex-1 overflow-y-auto p-2">
          {filtered.map((entry) => (
            <li key={entry.id}>
              <button
                onClick={() => select({ id: entry.id })}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left',
                  id === entry.id ? 'bg-zinc-800' : 'hover:bg-zinc-900'
                )}
              >
                <Monogram title={entry.title} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                    {entry.title}
                    {entry.favorite && (
                      <Star className="size-3 shrink-0 fill-amber-300 text-amber-300" />
                    )}
                  </p>
                  <p className="truncate text-xs text-zinc-500">
                    {entry.username || hostOf(entry.url) || '—'}
                  </p>
                </div>
                {entry.hasPassword && entry.score <= 2 && <StrengthBadge score={entry.score} />}
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-3 py-10 text-center text-sm text-zinc-500">
              {entries.length === 0 ? 'No passwords yet.' : 'No matches.'}
            </li>
          )}
        </ul>
      </div>

      <div className="flex-1 overflow-y-auto">
        {id === 'new' ? (
          <EntryForm
            key="new"
            onSaved={(entry) => select({ id: entry.id })}
            onCancel={() => select({ id: undefined })}
          />
        ) : id && entries.some((e) => e.id === id) ? (
          <EntryDetail
            key={id}
            id={id}
            editing={Boolean(edit)}
            onEdit={(editing) =>
              void navigate({
                search: (prev) => ({ ...prev, edit: editing || undefined }),
                replace: true
              })
            }
            onDeleted={() => select({ id: undefined })}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-zinc-500">
            <KeyRound className="mb-3 size-10 text-zinc-700" />
            <p className="text-sm">Select a password to view it</p>
          </div>
        )}
      </div>
    </div>
  )
}
