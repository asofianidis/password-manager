import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, queries } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { StrengthMeter } from '@renderer/components/ui'

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
    <div className="flex min-h-screen items-center justify-center bg-ide-chrome p-6 drag">
      <div className="w-full max-w-2xl border border-ide-border bg-ide-bg shadow-2xl shadow-black/50 no-drag">
        <div className="flex h-8 items-center justify-center border-b border-ide-border bg-ide-panel text-xs text-ide-muted">
          pm — vault
        </div>
        <div className="min-h-80 p-5 text-[13px] leading-6">
          <p className="text-ide-bright">
            password-manager{' '}
            <span className="text-ide-muted">— local-first, end-to-end encrypted</span>
          </p>
          {status?.state === 'no-vault' ? (
            <Setup />
          ) : status ? (
            <>
              <p className="text-ide-muted">
                vault {status.vaultId?.slice(0, 8)} · argon2id + aes-256-gcm
              </p>
              <Unlock />
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function Command({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <p className="mt-4">
      <span className="text-syn-string">➜</span> <span className="text-syn-fn">~</span>{' '}
      <span className="text-ide-bright">{children}</span>
    </p>
  )
}

function Prompt({
  label,
  value,
  onChange,
  secret,
  autoFocus,
  placeholder,
  disabled
}: {
  label: string
  value: string
  onChange: (value: string) => void
  secret?: boolean
  autoFocus?: boolean
  placeholder?: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <label className="flex items-center">
      <span className="shrink-0 text-syn-string">?</span>
      <span className="ml-2 shrink-0 text-ide-bright">{label}:</span>
      <input
        type={secret ? 'password' : 'text'}
        value={value}
        autoFocus={autoFocus}
        readOnly={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoComplete="off"
        className="ml-2 min-w-0 flex-1 bg-transparent text-syn-fn caret-ide-accent outline-none placeholder:text-ide-faint"
      />
    </label>
  )
}

const FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'

function Spinner({ children }: { children: ReactNode }): React.JSX.Element {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 80)
    return () => clearInterval(timer)
  }, [])
  return (
    <p className="text-ide-muted">
      <span className="text-ide-accent">{FRAMES[frame]}</span> {children}
    </p>
  )
}

function ErrorLine({ error }: { error: unknown }): React.JSX.Element | null {
  if (!error) return null
  return (
    <p className="text-syn-prop">
      ✖ error: {(error instanceof Error ? error.message : String(error)).toLowerCase()}
    </p>
  )
}

/** Enter moves to the next prompt; on the last prompt it submits. */
function TerminalForm({
  onSubmit,
  children
}: {
  onSubmit: () => void
  children: ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLFormElement>(null)
  return (
    <form
      ref={ref}
      onSubmit={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return
        e.preventDefault()
        const inputs = [...(ref.current?.querySelectorAll('input') ?? [])]
        const index = inputs.indexOf(e.target as HTMLInputElement)
        if (index >= 0 && index < inputs.length - 1) inputs[index + 1].focus()
        else onSubmit()
      }}
    >
      {children}
    </form>
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
    <TerminalForm onSubmit={() => password && !unlock.isPending && unlock.mutate()}>
      <Command>pm unlock</Command>
      <Prompt
        label="master password"
        value={password}
        onChange={setPassword}
        secret
        autoFocus
        disabled={unlock.isPending}
      />
      {unlock.isPending && <Spinner>deriving key (argon2id)…</Spinner>}
      <ErrorLine error={unlock.error} />
      {!unlock.isPending && <p className="text-ide-faint">press ↵ to unlock</p>}
    </TerminalForm>
  )
}

function Setup(): React.JSX.Element {
  const [mode, setMode] = useState<'init' | 'join'>('init')
  const options = [
    ['init', 'create a new vault on this device'],
    ['join', 'copy a vault from another device (tailscale / lan)']
  ] as const

  return (
    <>
      <p className="text-ide-muted">no vault found on this device. choose one:</p>
      <div className="mt-2">
        {options.map(([value, description]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={cn(
              'flex w-full gap-3 text-left hover:text-ide-bright',
              mode === value ? 'text-ide-bright' : 'text-ide-muted'
            )}
          >
            <span className="w-3 text-syn-string">{mode === value ? '❯' : ''}</span>
            <span className={cn('w-10', mode === value && 'text-syn-fn')}>{value}</span>
            <span>{description}</span>
          </button>
        ))}
      </div>
      {mode === 'init' ? <Init key="init" /> : <Join key="join" />}
    </>
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
    <TerminalForm onSubmit={() => valid && !create.isPending && create.mutate()}>
      <Command>pm init</Command>
      <Prompt
        label="new master password"
        value={password}
        onChange={setPassword}
        secret
        autoFocus
      />
      {password && strength && (
        <div className="pl-4">
          <StrengthMeter score={strength.score} detail={`cracked in ${strength.crackTime}`} />
        </div>
      )}
      {tooShort && <p className="pl-4 text-syn-type">⚠ at least {MIN_LENGTH} characters</p>}
      <Prompt label="confirm master password" value={confirm} onChange={setConfirm} secret />
      {mismatch && <p className="pl-4 text-syn-type">⚠ passwords don’t match</p>}
      {create.isPending && <Spinner>generating vault key and deriving master key…</Spinner>}
      <ErrorLine error={create.error} />
      <p className="mt-2 text-syn-comment italic">
        {'// the master password cannot be recovered if you forget it'}
      </p>
      {valid && !create.isPending && <p className="text-ide-faint">press ↵ to create the vault</p>}
    </TerminalForm>
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
    <TerminalForm onSubmit={() => valid && !join.isPending && join.mutate()}>
      <Command>pm join</Command>
      <p className="text-syn-comment italic">
        {'// on a device with your vault: Sync → Start pairing, then enter what it shows'}
      </p>
      <Prompt
        label="device address"
        value={host}
        onChange={setHost}
        placeholder="100.x.y.z or name.tailnet.ts.net"
        autoFocus
      />
      <Prompt label="port" value={port} onChange={setPort} />
      <Prompt label="pairing code" value={code} onChange={setCode} placeholder="123456" />
      <Prompt label="master password" value={password} onChange={setPassword} secret />
      {join.isPending && <Spinner>pairing and pulling vault…</Spinner>}
      <ErrorLine error={join.error} />
      {valid && !join.isPending && <p className="text-ide-faint">press ↵ to join</p>}
    </TerminalForm>
  )
}
