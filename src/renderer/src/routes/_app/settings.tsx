import { useEffect, useState, type ReactNode } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Download, FileUp, Search } from 'lucide-react'
import type { ExportFormat, Settings, SettingsPatch } from '@shared/types'
import { api, queries } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { toast, toastError } from '@renderer/lib/toast'
import {
  Breadcrumbs,
  Button,
  Checkbox,
  ErrorText,
  Input,
  PasswordInput,
  Select
} from '@renderer/components/ui'
import { ImportModal } from '@renderer/components/ImportModal'

const SECTIONS = ['general', 'security', 'data'] as const
type SectionId = (typeof SECTIONS)[number]

const SECTION_LABELS: Record<SectionId, string> = {
  general: 'General',
  security: 'Security',
  data: 'Import & Export'
}

export const Route = createFileRoute('/_app/settings')({
  validateSearch: (
    search: Record<string, unknown>
  ): { section?: SectionId; action?: 'import' } => ({
    section: SECTIONS.includes(search.section as SectionId)
      ? (search.section as SectionId)
      : undefined,
    action: search.action === 'import' ? 'import' : undefined
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(queries.settings()),
  component: SettingsPage
})

const AUTO_LOCK = [
  [1, '1 minute'],
  [5, '5 minutes'],
  [10, '10 minutes'],
  [30, '30 minutes'],
  [60, '1 hour'],
  [0, 'never']
] as const

const CLIPBOARD = [
  [15, '15 seconds'],
  [30, '30 seconds'],
  [60, '1 minute'],
  [120, '2 minutes'],
  [0, 'never']
] as const

interface SettingDef {
  id: string
  section: SectionId
  title: string
  description: string
  render: (ctx: { settings: Settings; update: (patch: SettingsPatch) => void }) => ReactNode
}

const DEFS: SettingDef[] = [
  {
    id: 'deviceName',
    section: 'general',
    title: 'Device Name',
    description: 'Shown to your other devices when syncing.',
    render: ({ settings, update }) => (
      <Input
        className="max-w-sm"
        defaultValue={settings.deviceName}
        onBlur={(e) =>
          e.target.value !== settings.deviceName && update({ deviceName: e.target.value })
        }
      />
    )
  },
  {
    id: 'oldPasswordDays',
    section: 'general',
    title: 'Old Password Threshold',
    description: 'Flag passwords that have not changed in this many days (Problems view).',
    render: ({ settings, update }) => (
      <Input
        type="number"
        min={30}
        className="w-28"
        defaultValue={settings.oldPasswordDays}
        onBlur={(e) =>
          Number(e.target.value) !== settings.oldPasswordDays &&
          update({ oldPasswordDays: Number(e.target.value) })
        }
      />
    )
  },
  {
    id: 'autoLockMinutes',
    section: 'security',
    title: 'Auto Lock',
    description: 'Lock the vault after the computer has been idle for this long.',
    render: ({ settings, update }) => (
      <Select
        className="max-w-xs"
        value={settings.autoLockMinutes}
        onChange={(e) => update({ autoLockMinutes: Number(e.target.value) })}
      >
        {AUTO_LOCK.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
    )
  },
  {
    id: 'lockOnSuspend',
    section: 'security',
    title: 'Lock On Sleep',
    description: '',
    render: ({ settings, update }) => (
      <Checkbox
        label="Lock the vault when the computer sleeps or the screen locks."
        checked={settings.lockOnSuspend}
        onChange={(lockOnSuspend) => update({ lockOnSuspend })}
      />
    )
  },
  {
    id: 'clipboardClearSeconds',
    section: 'security',
    title: 'Clipboard Timeout',
    description: 'Clear copied passwords from the clipboard after this long.',
    render: ({ settings, update }) => (
      <Select
        className="max-w-xs"
        value={settings.clipboardClearSeconds}
        onChange={(e) => update({ clipboardClearSeconds: Number(e.target.value) })}
      >
        {CLIPBOARD.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
    )
  },
  {
    id: 'masterPassword',
    section: 'security',
    title: 'Master Password',
    description:
      'Re-wraps the vault key with a new password. Synced devices pick it up on their next sync.',
    render: () => <ChangeMasterPassword />
  },
  {
    id: 'import',
    section: 'data',
    title: 'Import',
    description:
      'Dashlane (CSV/ZIP), Chrome, Edge, Brave, Firefox, Safari/Apple Passwords, Bitwarden, 1Password, LastPass, KeePass, Proton Pass, or any CSV.',
    render: () => <ImportSetting />
  },
  {
    id: 'export',
    section: 'data',
    title: 'Export',
    description: 'Save a copy of every credential to a file.',
    render: () => <ExportSetting />
  }
]

function SettingsPage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const { data: settings } = useSuspenseQuery(queries.settings())
  const { section } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [query, setQuery] = useState('')

  const update = useMutation({
    mutationFn: (patch: SettingsPatch) => api.invoke('settings:update', patch),
    onSuccess: (next) => {
      queryClient.setQueryData(queries.settings().queryKey, next)
      void queryClient.invalidateQueries({ queryKey: ['vault'] })
    },
    onError: toastError
  })

  useEffect(() => {
    if (section) document.getElementById(`section-${section}`)?.scrollIntoView({ block: 'start' })
  }, [section])

  const term = query.trim().toLowerCase()
  const visible = DEFS.filter(
    (d) =>
      !term ||
      `${SECTION_LABELS[d.section]} ${d.title} ${d.description}`.toLowerCase().includes(term)
  )

  return (
    <div className="flex h-full flex-col">
      <Breadcrumbs path={['vault', 'settings.json']} />
      <div className="border-b border-ide-border px-6 py-3">
        <div className="relative max-w-3xl">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-ide-faint" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search settings"
            className="pl-7"
          />
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <nav className="w-48 shrink-0 border-r border-ide-border py-2">
          {SECTIONS.map((id) => {
            const count = visible.filter((d) => d.section === id).length
            return (
              <button
                key={id}
                onClick={() => void navigate({ search: { section: id }, replace: true })}
                disabled={count === 0}
                className={cn(
                  'flex w-full items-center justify-between px-4 py-1 text-left hover:bg-ide-hover disabled:opacity-40',
                  section === id ? 'text-ide-bright' : 'text-ide-muted'
                )}
              >
                {SECTION_LABELS[id]}
                {term && <span className="text-[11px]">{count}</span>}
              </button>
            )
          })}
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-16">
          {SECTIONS.map((id) => {
            const defs = visible.filter((d) => d.section === id)
            if (defs.length === 0) return null
            return (
              <section key={id} id={`section-${id}`} className="max-w-3xl pt-4">
                <h2 className="mb-1 text-lg text-ide-bright">{SECTION_LABELS[id]}</h2>
                {defs.map((def) => (
                  <div key={def.id} className="-mx-3 space-y-1.5 px-3 py-3 hover:bg-ide-line">
                    <p>
                      <span className="text-ide-muted">{SECTION_LABELS[def.section]}: </span>
                      <span className="font-semibold text-ide-bright">{def.title}</span>
                    </p>
                    {def.description && <p className="text-xs text-ide-muted">{def.description}</p>}
                    <div className="pt-1">{def.render({ settings, update: update.mutate })}</div>
                  </div>
                ))}
              </section>
            )
          })}
          {visible.length === 0 && <p className="pt-6 text-ide-muted">No settings found.</p>}
        </div>
      </div>
    </div>
  )
}

function ChangeMasterPassword(): React.JSX.Element {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const change = useMutation({
    mutationFn: () => api.invoke('vault:change-master-password', current, next),
    onSuccess: () => {
      setCurrent('')
      setNext('')
      setConfirm('')
      toast('Master password changed')
    }
  })
  const valid = current && next.length >= 10 && next === confirm

  return (
    <form
      className="max-w-md space-y-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) change.mutate()
      }}
    >
      <PasswordInput
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        placeholder="current master password"
      />
      <PasswordInput
        value={next}
        onChange={(e) => setNext(e.target.value)}
        placeholder="new master password (10+ characters)"
      />
      <PasswordInput
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="confirm new master password"
      />
      {confirm && next !== confirm && (
        <p className="text-xs text-syn-type">passwords don’t match</p>
      )}
      <ErrorText error={change.error} />
      <Button type="submit" disabled={!valid || change.isPending}>
        {change.isPending ? 'Changing…' : 'Change master password'}
      </Button>
    </form>
  )
}

function ImportSetting(): React.JSX.Element {
  const { action } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [open, setOpen] = useState(action === 'import')
  return (
    <>
      <p className="mb-2 text-xs text-syn-comment">
        {
          '// Dashlane: Settings → Export data → Export to CSV, then pick the ZIP or credentials.csv.'
        }
        <br />
        {'// delete the export file once imported — it is not encrypted.'}
      </p>
      <Button onClick={() => setOpen(true)}>
        <FileUp className="size-3.5" />
        Import passwords…
      </Button>
      {open && (
        <ImportModal
          onClose={() => {
            setOpen(false)
            if (action)
              void navigate({ search: (prev) => ({ ...prev, action: undefined }), replace: true })
          }}
        />
      )}
    </>
  )
}

const EXPORT_FORMATS: { value: ExportFormat; label: string; description: string }[] = [
  {
    value: 'pm-encrypted',
    label: 'encrypted backup (.pmbackup)',
    description: 'protected with a password you choose; re-importable'
  },
  {
    value: 'csv',
    label: 'csv (unencrypted)',
    description: 'works with most password managers; readable by anyone with the file'
  },
  {
    value: 'pm-json',
    label: 'json (unencrypted)',
    description: 'full-fidelity plaintext; readable by anyone with the file'
  }
]

function ExportSetting(): React.JSX.Element {
  const [format, setFormat] = useState<ExportFormat>('pm-encrypted')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const exportFile = useMutation({
    mutationFn: () =>
      api.invoke('export:save', format, format === 'pm-encrypted' ? password : undefined),
    onSuccess: (path) => {
      if (!path) return
      setPassword('')
      setConfirm('')
      toast(`Exported to ${path}`)
    }
  })
  const valid = format !== 'pm-encrypted' || (password.length >= 8 && password === confirm)

  return (
    <div className="max-w-md space-y-2">
      <Select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
        {EXPORT_FORMATS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </Select>
      <p
        className={cn('text-xs', format === 'pm-encrypted' ? 'text-syn-comment' : 'text-syn-type')}
      >
        {'// '}
        {EXPORT_FORMATS.find((f) => f.value === format)?.description}
      </p>
      {format === 'pm-encrypted' && (
        <>
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="backup password (8+ characters)"
          />
          <PasswordInput
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="confirm backup password"
          />
        </>
      )}
      <ErrorText error={exportFile.error} />
      <Button onClick={() => exportFile.mutate()} disabled={!valid || exportFile.isPending}>
        <Download className="size-3.5" />
        Export…
      </Button>
    </div>
  )
}
