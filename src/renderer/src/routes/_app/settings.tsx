import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Download, FileUp } from 'lucide-react'
import type { ExportFormat, SettingsPatch } from '@shared/types'
import { api, queries } from '@renderer/lib/api'
import { toast, toastError } from '@renderer/lib/toast'
import {
  Button,
  Card,
  ErrorText,
  Field,
  Input,
  PageHeader,
  PasswordInput,
  Select,
  Toggle
} from '@renderer/components/ui'
import { cn } from '@renderer/lib/cn'
import { ImportModal } from '@renderer/components/ImportModal'

export const Route = createFileRoute('/_app/settings')({
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

function SettingsPage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const { data: settings } = useSuspenseQuery(queries.settings())

  const update = useMutation({
    mutationFn: (patch: SettingsPatch) => api.invoke('settings:update', patch),
    onSuccess: (next) => {
      queryClient.setQueryData(queries.settings().queryKey, next)
      void queryClient.invalidateQueries({ queryKey: ['vault', 'health'] })
    },
    onError: toastError
  })

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <PageHeader title="Settings" />

      <Card title="General">
        <div className="space-y-5">
          <Field label="Device name" hint="Shown to your other devices when syncing.">
            <Input
              defaultValue={settings.deviceName}
              onBlur={(e) =>
                e.target.value !== settings.deviceName &&
                update.mutate({ deviceName: e.target.value })
              }
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Lock after inactivity">
              <Select
                value={settings.autoLockMinutes}
                onChange={(e) => update.mutate({ autoLockMinutes: Number(e.target.value) })}
              >
                {AUTO_LOCK.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Clear copied passwords after">
              <Select
                value={settings.clipboardClearSeconds}
                onChange={(e) => update.mutate({ clipboardClearSeconds: Number(e.target.value) })}
              >
                {CLIPBOARD.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Toggle
            label="Lock when the computer sleeps or the screen locks"
            checked={settings.lockOnSuspend}
            onChange={(lockOnSuspend) => update.mutate({ lockOnSuspend })}
          />
          <Field
            label="Flag passwords older than (days)"
            hint="Used by the dashboard’s “old passwords” check."
          >
            <Input
              type="number"
              min={30}
              defaultValue={settings.oldPasswordDays}
              onBlur={(e) =>
                Number(e.target.value) !== settings.oldPasswordDays &&
                update.mutate({ oldPasswordDays: Number(e.target.value) })
              }
              className="w-32"
            />
          </Field>
        </div>
      </Card>

      <ChangeMasterPasswordCard />
      <ImportCard />
      <ExportCard />
    </div>
  )
}

function ChangeMasterPasswordCard(): React.JSX.Element {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const change = useMutation({
    mutationFn: () => api.invoke('vault:change-master-password', current, next),
    onSuccess: () => {
      setCurrent('')
      setNext('')
      setConfirm('')
      toast('Master password changed. Synced devices will use it after their next sync.')
    }
  })
  const valid = current && next.length >= 10 && next === confirm

  return (
    <Card
      title="Master password"
      description="Your vault is re-locked with the new password. Entries are not re-encrypted."
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) change.mutate()
        }}
      >
        <Field label="Current master password">
          <PasswordInput value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="New master password" hint="At least 10 characters">
            <PasswordInput value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="Confirm new password">
            <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
        </div>
        {confirm && next !== confirm && (
          <p className="text-sm text-amber-300">Passwords don’t match.</p>
        )}
        <ErrorText error={change.error} />
        <Button type="submit" disabled={!valid || change.isPending}>
          {change.isPending ? 'Changing…' : 'Change master password'}
        </Button>
      </form>
    </Card>
  )
}

function ImportCard(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <Card
      title={<span id="import">Import</span>}
      description="Dashlane, Chrome, Edge, Firefox, Safari / Apple Passwords, Bitwarden, 1Password, LastPass, KeePass, Proton Pass, or any CSV."
    >
      <div className="space-y-3">
        <p className="text-sm text-zinc-400">
          Dashlane: <i>Settings → Export data → Export to CSV</i>, then pick the ZIP or{' '}
          <code className="text-zinc-300">credentials.csv</code>. Delete the export file once
          imported.
        </p>
        <Button onClick={() => setOpen(true)}>
          <FileUp className="size-4" />
          Import passwords
        </Button>
      </div>
      {open && <ImportModal onClose={() => setOpen(false)} />}
    </Card>
  )
}

const EXPORT_FORMATS: { value: ExportFormat; label: string; description: string }[] = [
  {
    value: 'pm-encrypted',
    label: 'Encrypted backup',
    description: 'Protected with a password you choose. Can be imported back into this app.'
  },
  {
    value: 'csv',
    label: 'CSV (unencrypted)',
    description: 'Works with most password managers. Anyone with the file can read your passwords.'
  },
  {
    value: 'pm-json',
    label: 'JSON (unencrypted)',
    description: 'Full-fidelity plaintext export. Anyone with the file can read your passwords.'
  }
]

function ExportCard(): React.JSX.Element {
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
    <Card title="Export" description="Save a copy of your passwords to a file.">
      <div className="space-y-4">
        <div className="space-y-2">
          {EXPORT_FORMATS.map((option) => (
            <label
              key={option.value}
              className={cn(
                'flex cursor-pointer gap-3 rounded-lg border p-3',
                format === option.value
                  ? 'border-emerald-500/50 bg-emerald-500/5'
                  : 'border-zinc-800 hover:border-zinc-700'
              )}
            >
              <input
                type="radio"
                name="export-format"
                checked={format === option.value}
                onChange={() => setFormat(option.value)}
                className="mt-1 accent-emerald-500"
              />
              <span>
                <span className="block text-sm font-medium">{option.label}</span>
                <span className="block text-xs text-zinc-500">{option.description}</span>
              </span>
            </label>
          ))}
        </div>
        {format === 'pm-encrypted' && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Backup password" hint="At least 8 characters">
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field label="Confirm backup password">
              <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
          </div>
        )}
        <ErrorText error={exportFile.error} />
        <Button onClick={() => exportFile.mutate()} disabled={!valid || exportFile.isPending}>
          <Download className="size-4" />
          Export…
        </Button>
      </div>
    </Card>
  )
}
