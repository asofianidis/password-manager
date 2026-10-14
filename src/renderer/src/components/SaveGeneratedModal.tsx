import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Search } from 'lucide-react'
import { api, queries } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { hostOf } from '@renderer/lib/format'
import { toast } from '@renderer/lib/toast'
import { Button, ErrorText, Field, Input, Modal, Monogram, Secret, Segmented } from './ui'

type Mode = 'new' | 'existing'

/** Saves a generated password as a new entry, or as the new password of an existing one. */
export function SaveGeneratedModal({
  password,
  onClose
}: {
  password: string
  onClose: () => void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const { data: entries = [] } = useQuery(queries.entries())
  const [mode, setMode] = useState<Mode>('new')
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [folder, setFolder] = useState('')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const folders = useMemo(
    () => [...new Set(entries.map((e) => e.folder).filter(Boolean))].sort(),
    [entries]
  )
  const matches = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    return entries
      .filter((e) => {
        const haystack = [e.title, e.username, e.url, e.folder].join(' ').toLowerCase()
        return terms.every((t) => haystack.includes(t))
      })
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
  }, [entries, query])
  const selected = entries.find((e) => e.id === selectedId)

  const save = useMutation({
    mutationFn: async () => {
      if (mode === 'new') {
        return api.invoke('entries:create', {
          title: title.trim(),
          username,
          password,
          url,
          folder: folder.trim(),
          notes: '',
          totp: '',
          favorite: false
        })
      }
      const {
        title: t,
        username: u,
        url: w,
        notes,
        totp,
        folder: f,
        favorite
      } = await api.invoke('entries:get', selectedId!)
      return api.invoke('entries:update', selectedId!, {
        title: t,
        username: u,
        url: w,
        notes,
        totp,
        folder: f,
        favorite,
        password
      })
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['vault'] })
      toast(
        mode === 'new' ? `Saved ${saved.title} to the vault` : `Updated password for ${saved.title}`
      )
      onClose()
    }
  })

  const valid = mode === 'new' ? title.trim().length > 0 : selectedId !== null

  return (
    <Modal title="Save to vault" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid && !save.isPending) save.mutate()
        }}
      >
        <div className="rounded-lg bg-canvas px-3 py-2.5 ring-1 ring-line ring-inset">
          <Secret value={password} className="text-[13px] text-bright" />
        </div>

        <Segmented
          className="w-full [&>button]:flex-1 [&>button]:justify-center"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'new', label: 'New entry' },
            { value: 'existing', label: 'Replace existing' }
          ]}
        />

        {mode === 'new' ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">
              <Input
                autoFocus
                value={title}
                placeholder="GitHub"
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field label="Website">
              <Input
                value={url}
                placeholder="https://github.com"
                className="font-mono"
                spellCheck={false}
                onChange={(e) => setUrl(e.target.value)}
              />
            </Field>
            <Field label="Username">
              <Input
                value={username}
                placeholder="me@example.com"
                className="font-mono"
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => setUsername(e.target.value)}
              />
            </Field>
            <Field label="Folder">
              <Input
                value={folder}
                list="save-folders"
                placeholder="None"
                onChange={(e) => setFolder(e.target.value)}
              />
              <datalist id="save-folders">
                {folders.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </Field>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-faint" />
              <Input
                autoFocus
                value={query}
                placeholder="Find an entry"
                className="pl-8"
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <ul className="max-h-56 overflow-y-auto rounded-lg p-1 ring-1 ring-line ring-inset">
              {matches.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(entry.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left',
                      entry.id === selectedId ? 'bg-sel' : 'hover:bg-hover'
                    )}
                  >
                    <Monogram title={entry.title} url={entry.url} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-fg">{entry.title}</span>
                      <span className="block truncate text-xs text-faint">
                        {entry.username || hostOf(entry.url)}
                      </span>
                    </span>
                    {entry.id === selectedId && <Check className="size-4 shrink-0 text-accent" />}
                  </button>
                </li>
              ))}
              {matches.length === 0 && (
                <li className="px-2 py-4 text-center text-xs text-muted">No matching entries</li>
              )}
            </ul>
            {selected && (
              <p className="text-xs text-warn">
                Replaces the current password for {selected.title}. Synced devices get the change on
                their next sync.
              </p>
            )}
          </div>
        )}

        <ErrorText error={save.error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!valid || save.isPending}>
            {save.isPending ? 'Saving…' : mode === 'new' ? 'Save entry' : 'Replace password'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
