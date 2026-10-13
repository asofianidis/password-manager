import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Wand2 } from 'lucide-react'
import type { EntryInput, VaultEntry } from '@shared/types'
import { api, queries } from '@renderer/lib/api'
import { toast } from '@renderer/lib/toast'
import {
  Button,
  ErrorText,
  Field,
  Input,
  PasswordInput,
  StrengthMeter,
  Textarea,
  Toggle
} from './ui'

const EMPTY: EntryInput = {
  title: '',
  username: '',
  password: '',
  url: '',
  notes: '',
  totp: '',
  folder: '',
  favorite: false
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export function EntryForm({
  entry,
  onSaved,
  onCancel
}: {
  entry?: VaultEntry
  onSaved: (entry: VaultEntry) => void
  onCancel: () => void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<EntryInput>(entry ? pickInput(entry) : EMPTY)
  const set = <K extends keyof EntryInput>(key: K, value: EntryInput[K]): void =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const password = useDebounced(form.password, 200)
  const { data: strength } = useQuery({
    queryKey: ['strength', password],
    queryFn: () => api.invoke('strength:check', password),
    enabled: password.length > 0,
    gcTime: 0
  })
  const { data: settings } = useQuery(queries.settings())

  const generate = useMutation({
    mutationFn: () => api.invoke('generator:generate', settings!.generator),
    onSuccess: (result) => set('password', result.password)
  })

  const save = useMutation({
    mutationFn: () =>
      entry ? api.invoke('entries:update', entry.id, form) : api.invoke('entries:create', form),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['vault'] })
      toast(entry ? 'Password updated' : 'Password saved')
      onSaved(saved)
    }
  })

  return (
    <form
      className="mx-auto max-w-2xl space-y-5 p-8 pt-10"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <h2 className="text-xl font-semibold">{entry ? 'Edit password' : 'New password'}</h2>
      <Field label="Title">
        <Input
          autoFocus
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="e.g. GitHub"
        />
      </Field>
      <Field label="Website">
        <Input
          value={form.url}
          onChange={(e) => set('url', e.target.value)}
          placeholder="https://github.com"
        />
      </Field>
      <Field label="Username or email">
        <Input
          value={form.username}
          onChange={(e) => set('username', e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <div className="space-y-2">
        <div className="flex items-end gap-2">
          <Field label="Password" className="flex-1">
            <PasswordInput
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
            />
          </Field>
          <Button onClick={() => generate.mutate()} disabled={!settings || generate.isPending}>
            <Wand2 className="size-4" />
            Generate
          </Button>
        </div>
        {form.password && strength && (
          <StrengthMeter score={strength.score} detail={`Cracked in ${strength.crackTime}`} />
        )}
        {form.password && strength?.warning && (
          <p className="text-xs text-amber-300">{strength.warning}</p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Folder">
          <Input value={form.folder} onChange={(e) => set('folder', e.target.value)} />
        </Field>
        <Field label="One-time password secret" hint="otpauth:// URI or base32 secret">
          <Input
            value={form.totp}
            onChange={(e) => set('totp', e.target.value)}
            className="font-mono"
            spellCheck={false}
          />
        </Field>
      </div>
      <Field label="Notes">
        <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>
      <Toggle checked={form.favorite} onChange={(v) => set('favorite', v)} label="Favorite" />
      <ErrorText error={save.error} />
      <div className="flex justify-end gap-2 pt-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  )
}

function pickInput(entry: VaultEntry): EntryInput {
  const { title, username, password, url, notes, totp, folder, favorite } = entry
  return { title, username, password, url, notes, totp, folder, favorite }
}
