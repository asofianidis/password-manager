import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ChevronRight, FileKey2, Star } from 'lucide-react'
import { api, queries } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { hostOf } from '@renderer/lib/format'
import { MOD, SHIFT, isMod } from '@renderer/lib/keys'
import { toast, toastError } from '@renderer/lib/toast'
import { closePalette, paletteStore } from '@renderer/lib/workspace'
import { useAppCommands, type AppCommand } from './commands'

type Item =
  | { kind: 'command'; command: AppCommand }
  | {
      kind: 'entry'
      id: string
      title: string
      detail: string
      favorite: boolean
      weak: boolean
    }

function score(text: string, query: string): number {
  const haystack = text.toLowerCase()
  if (!query) return 1
  if (haystack.startsWith(query)) return 3
  if (haystack.includes(query)) return 2
  // Subsequence match, like fuzzy file pickers
  let i = 0
  for (const ch of haystack) if (ch === query[i]) i++
  return i === query.length ? 1 : 0
}

export function CommandPalette(): React.JSX.Element | null {
  const { open, query: initialQuery } = paletteStore.use()
  if (!open) return null
  return <Palette key={initialQuery} initialQuery={initialQuery} />
}

function Palette({ initialQuery }: { initialQuery: string }): React.JSX.Element {
  const [query, setQuery] = useState(initialQuery)
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const navigate = useNavigate()
  const commands = useAppCommands()
  const { data: entries = [] } = useQuery(queries.entries())

  const commandMode = query.startsWith('>')
  const term = (commandMode ? query.slice(1) : query).trim().toLowerCase()

  const items = useMemo((): Item[] => {
    const matchedCommands = commands
      .map((command) => ({ command, s: score(`${command.category} ${command.label}`, term) }))
      .filter((c) => c.s > 0)
      .sort((a, b) => b.s - a.s)
      .map(({ command }): Item => ({ kind: 'command', command }))
    if (commandMode) return matchedCommands

    const matchedEntries = entries
      .map((e) => ({
        e,
        s: Math.max(score(e.title, term) * 2, score(`${e.username} ${e.url} ${e.folder}`, term))
      }))
      .filter((m) => m.s > 0)
      .sort((a, b) => b.s - a.s || a.e.title.localeCompare(b.e.title))
      .slice(0, 50)
      .map(({ e }): Item => ({
        kind: 'entry',
        id: e.id,
        title: e.title,
        detail: [e.username, hostOf(e.url)].filter(Boolean).join(' · '),
        favorite: e.favorite,
        weak: e.hasPassword && e.score <= 2
      }))
    return term ? [...matchedEntries, ...matchedCommands.slice(0, 5)] : matchedEntries
  }, [commands, entries, term, commandMode])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const run = async (item: Item | undefined, copy = false): Promise<void> => {
    if (!item) return
    closePalette()
    if (item.kind === 'command') {
      item.command.run()
      return
    }
    if (copy) {
      try {
        await api.invoke('entries:copy', item.id, 'password')
        toast(`Copied password for ${item.title}`)
      } catch (error) {
        toastError(error)
      }
      return
    }
    void navigate({ to: '/passwords', search: { id: item.id } })
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      closePalette()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => Math.min(i + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      void run(items[index], isMod(e))
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center pt-12"
      onMouseDown={(e) => e.target === e.currentTarget && closePalette()}
    >
      <div className="h-fit w-full max-w-xl border border-ide-border bg-ide-panel shadow-2xl shadow-black/60">
        <div className="p-1.5">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setIndex(0)
            }}
            onKeyDown={onKeyDown}
            placeholder={
              commandMode
                ? 'Type a command'
                : 'Search passwords by name, user, or site ( > for commands )'
            }
            className="h-7 w-full rounded-sm border border-ide-accent bg-ide-input px-2 text-ide-bright placeholder:text-ide-faint focus:outline-none"
            spellCheck={false}
          />
        </div>
        <ul ref={listRef} className="max-h-96 overflow-y-auto pb-1">
          {items.map((item, i) => (
            <li key={item.kind === 'entry' ? item.id : item.command.id} data-index={i}>
              <button
                onMouseMove={() => setIndex(i)}
                onClick={() => void run(item)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1 text-left',
                  i === index ? 'bg-ide-sel text-ide-bright' : 'text-ide-fg'
                )}
              >
                {item.kind === 'entry' ? (
                  <>
                    <FileKey2
                      className={cn(
                        'size-3.5 shrink-0',
                        item.weak ? 'text-syn-prop' : 'text-syn-type'
                      )}
                    />
                    <span className="truncate">{item.title}</span>
                    {item.favorite && (
                      <Star className="size-3 shrink-0 fill-syn-type text-syn-type" />
                    )}
                    <span className="truncate text-xs text-ide-muted">{item.detail}</span>
                    {i === index && (
                      <span className="ml-auto shrink-0 text-[11px] text-ide-muted">
                        ↵ open · {MOD}↵ copy password
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <ChevronRight className="size-3.5 shrink-0 text-ide-muted" />
                    <span className="truncate">
                      <span className="text-ide-muted">{item.command.category}: </span>
                      {item.command.label}
                    </span>
                    {item.command.shortcut && (
                      <span className="ml-auto shrink-0 text-[11px] text-ide-muted">
                        {item.command.shortcut}
                      </span>
                    )}
                  </>
                )}
              </button>
            </li>
          ))}
          {items.length === 0 && (
            <li className="px-3 py-2 text-xs text-ide-muted">
              {entries.length === 0 && !commandMode
                ? `No passwords yet. Type > for commands, or press ${MOD}N.`
                : 'No matching results'}
            </li>
          )}
        </ul>
        {!commandMode && !term && (
          <p className="border-t border-ide-border px-3 py-1 text-[11px] text-ide-faint">
            Type <span className="text-ide-muted">&gt;</span> for commands · {MOD}
            {SHIFT}P
          </p>
        )}
      </div>
    </div>
  )
}
