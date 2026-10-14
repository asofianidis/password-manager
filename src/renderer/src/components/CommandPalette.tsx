import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { CornerDownRight, Search, Star } from 'lucide-react'
import { api, queries } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { hostOf } from '@renderer/lib/format'
import { MOD, SHIFT, isMod } from '@renderer/lib/keys'
import { toast, toastError } from '@renderer/lib/toast'
import { closePalette, paletteStore } from '@renderer/lib/workspace'
import { useAppCommands, type AppCommand } from './commands'
import { Kbd, Monogram } from './ui'

type Item =
  | { kind: 'command'; command: AppCommand }
  | {
      kind: 'entry'
      id: string
      title: string
      url: string
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
        url: e.url,
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

  const firstCommand = items.findIndex((item) => item.kind === 'command')

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/50 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && closePalette()}
    >
      <div className="h-fit w-full max-w-2xl animate-rise overflow-hidden rounded-2xl border border-line-strong bg-panel shadow-2xl shadow-black/70">
        <div className="flex items-center gap-3 border-b border-line px-4">
          {commandMode ? (
            <span className="rounded-md bg-accent/15 px-1.5 py-0.5 text-[11px] font-medium text-accent">
              Command
            </span>
          ) : (
            <Search className="size-4 shrink-0 text-faint" />
          )}
          <input
            ref={inputRef}
            value={commandMode ? query.slice(1) : query}
            onChange={(e) => {
              setQuery(commandMode ? `>${e.target.value}` : e.target.value)
              setIndex(0)
            }}
            onKeyDown={(e) => {
              // Backspace on an empty command query leaves command mode
              if (commandMode && e.key === 'Backspace' && query === '>') {
                e.preventDefault()
                setQuery('')
                return
              }
              onKeyDown(e)
            }}
            placeholder={
              commandMode ? 'Run a command…' : 'Search passwords, or type > for commands'
            }
            className="h-14 w-full bg-transparent text-[15px] text-bright placeholder:text-faint focus:outline-none"
            spellCheck={false}
          />
          <Kbd>esc</Kbd>
        </div>
        <ul ref={listRef} className="max-h-[26rem] overflow-y-auto p-2">
          {items.map((item, i) => (
            <li key={item.kind === 'entry' ? item.id : item.command.id} data-index={i}>
              {i === 0 && item.kind === 'entry' && (
                <p className="px-3 pt-1 pb-1.5 text-[11px] font-medium text-faint">Passwords</p>
              )}
              {i === firstCommand && (
                <p
                  className={cn(
                    'px-3 pb-1.5 text-[11px] font-medium text-faint',
                    i > 0 ? 'pt-3' : 'pt-1'
                  )}
                >
                  Commands
                </p>
              )}
              <button
                onMouseMove={() => setIndex(i)}
                onClick={() => void run(item)}
                className={cn(
                  'flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left',
                  i === index ? 'bg-sel text-bright' : 'text-fg'
                )}
              >
                {item.kind === 'entry' ? (
                  <>
                    <Monogram title={item.title} url={item.url} size="sm" />
                    <span className="truncate">{item.title}</span>
                    {item.favorite && <Star className="size-3 shrink-0 fill-warn text-warn" />}
                    {item.weak && <span className="size-1.5 shrink-0 rounded-full bg-danger" />}
                    <span className="truncate text-xs text-faint">{item.detail}</span>
                    {i === index && (
                      <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] text-muted">
                        <Kbd>↵</Kbd> open
                        <Kbd className="ml-1">{MOD}↵</Kbd> copy
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span
                      className={cn(
                        'flex size-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-line ring-inset',
                        i === index ? 'bg-accent/10 text-accent' : 'bg-canvas text-faint'
                      )}
                    >
                      <CornerDownRight className="size-3.5" />
                    </span>
                    <span className="truncate">{item.command.label}</span>
                    <span className="truncate text-xs text-faint">{item.command.category}</span>
                    {item.command.shortcut && (
                      <Kbd className="ml-auto shrink-0">{item.command.shortcut}</Kbd>
                    )}
                  </>
                )}
              </button>
            </li>
          ))}
          {items.length === 0 && (
            <li className="px-3 py-8 text-center text-xs text-muted">
              {entries.length === 0 && !commandMode
                ? `No passwords yet. Type > for commands, or press ${MOD}N.`
                : 'No matching results'}
            </li>
          )}
        </ul>
        <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-[11px] text-faint">
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd> select
          </span>
          {!commandMode && (
            <span className="ml-auto flex items-center gap-1.5">
              <Kbd>&gt;</Kbd> commands · {MOD}
              {SHIFT}P
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
