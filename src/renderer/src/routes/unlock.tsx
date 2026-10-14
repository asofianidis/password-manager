import { useState, type ReactNode } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, LoaderCircle, Lock, Plus, Laptop } from 'lucide-react'
import { api, queries } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import {
  Button,
  ErrorText,
  Field,
  Input,
  LogoMark,
  PasswordInput,
  StrengthMeter
} from '@renderer/components/ui'
import { UpdateButton } from '@renderer/components/UpdateButton'

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
  const isNew = status?.state === 'no-vault'

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-canvas bg-dots p-6 drag">
      <div className="pointer-events-none absolute top-1/2 left-1/2 size-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/[0.06] blur-3xl" />
      <div className="relative w-full max-w-md no-drag">
        <div className="mb-6 flex flex-col items-center text-center">
          <LogoMark size="lg" />
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-bright">
            {isNew ? 'Set up Password Manager' : 'Welcome back'}
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            {isNew
              ? 'Local-first and end-to-end encrypted.'
              : status
                ? 'Enter your master password to unlock.'
                : ' '}
          </p>
        </div>
        <div className="animate-rise rounded-2xl border border-line-strong bg-panel/90 p-6 shadow-2xl shadow-black/60 backdrop-blur">
          {isNew ? <Setup /> : status ? <Unlock /> : null}
        </div>
        {status && !isNew && (
          <p className="mt-4 text-center font-mono text-[11px] text-faint">
            vault {status.vaultId?.slice(0, 8)} · argon2id · aes-256-gcm
          </p>
        )}
      </div>
      <div className="fixed bottom-4 left-4 no-drag">
        <UpdateButton />
      </div>
    </div>
  )
}

function Pending({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <p className="flex items-center gap-2 text-xs text-muted">
      <LoaderCircle className="size-3.5 animate-spin text-accent" />
      {children}
    </p>
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

function Unlock(): React.JSX.Element {
  const [password, setPassword] = useState('')
  const onUnlocked = useOnUnlocked()
  const unlock = useMutation({
    mutationFn: () => api.invoke('vault:unlock', password),
    onSuccess: onUnlocked,
    onError: () => setPassword('')
  })

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (password && !unlock.isPending) unlock.mutate()
      }}
    >
      <Field label="Master password">
        <PasswordInput
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          readOnly={unlock.isPending}
          className="h-10"
        />
      </Field>
      <ErrorText error={unlock.error} />
      {unlock.isPending ? (
        <Pending>Deriving key…</Pending>
      ) : (
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={!password}>
          <Lock className="size-4" />
          Unlock
        </Button>
      )}
    </form>
  )
}

function Setup(): React.JSX.Element {
  const [mode, setMode] = useState<'init' | 'join'>('init')
  const options = [
    { value: 'init', icon: Plus, title: 'New vault', description: 'Start fresh on this device' },
    {
      value: 'join',
      icon: Laptop,
      title: 'Join existing',
      description: 'Copy from another device'
    }
  ] as const

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2">
        {options.map(({ value, icon: Icon, title, description }) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={cn(
              'rounded-xl p-3 text-left ring-1 transition-colors ring-inset',
              mode === value ? 'bg-accent/[0.07] ring-accent/40' : 'ring-line-strong hover:bg-hover'
            )}
          >
            <Icon className={cn('size-4', mode === value ? 'text-accent' : 'text-muted')} />
            <p className="mt-2 font-medium text-bright">{title}</p>
            <p className="text-xs text-muted">{description}</p>
          </button>
        ))}
      </div>
      {mode === 'init' ? <Init key="init" /> : <Join key="join" />}
    </div>
  )
}

function Init(): React.JSX.Element {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const onUnlocked = useOnUnlocked()
  const { data: strength } = useQuery({
    queryKey: ['strength', password],
    queryFn: () => api.invoke('strength:check', password),
    enabled: password.length > 0,
    gcTime: 0
  })
  const create = useMutation({
    mutationFn: () => api.invoke('vault:create', password),
    onSuccess: onUnlocked
  })

  const tooShort = password.length > 0 && password.length < MIN_LENGTH
  const mismatch = confirm.length > 0 && confirm !== password
  const valid = password.length >= MIN_LENGTH && password === confirm

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid && !create.isPending) create.mutate()
      }}
    >
      <div className="space-y-2">
        <Field label="Master password">
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </Field>
        {password && strength && (
          <StrengthMeter score={strength.score} detail={`cracked in ${strength.crackTime}`} />
        )}
        {tooShort && <p className="text-xs text-warn">Use at least {MIN_LENGTH} characters</p>}
      </div>
      <Field label="Confirm master password">
        <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      {mismatch && <p className="text-xs text-warn">Passwords don’t match</p>}
      <p className="rounded-lg bg-warn/[0.07] px-3 py-2 text-xs text-warn/90 ring-1 ring-warn/20 ring-inset">
        Your master password can’t be recovered if you forget it.
      </p>
      <ErrorText error={create.error} />
      {create.isPending ? (
        <Pending>Generating vault key…</Pending>
      ) : (
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={!valid}>
          Create vault
          <ArrowRight className="size-4" />
        </Button>
      )}
    </form>
  )
}

function Join(): React.JSX.Element {
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
        if (valid && !join.isPending) join.mutate()
      }}
    >
      <p className="text-xs text-muted">
        On a device that has your vault, open <span className="text-fg">Sync → Start pairing</span>{' '}
        and enter what it shows.
      </p>
      <div className="grid grid-cols-[1fr_6rem] gap-3">
        <Field label="Device address">
          <Input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="100.x.y.z or name.ts.net"
            className="font-mono"
            autoFocus
          />
        </Field>
        <Field label="Port">
          <Input
            value={port}
            onChange={(e) => setPort(e.target.value)}
            className="font-mono"
            inputMode="numeric"
          />
        </Field>
      </div>
      <Field label="Pairing code">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="123456"
          className="font-mono tracking-[0.3em]"
          inputMode="numeric"
        />
      </Field>
      <Field label="Master password">
        <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <ErrorText error={join.error} />
      {join.isPending ? (
        <Pending>Pairing and pulling vault…</Pending>
      ) : (
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={!valid}>
          Join vault
          <ArrowRight className="size-4" />
        </Button>
      )}
    </form>
  )
}
