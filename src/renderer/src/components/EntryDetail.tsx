import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ExternalLink, Eye, EyeOff, Pencil, Star, Trash2 } from 'lucide-react'
import { api, queries } from '@renderer/lib/api'
import { hostOf, openableUrl, timeAgo } from '@renderer/lib/format'
import { toast, toastError } from '@renderer/lib/toast'
import { Badge, Button, CopyButton, Modal, StrengthBadge } from './ui'
import { EntryForm } from './EntryForm'
import { Monogram } from './Monogram'

export function EntryDetail({
  id,
  editing,
  onEdit,
  onDeleted
}: {
  id: string
  editing: boolean
  onEdit: (editing: boolean) => void
  onDeleted: () => void
}): React.JSX.Element | null {
  const queryClient = useQueryClient()
  const { data: entry } = useQuery(queries.entry(id))
  const { data: summaries } = useQuery(queries.entries())
  const summary = summaries?.find((s) => s.id === id)
  const [revealed, setRevealed] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const copy = (field: 'username' | 'password' | 'url', label: string) => async () => {
    try {
      await api.invoke('entries:copy', id, field)
      toast(`${label} copied`)
    } catch (error) {
      toastError(error)
    }
  }

  const remove = useMutation({
    mutationFn: () => api.invoke('entries:delete', id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['vault'] })
      toast('Password deleted')
      onDeleted()
    },
    onError: toastError
  })

  if (!entry || !summary) return null
  if (editing)
    return <EntryForm entry={entry} onSaved={() => onEdit(false)} onCancel={() => onEdit(false)} />

  const link = openableUrl(entry.url)

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8 pt-10">
      <header className="flex items-center gap-4">
        <Monogram title={entry.title} large />
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 truncate text-xl font-semibold">
            {entry.title}
            {entry.favorite && <Star className="size-4 fill-amber-300 text-amber-300" />}
          </h2>
          <p className="truncate text-sm text-zinc-400">{hostOf(entry.url)}</p>
        </div>
        <Button size="sm" onClick={() => onEdit(true)}>
          <Pencil className="size-4" />
          Edit
        </Button>
        <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
          <Trash2 className="size-4" />
        </Button>
      </header>

      {summary.hasPassword && (summary.score <= 2 || summary.reused) && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" />
          <div className="flex-1 text-amber-100">
            {summary.score <= 2 && <p>This password is weak and should be replaced.</p>}
            {summary.reused && <p>This password is used for more than one account.</p>}
          </div>
          <Button size="sm" onClick={() => onEdit(true)}>
            Change
          </Button>
        </div>
      )}

      <dl className="divide-y divide-zinc-800 rounded-xl border border-zinc-800 bg-zinc-900/50">
        <Row
          label="Username"
          actions={entry.username && <CopyButton onCopy={copy('username', 'Username')} />}
        >
          {entry.username || <Empty />}
        </Row>
        <Row
          label="Password"
          actions={
            entry.password && (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setRevealed((r) => !r)}
                  aria-label={revealed ? 'Hide password' : 'Show password'}
                >
                  {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
                <CopyButton onCopy={copy('password', 'Password')} />
              </>
            )
          }
        >
          {entry.password ? (
            <div className="space-y-1">
              <p className="font-mono break-all">{revealed ? entry.password : '•'.repeat(12)}</p>
              <div className="flex gap-2">
                <StrengthBadge score={summary.score} />
                {summary.reused && <Badge tone="warning">Reused</Badge>}
              </div>
            </div>
          ) : (
            <Empty />
          )}
        </Row>
        <Row
          label="Website"
          actions={
            link && (
              <>
                <CopyButton onCopy={copy('url', 'Website')} />
                <a href={link} target="_blank" rel="noreferrer">
                  <Button size="icon" variant="ghost" aria-label="Open website">
                    <ExternalLink className="size-4" />
                  </Button>
                </a>
              </>
            )
          }
        >
          {entry.url ? <span className="break-all">{entry.url}</span> : <Empty />}
        </Row>
        {entry.totp && (
          <Row label="One-time password">
            <span className="text-zinc-400">Secret stored</span>
          </Row>
        )}
        {entry.folder && <Row label="Folder">{entry.folder}</Row>}
        {entry.notes && (
          <Row label="Notes">
            <p className="whitespace-pre-wrap">{entry.notes}</p>
          </Row>
        )}
      </dl>

      <p className="text-xs text-zinc-500">
        Created {timeAgo(entry.createdAt)} · Modified {timeAgo(entry.updatedAt)} · Password changed{' '}
        {timeAgo(entry.passwordUpdatedAt)}
      </p>

      {confirmDelete && (
        <Modal title="Delete password?" onClose={() => setConfirmDelete(false)}>
          <p className="text-sm text-zinc-400">
            “{entry.title}” will be deleted from this device and from synced devices.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
              Delete
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Row({
  label,
  actions,
  children
}: {
  label: string
  actions?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-4 px-4 py-3">
      <dt className="w-32 shrink-0 pt-0.5 text-sm text-zinc-400">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm">{children}</dd>
      {actions && <div className="flex shrink-0 gap-1">{actions}</div>}
    </div>
  )
}

function Empty(): React.JSX.Element {
  return <span className="text-zinc-600">—</span>
}
