import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Wand2 } from 'lucide-react'
import {
  IDENTITY_KINDS,
  entryType,
  type Attachment,
  type CardDetails,
  type EntryInput,
  type EntryType,
  type IdentityDetails,
  type VaultEntry
} from '@shared/types'
import {
  EMPTY_CARD,
  EMPTY_IDENTITY,
  ENTRY_TYPE_LABELS,
  IDENTITY_KIND_LABELS,
  cardBrand,
  formatCardNumber,
  toInput
} from '@shared/entries'
import { api, queries } from '@renderer/lib/api'
import { MOD, isMod } from '@renderer/lib/keys'
import { toast } from '@renderer/lib/toast'
import { AttachmentsEditor } from './Attachments'
import { EntryIcon } from './EntryIcon'
import {
  Button,
  Checkbox,
  ErrorText,
  Field,
  Input,
  Kbd,
  PasswordInput,
  Select,
  StrengthMeter,
  Textarea
} from './ui'

type Form = Required<EntryInput>

const blank = (type: EntryType): Form => ({
  type,
  title: '',
  username: '',
  password: '',
  url: '',
  notes: '',
  totp: '',
  folder: '',
  favorite: false,
  card: EMPTY_CARD,
  identity: EMPTY_IDENTITY,
  attachments: []
})

const PLACEHOLDERS: Record<EntryType, string> = {
  login: 'GitHub',
  card: 'Everyday Visa',
  identity: 'Passport',
  note: 'Home address',
  document: 'Lease agreement'
}

const FILL_HINT =
  'Lines like "Postal code: 90210" can fill web forms: right-click a field in the browser.'

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

/** A name for an entry saved without one, from what it holds. */
function defaultTitle(form: Form): string {
  if (form.type === 'card') {
    const digits = form.card.number.replace(/\D/g, '')
    return [cardBrand(digits) ?? 'Card', digits.slice(-4)].filter(Boolean).join(' ')
  }
  if (form.type === 'identity') return IDENTITY_KIND_LABELS[form.identity.kind]
  if (form.type === 'note')
    return (
      form.notes
        .split('\n')
        .find((l) => l.trim())
        ?.trim() ?? ''
    )
  if (form.type === 'document') return form.attachments[0]?.name ?? ''
  return ''
}

/** Inserts the slash in a card expiry as it's typed: "082" becomes "08/2". */
function formatExpiry(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 6)
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits
}

export function EntryEditor({
  entry,
  type: newType = 'login',
  defaultFolder,
  autoGenerate,
  onSaved,
  onCancel
}: {
  entry?: VaultEntry
  /** For a new entry */
  type?: EntryType
  defaultFolder?: string
  autoGenerate?: boolean
  onSaved: (entry: VaultEntry) => void
  onCancel: () => void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const type = entry ? entryType(entry) : newType
  const [form, setForm] = useState<Form>(
    entry ? toInput(entry) : { ...blank(type), folder: defaultFolder ?? '' }
  )
  const set = <K extends keyof Form>(key: K, value: Form[K]): void =>
    setForm((prev) => ({ ...prev, [key]: value }))
  const setCard = (patch: Partial<CardDetails>): void =>
    setForm((prev) => ({ ...prev, card: { ...prev.card, ...patch } }))
  const setIdentity = (patch: Partial<IdentityDetails>): void =>
    setForm((prev) => ({ ...prev, identity: { ...prev.identity, ...patch } }))

  const { data: entries } = useQuery(queries.entries())
  const folders = useMemo(
    () => [...new Set((entries ?? []).map((e) => e.folder).filter(Boolean))].sort(),
    [entries]
  )

  const save = useMutation({
    mutationFn: () => {
      const input: EntryInput = { ...form, title: form.title.trim() || defaultTitle(form) }
      return entry
        ? api.invoke('entries:update', entry.id, input)
        : api.invoke('entries:create', input)
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['vault'] })
      toast(entry ? `Saved ${saved.title}` : `Created ${saved.title}`)
      onSaved(saved)
    }
  })

  // Window-level so the shortcuts work wherever focus is (but not while a dialog handles the key)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return
      if (isMod(e) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        save.mutate()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const label = ENTRY_TYPE_LABELS[type].one
  const attachments = (
    <AttachmentsEditor
      entryId={entry?.id}
      attachments={form.attachments}
      onChange={(next: Attachment[]) => set('attachments', next)}
      accept={type === 'identity' ? 'image/*,application/pdf' : undefined}
      prompt={type === 'identity' ? 'Add photos' : 'Add files'}
    />
  )

  return (
    <form
      className="mx-auto flex max-w-3xl flex-col gap-6 px-8 pt-8 pb-12"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <header className="flex items-center gap-4">
        <EntryIcon type={type} title={form.title || '?'} url={form.url} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">{entry ? 'Editing' : `New ${label.toLowerCase()}`}</p>
          <h1 className="truncate text-2xl font-semibold tracking-tight text-bright">
            {form.title || <span className="text-faint">{defaultTitle(form) || 'Untitled'}</span>}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
            <Kbd className="ml-1">esc</Kbd>
          </Button>
          <Button variant="primary" type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
            <Kbd className="ml-1 border-accent-fg/20 bg-accent-fg/10 text-accent-fg">{MOD}S</Kbd>
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-x-4 gap-y-5 rounded-xl border border-line bg-raised/60 p-5">
        <Field label="Name" className={type === 'login' ? undefined : 'col-span-2'}>
          <Input
            autoFocus
            value={form.title}
            placeholder={PLACEHOLDERS[type]}
            onChange={(e) => set('title', e.target.value)}
          />
        </Field>

        {type === 'login' && <LoginFields form={form} set={set} autoGenerate={autoGenerate} />}

        {type === 'card' && (
          <>
            <Field label="Cardholder name" className="col-span-2">
              <Input
                value={form.card.cardholder}
                placeholder="Name as printed on the card"
                autoComplete="off"
                onChange={(e) => setCard({ cardholder: e.target.value })}
              />
            </Field>
            <Field label="Card number" className="col-span-2">
              <div className="relative">
                <Input
                  value={formatCardNumber(form.card.number)}
                  placeholder="1234 5678 9012 3456"
                  inputMode="numeric"
                  className="pr-32 font-mono"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) =>
                    setCard({ number: e.target.value.replace(/\D/g, '').slice(0, 19) })
                  }
                />
                <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-faint">
                  {cardBrand(form.card.number)}
                </span>
              </div>
            </Field>
            <div className="col-span-2 grid grid-cols-3 gap-4">
              <Field label="Expiry">
                <Input
                  value={form.card.expiry}
                  placeholder="MM/YY"
                  inputMode="numeric"
                  className="font-mono"
                  autoComplete="off"
                  onChange={(e) => setCard({ expiry: formatExpiry(e.target.value) })}
                />
              </Field>
              <Field label="Security code">
                <PasswordInput
                  value={form.card.cvv}
                  placeholder="CVV"
                  inputMode="numeric"
                  onChange={(e) => setCard({ cvv: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                />
              </Field>
              <Field label="PIN">
                <PasswordInput
                  value={form.card.pin}
                  placeholder="Optional"
                  inputMode="numeric"
                  onChange={(e) => setCard({ pin: e.target.value.replace(/\D/g, '').slice(0, 12) })}
                />
              </Field>
            </div>
          </>
        )}

        {type === 'identity' && (
          <>
            <Field label="Type">
              <Select
                value={form.identity.kind}
                onChange={(e) => setIdentity({ kind: e.target.value as IdentityDetails['kind'] })}
              >
                {IDENTITY_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {IDENTITY_KIND_LABELS[kind]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Document number">
              <Input
                value={form.identity.number}
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setIdentity({ number: e.target.value })}
              />
            </Field>
            <Field label="Full name">
              <Input
                value={form.identity.fullName}
                placeholder="As printed on the ID"
                autoComplete="off"
                onChange={(e) => setIdentity({ fullName: e.target.value })}
              />
            </Field>
            <Field label="Issued by" hint="Country or state">
              <Input
                value={form.identity.issuer}
                autoComplete="off"
                onChange={(e) => setIdentity({ issuer: e.target.value })}
              />
            </Field>
            <div className="col-span-2 grid grid-cols-3 gap-4">
              <Field label="Date of birth">
                <Input
                  type="date"
                  value={form.identity.birthDate}
                  onChange={(e) => setIdentity({ birthDate: e.target.value })}
                />
              </Field>
              <Field label="Issued">
                <Input
                  type="date"
                  value={form.identity.issuedOn}
                  onChange={(e) => setIdentity({ issuedOn: e.target.value })}
                />
              </Field>
              <Field label="Expires">
                <Input
                  type="date"
                  value={form.identity.expiresOn}
                  onChange={(e) => setIdentity({ expiresOn: e.target.value })}
                />
              </Field>
            </div>
          </>
        )}

        {type === 'note' && (
          <Field label="Note" hint={FILL_HINT} className="col-span-2">
            <Textarea
              value={form.notes}
              className="min-h-64 font-mono text-[12.5px] leading-relaxed"
              placeholder={'Street: 1 Main St\nCity: Springfield\nPostal code: 90210'}
              spellCheck={false}
              onChange={(e) => set('notes', e.target.value)}
            />
          </Field>
        )}

        {type === 'document' && (
          <div className="col-span-2">
            <SectionLabel>Files</SectionLabel>
            {attachments}
          </div>
        )}

        <Field label="Folder" hint="Shows up under Collections in the sidebar">
          <Input
            value={form.folder}
            list="folders"
            placeholder="None"
            onChange={(e) => set('folder', e.target.value)}
          />
          <datalist id="folders">
            {folders.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </Field>
        <div className="flex items-end pb-1">
          <Checkbox
            label="Favorite"
            description="Pin to Favorites in the sidebar"
            checked={form.favorite}
            onChange={(favorite) => set('favorite', favorite)}
          />
        </div>
        {type !== 'note' && (
          <Field
            label="Notes"
            hint={type === 'card' || type === 'identity' ? FILL_HINT : undefined}
            className="col-span-2"
          >
            <Textarea
              value={form.notes}
              spellCheck={false}
              onChange={(e) => set('notes', e.target.value)}
            />
          </Field>
        )}
      </div>

      {type !== 'document' && (
        <section>
          <SectionLabel>{type === 'identity' ? 'Photos' : 'Attachments'}</SectionLabel>
          {attachments}
        </section>
      )}
      <ErrorText error={save.error} />
    </form>
  )
}

function SectionLabel({ children }: { children: ReactNode }): React.JSX.Element {
  return <p className="mb-2 text-xs font-medium text-muted">{children}</p>
}

/** Username, password (with generator and strength meter), website, and two-factor secret. */
function LoginFields({
  form,
  set,
  autoGenerate
}: {
  form: Form
  set: <K extends keyof Form>(key: K, value: Form[K]) => void
  autoGenerate?: boolean
}): React.JSX.Element {
  const [revealed, setRevealed] = useState(!form.password)
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
    onSuccess: (result) => {
      set('password', result.password)
      setRevealed(true)
    }
  })

  const autoGenerated = useRef(false)
  useEffect(() => {
    if (autoGenerate && settings && !autoGenerated.current) {
      autoGenerated.current = true
      generate.mutate()
    }
  }, [autoGenerate, settings, generate])

  return (
    <>
      <Field label="Website">
        <Input
          value={form.url}
          placeholder="https://github.com"
          className="font-mono"
          spellCheck={false}
          onChange={(e) => set('url', e.target.value)}
        />
      </Field>
      <Field label="Username" className="col-span-2">
        <Input
          value={form.username}
          placeholder="me@example.com"
          className="font-mono"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => set('username', e.target.value)}
        />
      </Field>
      <div className="col-span-2 space-y-2">
        <Field label="Password">
          <PasswordInput
            visible={revealed}
            onVisibleChange={setRevealed}
            value={form.password}
            placeholder="••••••••••••"
            onChange={(e) => set('password', e.target.value)}
            trailing={
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-accent hover:text-accent"
                onClick={() => generate.mutate()}
                disabled={!settings || generate.isPending}
              >
                <Wand2 className="size-3.5" />
                Generate
              </Button>
            }
          />
        </Field>
        {form.password && strength && (
          <StrengthMeter score={strength.score} detail={`cracked in ${strength.crackTime}`} />
        )}
      </div>
      <Field
        label="Two-factor secret"
        hint="Optional otpauth:// URI or base32 key"
        className="col-span-2"
      >
        <Input
          value={form.totp}
          placeholder="otpauth://…"
          className="font-mono"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => set('totp', e.target.value)}
        />
      </Field>
    </>
  )
}
