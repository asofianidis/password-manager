import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Folder, Pencil, ShieldCheck, Star, Trash2, Wand2 } from 'lucide-react'
import type { VaultEntry } from '@shared/types'
import { api, queries } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { hostOf, openableUrl, timeAgo } from '@renderer/lib/format'
import { MOD } from '@renderer/lib/keys'
import { entryProblems } from '@renderer/lib/problems'
import { toast, toastError } from '@renderer/lib/toast'
import {
  Badge,
  Button,
  CopyButton,
  Kbd,
  Modal,
  Monogram,
  RevealButton,
  Secret,
  StrengthMeter
} from './ui'

/** Read-only detail view of a credential. */
export function EntryView({
  id,
  onEdit,
  onDeleted
}: {
  id: string
  onEdit: (options?: { generate?: boolean }) => void
  onDeleted: () => void
}): React.JSX.Element | null {
  const queryClient = useQueryClient()
  const { data: entry } = useQuery(queries.entry(id))
  const { data: summaries } = useQuery(queries.entries())
  const summary = summaries?.find((s) => s.id === id)
  const [revealed, setRevealed] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const { data: strength } = useQuery({
    queryKey: ['strength', 'entry', id, entry?.updatedAt],
    queryFn: () => api.invoke('strength:check', entry!.password),
    enabled: Boolean(entry?.password),
    gcTime: 0
  })

  const copy = (field: 'username' | 'password' | 'url', label: string) => async () => {
    try {
      await api.invoke('entries:copy', id, field)
      toast(`${label} copied to clipboard`)
    } catch (error) {
      toastError(error)
    }
  }

  const remove = useMutation({
    mutationFn: () => api.invoke('entries:delete', id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['vault'] })
      toast(`Deleted ${entry?.title}`)
      onDeleted()
    },
    onError: toastError
  })

  const toggleFavorite = useMutation({
    mutationFn: (e: VaultEntry) =>
      api.invoke('entries:update', id, { ...e, favorite: !e.favorite }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vault'] }),
    onError: toastError
  })

  if (!entry || !summary) return null

  const problems = entryProblems(summary, strength?.crackTime)
  const url = openableUrl(entry.url)
  const host = hostOf(entry.url)

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-8 pt-8 pb-12">
      <header className="flex items-start gap-4">
        <Monogram title={entry.title} url={entry.url} size="lg" />
        <div className="min-w-0 flex-1 pt-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-bright select-text">
            {entry.title}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
            {host && <span className="font-mono">{host}</span>}
            {entry.folder && (
              <Badge>
                <Folder className="size-3" />
                {entry.folder}
              </Badge>
            )}
            {entry.totp && <Badge tone="info">2FA</Badge>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            title={entry.favorite ? 'Remove from favorites' : 'Add to favorites'}
            onClick={() => toggleFavorite.mutate(entry)}
          >
            <Star className={cn('size-4', entry.favorite && 'fill-warn text-warn')} />
          </Button>
          <Button size="icon" variant="ghost" title="Delete" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="size-4" />
          </Button>
          <Button onClick={() => onEdit()} title={`Edit (${MOD}E)`} className="ml-1">
            <Pencil className="size-3.5" />
            Edit
            <Kbd className="ml-1">{MOD}E</Kbd>
          </Button>
        </div>
      </header>

      {problems.length > 0 && (
        <div className="flex items-start gap-4 rounded-xl border border-danger/20 bg-danger/[0.06] p-4">
          <ul className="flex-1 space-y-1.5">
            {problems.map((p) => (
              <li key={p.message} className="flex items-start gap-2 text-[13px]">
                <p.icon className={cn('mt-0.5 size-3.5 shrink-0', p.color)} />
                <span className="text-fg">{p.message}</span>
              </li>
            ))}
          </ul>
          {problems.some((p) => p.fixable) && (
            <Button size="sm" variant="primary" onClick={() => onEdit({ generate: true })}>
              <Wand2 className="size-3.5" />
              Replace with strong password
            </Button>
          )}
        </div>
      )}

      <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-raised/60">
        <Row
          label="Username"
          actions={
            entry.username && (
              <CopyButton label="Copy username" onCopy={copy('username', 'Username')} />
            )
          }
        >
          {entry.username ? (
            <span className="font-mono text-bright select-text">{entry.username}</span>
          ) : (
            <Empty />
          )}
        </Row>
        <Row
          label="Password"
          actions={
            entry.password && (
              <>
                <RevealButton revealed={revealed} onToggle={() => setRevealed((r) => !r)} />
                <CopyButton label="Copy password" onCopy={copy('password', 'Password')} />
              </>
            )
          }
        >
          {entry.password ? (
            <div className="space-y-2">
              {revealed ? (
                <Secret value={entry.password} className="text-bright" />
              ) : (
                <span className="font-mono tracking-widest text-bright">
                  {'•'.repeat(Math.min(16, Math.max(8, entry.password.length)))}
                </span>
              )}
              <StrengthMeter
                score={summary.score}
                detail={strength ? `cracked in ${strength.crackTime}` : undefined}
              />
            </div>
          ) : (
            <Empty />
          )}
        </Row>
        <Row
          label="Website"
          actions={
            url && (
              <>
                <CopyButton label="Copy URL" onCopy={copy('url', 'URL')} />
                <a href={url} target="_blank" rel="noreferrer" title="Open in browser">
                  <Button size="icon" variant="ghost" aria-label="Open website">
                    <ExternalLink className="size-3.5" />
                  </Button>
                </a>
              </>
            )
          }
        >
          {entry.url ? (
            <span className="font-mono break-all text-bright select-text">{entry.url}</span>
          ) : (
            <Empty />
          )}
        </Row>
        {entry.totp && (
          <Row label="Two-factor">
            <span className="flex items-center gap-1.5 text-fg">
              <ShieldCheck className="size-3.5 text-ok" />
              Secret stored
            </span>
          </Row>
        )}
        {entry.notes && (
          <Row label="Notes">
            <p className="whitespace-pre-wrap text-fg select-text">{entry.notes}</p>
          </Row>
        )}
      </div>

      <dl className="grid grid-cols-3 gap-3">
        {(
          [
            ['Created', entry.createdAt],
            ['Modified', entry.updatedAt],
            ['Password changed', entry.passwordUpdatedAt]
          ] as const
        ).map(([label, at]) => (
          <div key={label} className="rounded-xl border border-line px-4 py-3">
            <dt className="text-[11px] text-faint">{label}</dt>
            <dd className="mt-0.5 text-fg" title={new Date(at).toLocaleString()}>
              {timeAgo(at)}
            </dd>
          </div>
        ))}
      </dl>

      {confirmDelete && (
        <Modal
          title={`Delete ${entry.title}?`}
          description="It will also be removed from your synced devices."
          onClose={() => setConfirmDelete(false)}
        >
          <div className="flex justify-end gap-2">
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
    <div className="group flex items-start gap-4 px-5 py-3.5">
      <span className="w-28 shrink-0 pt-px text-xs text-muted">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
      {actions && (
        <div className="-my-1 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {actions}
        </div>
      )}
    </div>
  )
}

function Empty(): React.JSX.Element {
  return <span className="text-faint">—</span>
}
