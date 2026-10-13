import { useState } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Laptop, Lock, ShieldCheck } from 'lucide-react'
import { api, queries } from '@renderer/lib/api'
import {
  Button,
  ErrorText,
  Field,
  Input,
  PasswordInput,
  StrengthMeter
} from '@renderer/components/ui'
import { cn } from '@renderer/lib/cn'

export const Route = createFileRoute('/unlock')({
  beforeLoad: async ({ context }) => {
    const status = await context.queryClient.fetchQuery(queries.status())
    if (status.state === 'unlocked') throw redirect({ to: '/' })
  },
  component: UnlockPage
})

const MIN_LENGTH = 10
const DEFAULT_SYNC_PORT = 47821

function UnlockPage(): React.JSX.Element {
  const { data: status } = useQuery(queries.status())

  return (
    <div className="flex min-h-screen items-center justify-center p-6 [-webkit-app-region:drag]">
      <div className="w-full max-w-md [-webkit-app-region:no-drag]">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-500/30">
            <ShieldCheck className="size-7 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Password Manager</h1>
          <p className="mt-1 text-sm text-zinc-400">Stored and encrypted on this device only.</p>
        </div>
        {status?.state === 'no-vault' ? <SetupForms /> : status ? <UnlockForm /> : null}
      </div>
    </div>
  )
}

function useOnUnlocked(): () => Promise<void> {
  const queryClient = useQueryClient()
  const router = useRouter()
  return async () => {
    await queryClient.invalidateQueries({ queryKey: ['vault'] })
    await router.navigate({ to: '/' })
  }
}

function UnlockForm(): React.JSX.Element {
  const [password, setPassword] = useState('')
  const onUnlocked = useOnUnlocked()
  const unlock = useMutation({
    mutationFn: () => api.invoke('vault:unlock', password),
    onSuccess: onUnlocked,
    onError: () => setPassword('')
  })

  return (
    <form
      className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6"
      onSubmit={(e) => {
        e.preventDefault()
        if (password) unlock.mutate()
      }}
    >
      <Field label="Master password">
        <PasswordInput
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter your master password"
        />
      </Field>
      <ErrorText error={unlock.error} />
      <Button
        variant="primary"
        type="submit"
        className="w-full"
        disabled={!password || unlock.isPending}
      >
        <Lock className="size-4" />
        {unlock.isPending ? 'Unlocking…' : 'Unlock'}
      </Button>
    </form>
  )
}

function SetupForms(): React.JSX.Element {
  const [mode, setMode] = useState<'create' | 'join'>('create')
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
      <div className="mb-6 grid grid-cols-2 gap-1 rounded-lg bg-zinc-950 p-1">
        {(
          [
            ['create', 'New vault', KeyRound],
            ['join', 'Join from device', Laptop]
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={cn(
              'flex items-center justify-center gap-2 rounded-md py-2 text-sm font-medium',
              mode === value ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>
      {mode === 'create' ? <CreateForm /> : <JoinForm />}
    </div>
  )
}

function MasterPasswordFields({
  password,
  confirm,
  onPassword,
  onConfirm
}: {
  password: string
  confirm: string
  onPassword: (value: string) => void
  onConfirm: (value: string) => void
}): React.JSX.Element {
  const { data: strength } = useQuery({
    queryKey: ['strength', password],
    queryFn: () => api.invoke('strength:check', password),
    enabled: password.length > 0,
    gcTime: 0
  })
  return (
    <>
      <Field
        label="Master password"
        hint={`At least ${MIN_LENGTH} characters. It cannot be recovered if you forget it.`}
      >
        <PasswordInput autoFocus value={password} onChange={(e) => onPassword(e.target.value)} />
      </Field>
      {password && strength && (
        <StrengthMeter score={strength.score} detail={`Cracked in ${strength.crackTime}`} />
      )}
      <Field label="Confirm master password">
        <PasswordInput value={confirm} onChange={(e) => onConfirm(e.target.value)} />
      </Field>
    </>
  )
}

function CreateForm(): React.JSX.Element {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const onUnlocked = useOnUnlocked()
  const create = useMutation({
    mutationFn: () => api.invoke('vault:create', password),
    onSuccess: onUnlocked
  })
  const mismatch = confirm.length > 0 && confirm !== password
  const valid = password.length >= MIN_LENGTH && password === confirm

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) create.mutate()
      }}
    >
      <MasterPasswordFields
        password={password}
        confirm={confirm}
        onPassword={setPassword}
        onConfirm={setConfirm}
      />
      {mismatch && <p className="text-sm text-amber-300">Passwords don’t match.</p>}
      <ErrorText error={create.error} />
      <Button
        variant="primary"
        type="submit"
        className="w-full"
        disabled={!valid || create.isPending}
      >
        {create.isPending ? 'Creating vault…' : 'Create vault'}
      </Button>
    </form>
  )
}

function JoinForm(): React.JSX.Element {
  const [host, setHost] = useState('')
  const [port, setPort] = useState(String(DEFAULT_SYNC_PORT))
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const onUnlocked = useOnUnlocked()
  const join = useMutation({
    mutationFn: () => api.invoke('vault:join', host.trim(), Number(port), code, password),
    onSuccess: onUnlocked
  })
  const valid = host.trim() && Number(port) > 0 && code.replace(/\D/g, '').length === 6 && password

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) join.mutate()
      }}
    >
      <p className="text-sm text-zinc-400">
        On a device that already has your vault, open <b>Sync → Pair a device</b>, then enter the
        address and code it shows.
      </p>
      <div className="grid grid-cols-[1fr_7rem] gap-3">
        <Field label="Device address" hint="Tailscale IP, MagicDNS name, or LAN IP">
          <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="100.x.y.z" />
        </Field>
        <Field label="Port">
          <Input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" />
        </Field>
      </div>
      <Field label="Pairing code">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="123456"
          inputMode="numeric"
          className="font-mono tracking-widest"
        />
      </Field>
      <Field label="Master password" hint="The master password of the vault you are joining.">
        <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <ErrorText error={join.error} />
      <Button
        variant="primary"
        type="submit"
        className="w-full"
        disabled={!valid || join.isPending}
      >
        {join.isPending ? 'Joining…' : 'Join vault'}
      </Button>
    </form>
  )
}
