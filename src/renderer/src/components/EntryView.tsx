import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Pencil, Star, Trash2, Wand2 } from 'lucide-react'
import type { VaultEntry } from '@shared/types'
import { api, queries } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { STRENGTH_LABELS, hostOf, identifier, openableUrl, timeAgo } from '@renderer/lib/format'
import { MOD } from '@renderer/lib/keys'
import { entryProblems } from '@renderer/lib/problems'
import { toast, toastError } from '@renderer/lib/toast'
import { Breadcrumbs, Button, CopyButton, Modal, PanelHeader, RevealButton } from './ui'
import { CodeBlock, type CodeLine } from './code'
import { Comment, Kw, Prop, Punc, Str, Type } from './syntax'

const I = '  '

/** Read-only "source view" of a credential. */
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
  const passwordLine = 7

  const lines: CodeLine[] = [
    { content: <Comment>{`// ${hostOf(entry.url) || entry.title}`}</Comment> },
    {
      content: (
        <Comment>
          {`// created ${timeAgo(entry.createdAt)} · modified ${timeAgo(entry.updatedAt)} · password changed ${timeAgo(entry.passwordUpdatedAt)}`}
        </Comment>
      )
    },
    { content: '' },
    {
      content: (
        <>
          <Kw>export const</Kw> {identifier(entry.title)} <Punc>=</Punc> <Punc>{'{'}</Punc>
        </>
      )
    },
    { key: 'title', content: <Field name="title" value={<Str>{entry.title}</Str>} /> },
    {
      content: (
        <Field
          name="username"
          value={entry.username ? <Str>{entry.username}</Str> : <Str>{''}</Str>}
        />
      ),
      actions: entry.username && (
        <CopyButton label="Copy username" onCopy={copy('username', 'Username')} />
      )
    },
    {
      key: 'password',
      content: (
        <Field
          name="password"
          value={
            <span
              className={cn(
                'underline decoration-wavy decoration-1 underline-offset-4',
                summary.hasPassword && summary.score <= 2
                  ? 'decoration-syn-prop'
                  : summary.reused
                    ? 'decoration-syn-type'
                    : 'decoration-transparent'
              )}
            >
              <Str>
                {revealed
                  ? entry.password
                  : '•'.repeat(Math.min(16, Math.max(8, entry.password.length)))}
              </Str>
            </span>
          }
        />
      ),
      trailing: summary.hasPassword && (
        <Comment>
          {`// ${STRENGTH_LABELS[summary.score].toLowerCase()}${summary.reused ? ' · reused' : ''}${summary.old ? ' · old' : ''}`}
        </Comment>
      ),
      highlight:
        summary.hasPassword && summary.score <= 2
          ? 'error'
          : summary.reused
            ? 'warning'
            : undefined,
      actions: entry.password && (
        <>
          <RevealButton revealed={revealed} onToggle={() => setRevealed((r) => !r)} />
          <CopyButton label="Copy password" onCopy={copy('password', 'Password')} />
        </>
      )
    },
    {
      key: 'url',
      content: <Field name="url" value={<Str>{entry.url}</Str>} />,
      actions: openableUrl(entry.url) && (
        <>
          <CopyButton label="Copy URL" onCopy={copy('url', 'URL')} />
          <a
            href={openableUrl(entry.url)!}
            target="_blank"
            rel="noreferrer"
            title="Open in browser"
          >
            <Button size="icon" variant="ghost" aria-label="Open website">
              <ExternalLink className="size-3.5" />
            </Button>
          </a>
        </>
      )
    },
    { content: <Field name="folder" value={<Str>{entry.folder}</Str>} /> },
    { content: <Field name="favorite" value={<Kw>{String(entry.favorite)}</Kw>} /> },
    ...(entry.totp
      ? [
          {
            content: <Field name="totp" value={<Str>{'•'.repeat(8)}</Str>} />,
            trailing: <Comment>{'// 2FA secret stored'}</Comment>
          }
        ]
      : []),
    ...notesLines(entry.notes),
    {
      content: (
        <>
          <Punc>{'}'}</Punc> <Kw>satisfies</Kw> <Type>Credential</Type>
        </>
      )
    }
  ]

  return (
    <div className="flex h-full flex-col">
      <Breadcrumbs
        path={['vault', ...(entry.folder ? [entry.folder] : []), `${identifier(entry.title)}.ts`]}
        actions={
          <>
            <Button
              size="icon"
              variant="ghost"
              title={entry.favorite ? 'Remove from favorites' : 'Add to favorites'}
              onClick={() => toggleFavorite.mutate(entry)}
            >
              <Star className={cn('size-3.5', entry.favorite && 'fill-syn-type text-syn-type')} />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onEdit()} title={`Edit (${MOD}E)`}>
              <Pencil className="size-3.5" />
              Edit
            </Button>
            <Button
              size="icon"
              variant="ghost"
              title="Delete"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <CodeBlock lines={lines} />
      </div>

      {problems.length > 0 && (
        <div className="h-36 shrink-0 border-t border-ide-border bg-ide-panel">
          <PanelHeader
            title={
              <span>
                Problems{' '}
                <span className="ml-1 rounded-full bg-ide-hover px-1.5 text-ide-fg">
                  {problems.length}
                </span>
              </span>
            }
          />
          <ul className="text-xs">
            {problems.map((p, i) => (
              <li key={p.message} className="flex items-center gap-2 px-3 py-1 hover:bg-ide-hover">
                <p.icon className={cn('size-3.5 shrink-0', p.color)} />
                <span className="min-w-0 truncate text-ide-fg">{p.message}</span>
                <span className="shrink-0 whitespace-nowrap text-ide-faint">
                  {identifier(entry.title)}.ts [Ln {passwordLine}, Col 3]
                </span>
                {p.fixable && problems.findIndex((x) => x.fixable) === i && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto text-ide-accent"
                    onClick={() => onEdit({ generate: true })}
                  >
                    <Wand2 className="size-3.5" />
                    Quick fix: generate strong password
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {confirmDelete && (
        <Modal title="Delete credential" onClose={() => setConfirmDelete(false)}>
          <p className="text-ide-fg">
            Delete <span className="text-syn-string">&quot;{entry.title}&quot;</span>?
          </p>
          <p className="mt-1 text-xs text-syn-comment">
            {'// it will also be removed from your synced devices'}
          </p>
          <div className="mt-5 flex justify-end gap-2">
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

function Field({ name, value }: { name: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <>
      {I}
      <Prop>{name}</Prop>
      <Punc>: </Punc>
      {value}
      <Punc>,</Punc>
    </>
  )
}

function notesLines(notes: string): CodeLine[] {
  if (!notes) return []
  const parts = notes.split('\n')
  return parts.map((part, i) => ({
    key: `note-${i}`,
    content: (
      <>
        {i === 0 && (
          <>
            {I}
            <Prop>notes</Prop>
            <Punc>: </Punc>
            <span className="text-syn-string">`</span>
          </>
        )}
        <span className="text-syn-string">{part}</span>
        {i === parts.length - 1 && (
          <>
            <span className="text-syn-string">`</span>
            <Punc>,</Punc>
          </>
        )}
      </>
    )
  }))
}
