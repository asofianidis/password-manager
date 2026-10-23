import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Folder, Pencil, ShieldCheck, Star, Trash2, Wand2 } from 'lucide-react'
import { entryType, type VaultEntry } from '@shared/types'
import {
  ENTRY_TYPE_LABELS,
  IDENTITY_KIND_LABELS,
  cardBrand,
  formatCardNumber
} from '@shared/entries'
import { parseNoteFields } from '@shared/fill'
import { api, queries } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { hostOf, openableUrl, timeAgo } from '@renderer/lib/format'
import { MOD } from '@renderer/lib/keys'
import { entryProblems } from '@renderer/lib/problems'
import { toast, toastError } from '@renderer/lib/toast'
import { AttachmentsView } from './Attachments'
import { EntryIcon } from './EntryIcon'
import { Badge, Button, CopyButton, Kbd, Modal, RevealButton, Secret, StrengthMeter } from './ui'

const copyText = (text: string, label: string) => async (): Promise<void> => {
  try {
    await api.invoke('clipboard:copy-secret', text)
    toast(`${label} copied to clipboard`)
  } catch (error) {
    toastError(error)
  }
}

const DAY = 24 * 60 * 60 * 1000

/** When an MM/YY card expiry runs out: the end of that month. */
function cardExpiresAt(expiry: string): number | null {
  const match = /^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/.exec(expiry.trim())
  if (!match) return null
  const year = Number(match[2].length === 2 ? `20${match[2]}` : match[2])
  return new Date(year, Number(match[1]), 1).getTime()
}

function dateAt(iso: string): number | null {
  const time = iso ? new Date(`${iso}T00:00:00`).getTime() : NaN
  return Number.isNaN(time) ? null : time
}

const formatDate = (iso: string): string => {
  const time = dateAt(iso)
  return time === null ? iso : new Date(time).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

function expiryStatus(at: number | null, soonDays: number): 'expired' | 'soon' | null {
  if (at === null) return null
  const left = at - Date.now()
  return left <= 0 ? 'expired' : left < soonDays * DAY ? 'soon' : null
}

/** "Expired" or "Expires soon" for anything within `soonDays` of its expiry. */
function ExpiryBadge({
  at,
  soonDays
}: {
  at: number | null
  soonDays: number
}): React.JSX.Element | null {
  const status = expiryStatus(at, soonDays)
  if (status === 'expired') return <Badge tone="danger">Expired</Badge>
  if (status === 'soon') return <Badge tone="warning">Expires soon</Badge>
  return null
}

/** Read-only detail view of an entry. */
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
  const [confirmDelete, setConfirmDelete] = useState(false)

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

  const type = entryType(entry)
  const host = type === 'login' ? hostOf(entry.url) : ''
  const attachments = entry.attachments ?? []

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-8 pt-8 pb-12">
      <header className="flex items-start gap-4">
        <EntryIcon type={type} title={entry.title} url={entry.url} size="lg" />
        <div className="min-w-0 flex-1 pt-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-bright select-text">
            {entry.title}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
            {type !== 'login' && (
              <Badge>
                {type === 'identity' && entry.identity
                  ? IDENTITY_KIND_LABELS[entry.identity.kind]
                  : ENTRY_TYPE_LABELS[type].one}
              </Badge>
            )}
            {host && <span className="font-mono">{host}</span>}
            {entry.folder && (
              <Badge>
                <Folder className="size-3" />
                {entry.folder}
              </Badge>
            )}
            {entry.totp && <Badge tone="info">2FA</Badge>}
            {type === 'card' && entry.card && (
              <ExpiryBadge at={cardExpiresAt(entry.card.expiry)} soonDays={60} />
            )}
            {type === 'identity' && entry.identity && (
              // Many countries want six months left on a passport to enter
              <ExpiryBadge at={dateAt(entry.identity.expiresOn)} soonDays={183} />
            )}
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

      {type === 'login' && <LoginDetails entry={entry} onEdit={onEdit} />}
      {type === 'card' && <CardDetailsView entry={entry} />}
      {type === 'identity' && <IdentityDetailsView entry={entry} />}
      {type === 'note' && <NoteDetails entry={entry} />}
      {type === 'document' && (
        <>
          {attachments.length > 0 ? (
            <AttachmentsView entryId={entry.id} attachments={attachments} />
          ) : (
            <p className="text-xs text-muted">No files yet. Edit to add some.</p>
          )}
          {entry.notes && <NotesRow notes={entry.notes} />}
        </>
      )}

      {type !== 'document' && attachments.length > 0 && (
        <section>
          <p className="mb-2 text-xs font-medium text-muted">
            {type === 'identity' ? 'Photos' : 'Attachments'}
          </p>
          <AttachmentsView entryId={entry.id} attachments={attachments} />
        </section>
      )}

      <dl className="grid grid-cols-3 gap-3">
        {(
          [
            ['Created', entry.createdAt],
            ['Modified', entry.updatedAt],
            ...(type === 'login' ? [['Password changed', entry.passwordUpdatedAt] as const] : [])
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
          description={
            attachments.length > 0
              ? 'Its files go too. It will also be removed from your synced devices.'
              : 'It will also be removed from your synced devices.'
          }
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

function LoginDetails({
  entry,
  onEdit
}: {
  entry: VaultEntry
  onEdit: (options?: { generate?: boolean }) => void
}): React.JSX.Element | null {
  const { data: summaries } = useQuery(queries.entries())
  const summary = summaries?.find((s) => s.id === entry.id)
  const [revealed, setRevealed] = useState(false)
  const { data: strength } = useQuery({
    queryKey: ['strength', 'entry', entry.id, entry.updatedAt],
    queryFn: () => api.invoke('strength:check', entry.password),
    enabled: Boolean(entry.password),
    gcTime: 0
  })

  const copy = (field: 'username' | 'password' | 'url', label: string) => async () => {
    try {
      await api.invoke('entries:copy', entry.id, field)
      toast(`${label} copied to clipboard`)
    } catch (error) {
      toastError(error)
    }
  }

  if (!summary) return null
  const problems = entryProblems(summary, strength?.crackTime)
  const url = openableUrl(entry.url)

  return (
    <>
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

      <Rows>
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
                <Masked length={Math.max(8, entry.password.length)} />
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
      </Rows>
    </>
  )
}

function CardDetailsView({ entry }: { entry: VaultEntry }): React.JSX.Element {
  const card = entry.card!
  const brand = cardBrand(card.number)
  return (
    <>
      <div className="relative h-44 w-80 overflow-hidden rounded-2xl bg-linear-to-br from-[#2a3f5f] via-[#1f2c44] to-[#141b2b] p-5 shadow-xl ring-1 shadow-black/40 ring-white/10">
        <div className="flex items-start justify-between">
          <span className="truncate text-sm font-medium text-white/90">{entry.title}</span>
          <span className="text-xs font-semibold tracking-wide text-white/70">{brand}</span>
        </div>
        <p className="mt-9 font-mono text-lg tracking-[0.15em] text-white">
          {card.number ? `•••• ${card.number.slice(-4)}` : '•••• ••••'}
        </p>
        <div className="mt-4 flex items-end justify-between text-white/80">
          <span className="truncate text-xs uppercase">{card.cardholder || ' '}</span>
          <span className="font-mono text-xs">{card.expiry}</span>
        </div>
      </div>

      <Rows>
        <TextRow label="Cardholder" value={card.cardholder} />
        <SecretRow label="Card number" value={card.number} display={formatCardNumber} />
        <TextRow label="Expiry" value={card.expiry} mono />
        <SecretRow label="Security code" value={card.cvv} />
        {card.pin && <SecretRow label="PIN" value={card.pin} />}
        {entry.notes && <NotesInRows notes={entry.notes} />}
      </Rows>
    </>
  )
}

function IdentityDetailsView({ entry }: { entry: VaultEntry }): React.JSX.Element {
  const id = entry.identity!
  return (
    <Rows>
      <TextRow label="Full name" value={id.fullName} />
      <TextRow label="Number" value={id.number} mono />
      <TextRow label="Issued by" value={id.issuer} />
      <TextRow label="Date of birth" value={id.birthDate} display={formatDate} />
      <TextRow label="Issued" value={id.issuedOn} display={formatDate} />
      <TextRow label="Expires" value={id.expiresOn} display={formatDate} />
      {entry.notes && <NotesInRows notes={entry.notes} />}
    </Rows>
  )
}

function NoteDetails({ entry }: { entry: VaultEntry }): React.JSX.Element {
  const fields = parseNoteFields(entry.notes)
  return (
    <>
      <NotesRow notes={entry.notes} />
      {fields.length > 0 && (
        <section>
          <p className="mb-2 text-xs font-medium text-muted">
            Fields the browser extension can fill
          </p>
          <Rows>
            {fields.map((field, i) => (
              <TextRow key={i} label={field.label} value={field.value} />
            ))}
          </Rows>
        </section>
      )}
    </>
  )
}

function Rows({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-raised/60">
      {children}
    </div>
  )
}

function NotesRow({ notes }: { notes: string }): React.JSX.Element {
  return (
    <Rows>
      <NotesInRows notes={notes} />
    </Rows>
  )
}

function NotesInRows({ notes }: { notes: string }): React.JSX.Element {
  return (
    <Row
      label="Notes"
      actions={<CopyButton label="Copy notes" onCopy={copyText(notes, 'Notes')} />}
    >
      <p className="whitespace-pre-wrap text-fg select-text">{notes}</p>
    </Row>
  )
}

function TextRow({
  label,
  value,
  mono,
  display = (v) => v
}: {
  label: string
  value: string
  mono?: boolean
  display?: (value: string) => string
}): React.JSX.Element {
  return (
    <Row
      label={label}
      actions={value && <CopyButton label={`Copy ${label}`} onCopy={copyText(value, label)} />}
    >
      {value ? (
        <span className={cn('break-words text-bright select-text', mono && 'font-mono')}>
          {display(value)}
        </span>
      ) : (
        <Empty />
      )}
    </Row>
  )
}

/** A value hidden until revealed, like a card number or PIN. */
function SecretRow({
  label,
  value,
  display = (v) => v
}: {
  label: string
  value: string
  display?: (value: string) => string
}): React.JSX.Element {
  const [revealed, setRevealed] = useState(false)
  return (
    <Row
      label={label}
      actions={
        value && (
          <>
            <RevealButton revealed={revealed} onToggle={() => setRevealed((r) => !r)} />
            <CopyButton label={`Copy ${label}`} onCopy={copyText(value, label)} />
          </>
        )
      }
    >
      {!value ? (
        <Empty />
      ) : revealed ? (
        <Secret value={display(value)} className="text-bright" />
      ) : (
        <Masked length={value.length} />
      )}
    </Row>
  )
}

function Masked({ length }: { length: number }): React.JSX.Element {
  return (
    <span className="font-mono tracking-widest text-bright">
      {'•'.repeat(Math.min(16, Math.max(4, length)))}
    </span>
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
