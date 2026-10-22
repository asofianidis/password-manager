import { useEffect, useState, type ReactNode } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Download, FileUp, HardDriveDownload, Search, Settings2, ShieldCheck } from 'lucide-react'
import type { ExportFormat, Settings, SettingsPatch } from '@shared/types'
import { api, queries } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { toast, toastError } from '@renderer/lib/toast'
import {
  Button,
  ErrorText,
  Input,
  PageHeader,
  PasswordInput,
  Select,
  Switch
} from '@renderer/components/ui'
import { ImportModal } from '@renderer/components/ImportModal'

const SECTIONS = ['general', 'security', 'data'] as const
type SectionId = (typeof SECTIONS)[number]

const SECTION_LABELS: Record<SectionId, string> = {
  general: 'General',
  security: 'Security',
  data: 'Import & Export'
}

const SECTION_ICONS: Record<SectionId, typeof Settings2> = {
  general: Settings2,
  security: ShieldCheck,
  data: HardDriveDownload
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
  [0, 'Never']
] as const

const CLIPBOARD = [
  [15, '15 seconds'],
  [30, '30 seconds'],
  [60, '1 minute'],
  [120, '2 minutes'],
  [0, 'Never']
] as const

interface SettingDef {
  id: string
  section: SectionId
  title: string
  description: string
  /** Full-width controls go below the description instead of beside it */
  stacked?: boolean
  render: (ctx: { settings: Settings; update: (patch: SettingsPatch) => void }) => ReactNode
}

const DEFS: SettingDef[] = [
  {
    id: 'deviceName',
    section: 'general',
    title: 'Device name',
    description: 'Shown to your other devices when syncing.',
    render: ({ settings, update }) => (
      <Input
        className="w-56"
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
    title: 'Old password threshold',
    description: 'Flag passwords that have not changed in this many days on the Health page.',
    render: ({ settings, update }) => (
      <Input
        type="number"
        min={30}
        className="w-24 font-mono"
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
    title: 'Auto lock',
    description: 'Lock the vault after the computer has been idle for this long.',
    render: ({ settings, update }) => (
      <Select
        className="w-44"
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
    title: 'Lock on sleep',
    description: 'Lock the vault when the computer sleeps or the screen locks.',
    render: ({ settings, update }) => (
      <Switch
        label="Lock on sleep"
        checked={settings.lockOnSuspend}
        onChange={(lockOnSuspend) => update({ lockOnSuspend })}
      />
    )
  },
  {
    id: 'clipboardClearSeconds',
    section: 'security',
    title: 'Clipboard timeout',
    description: 'Clear copied passwords from the clipboard after this long.',
    render: ({ settings, update }) => (
      <Select
        className="w-44"
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
    title: 'Master password',
    description:
      'Re-wraps the vault key with a new password. Synced devices pick it up on their next sync.',
    stacked: true,
    render: () => <ChangeMasterPassword />
  },
  {
    id: 'import',
    section: 'data',
    title: 'Import',
    description:
      'Dashlane (CSV/ZIP), Chrome, Edge, Brave, Firefox, Safari/Apple Passwords, Bitwarden, 1Password, LastPass, KeePass, Proton Pass, or any CSV.',
    stacked: true,
    render: () => <ImportSetting />
  },
  {
    id: 'export',
    section: 'data',
    title: 'Export',
    description: 'Save a copy of every credential to a file.',
    stacked: true,
    render: () => <ExportSetting />
  }
]

function scrollToSection(id: SectionId): void {
  document.getElementById(`section-${id}`)?.scrollIntoView({ block: 'start' })
}

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

  // Section links pass resetScroll: false, otherwise the router scrolls #main back to the top
  useEffect(() => {
    if (section) scrollToSection(section)
  }, [section])

  const term = query.trim().toLowerCase()
  const visible = DEFS.filter(
    (d) =>
      !term ||
      `${SECTION_LABELS[d.section]} ${d.title} ${d.description}`.toLowerCase().includes(term)
  )

  return (
    <div className="mx-auto max-w-5xl pb-16">
      <PageHeader
        title="Settings"
        subtitle="Stored encrypted alongside your vault."
        actions={
          <div className="relative w-64">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-faint" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search settings"
              className="pl-8"
            />
          </div>
        }
      />
      <div className="flex gap-8 px-8">
        <nav className="sticky top-6 h-fit w-44 shrink-0 space-y-0.5">
          {SECTIONS.map((id) => {
            const count = visible.filter((d) => d.section === id).length
            const Icon = SECTION_ICONS[id]
            return (
              <button
                key={id}
                onClick={() => {
                  // Scroll here too: clicking the already-selected section doesn't change the URL
                  scrollToSection(id)
                  void navigate({ search: { section: id }, replace: true, resetScroll: false })
                }}
                disabled={count === 0}
                className={cn(
                  'flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors hover:bg-hover disabled:opacity-40',
                  section === id ? 'bg-sel text-bright' : 'text-muted'
                )}
              >
                <Icon className={cn('size-4', section === id ? 'text-accent' : 'text-faint')} />
                {SECTION_LABELS[id]}
                {term && <span className="ml-auto text-[11px] text-faint">{count}</span>}
              </button>
            )
          })}
        </nav>
        <div className="min-w-0 flex-1 space-y-8">
          {SECTIONS.map((id) => {
            const defs = visible.filter((d) => d.section === id)
            if (defs.length === 0) return null
            return (
              <section key={id} id={`section-${id}`} className="scroll-mt-6">
                <h2 className="mb-3 font-medium text-bright">{SECTION_LABELS[id]}</h2>
                <div className="divide-y divide-line rounded-xl border border-line bg-raised/60">
                  {defs.map((def) => (
                    <div
                      key={def.id}
                      className={cn(
                        'px-5 py-4',
                        !def.stacked && 'flex items-center justify-between gap-6'
                      )}
                    >
                      <div className="min-w-0">
                        <p className="text-bright">{def.title}</p>
                        {def.description && (
                          <p className="mt-0.5 text-xs text-muted">{def.description}</p>
                        )}
                      </div>
                      <div className={cn('shrink-0', def.stacked && 'pt-4')}>
                        {def.render({ settings, update: update.mutate })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )
          })}
          {visible.length === 0 && <p className="pt-6 text-muted">No settings found.</p>}
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
        placeholder="Current master password"
      />
      <PasswordInput
        value={next}
        onChange={(e) => setNext(e.target.value)}
        placeholder="New master password (10+ characters)"
      />
      <PasswordInput
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="Confirm new master password"
      />
      {confirm && next !== confirm && <p className="text-xs text-warn">Passwords don’t match</p>}
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
      <p className="mb-3 rounded-lg bg-canvas px-3 py-2 text-xs text-muted ring-1 ring-line ring-inset">
        Dashlane: Settings → Export data → Export to CSV, then pick the ZIP or credentials.csv.
        Delete the export file once imported, since it is not encrypted.
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
              void navigate({
                search: (prev) => ({ ...prev, action: undefined }),
                replace: true,
                resetScroll: false
              })
          }}
        />
      )}
    </>
  )
}

const EXPORT_FORMATS: { value: ExportFormat; label: string; description: string }[] = [
  {
    value: 'pm-encrypted',
    label: 'Encrypted backup (.pmbackup)',
    description: 'Protected with a password you choose. Can be imported again.'
  },
  {
    value: 'csv',
    label: 'CSV (unencrypted)',
    description: 'Works with most password managers. Readable by anyone with the file.'
  },
  {
    value: 'pm-json',
    label: 'JSON (unencrypted)',
    description: 'Full-fidelity plaintext. Readable by anyone with the file.'
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
      <p className={cn('text-xs', format === 'pm-encrypted' ? 'text-muted' : 'text-warn')}>
        {EXPORT_FORMATS.find((f) => f.value === format)?.description}
      </p>
      {format === 'pm-encrypted' && (
        <>
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Backup password (8+ characters)"
          />
          <PasswordInput
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm backup password"
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
