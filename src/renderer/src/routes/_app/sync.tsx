import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  Check,
  Info,
  Laptop,
  Network,
  Plus,
  RefreshCw,
  Smartphone,
  Trash2,
  X
} from 'lucide-react'
import type { SettingsPatch, TailscalePeer } from '@shared/types'
import { api, queries } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { timeAgo } from '@renderer/lib/format'
import { toast, toastError } from '@renderer/lib/toast'
import { log, syncLogStore, type LogLine } from '@renderer/lib/workspace'
import { runSync } from '@renderer/components/commands'
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ErrorText,
  Field,
  Input,
  Modal,
  PageHeader,
  Select
} from '@renderer/components/ui'

export const Route = createFileRoute('/_app/sync')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(queries.settings()),
      context.queryClient.ensureQueryData(queries.syncStatus())
    ]),
  component: SyncPage
})

const AUTO_SYNC_OPTIONS = [
  [0, 'Off'],
  [5, 'Every 5 minutes'],
  [15, 'Every 15 minutes'],
  [60, 'Every hour']
] as const

function SyncPage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const { data: settings } = useSuspenseQuery(queries.settings())
  const { data: status } = useSuspenseQuery(queries.syncStatus())
  const [adding, setAdding] = useState(false)

  const update = useMutation({
    mutationFn: (patch: SettingsPatch) => api.invoke('settings:update', patch),
    onSuccess: (next) => {
      queryClient.setQueryData(queries.settings().queryKey, next)
      void queryClient.invalidateQueries({ queryKey: ['sync'] })
    },
    onError: toastError
  })

  const syncNow = useMutation({
    mutationFn: (peerId?: string) => runSync(peerId),
    onSettled: () => queryClient.invalidateQueries()
  })

  const removePeer = useMutation({
    mutationFn: (id: string) => api.invoke('sync:remove-peer', id),
    onSuccess: () => queryClient.invalidateQueries(queries.settings()),
    onError: toastError
  })

  const { sync } = settings
  const busy = syncNow.isPending || status.syncing

  return (
    <div className="mx-auto max-w-5xl pb-12">
      <PageHeader
        title="Sync"
        subtitle="Peer-to-peer over Tailscale or your LAN. End-to-end encrypted, no cloud."
        actions={
          <>
            <Button onClick={() => setAdding(true)}>
              <Plus className="size-3.5" />
              Add device
            </Button>
            {sync.peers.length > 0 && (
              <Button variant="primary" onClick={() => syncNow.mutate(undefined)} disabled={busy}>
                <RefreshCw className={cn('size-3.5', busy && 'animate-spin')} />
                Sync now
              </Button>
            )}
          </>
        }
      />

      <div className="space-y-4 px-8">
        <Card
          title="Devices"
          description="This device pushes to and pulls from these. Both ends must be unlocked."
          bodyClassName="p-2"
        >
          {sync.peers.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted">
              No devices yet. Add one, or pair a new device below.
            </p>
          ) : (
            sync.peers.map((peer) => (
              <div
                key={peer.id}
                className="group flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-hover"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-canvas ring-1 ring-line ring-inset">
                  <Laptop className="size-4 text-muted" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2">
                    <span className="text-bright">{peer.name}</span>
                    <span className="font-mono text-xs text-faint">
                      {peer.host}:{peer.port}
                    </span>
                  </p>
                  <p
                    className={cn(
                      'truncate text-xs',
                      peer.lastError ? 'text-danger' : 'text-muted'
                    )}
                  >
                    {peer.lastError ?? `Synced ${timeAgo(peer.lastSyncAt)}`}
                  </p>
                </div>
                <span
                  className={cn(
                    'size-2 rounded-full',
                    peer.lastError ? 'bg-danger' : peer.lastSyncAt ? 'bg-ok' : 'bg-faint'
                  )}
                />
                <span className="flex opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Sync with this device"
                    onClick={() => syncNow.mutate(peer.id)}
                    disabled={busy}
                  >
                    <RefreshCw className="size-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Remove device"
                    onClick={() => {
                      log('cmd', `Removed ${peer.name}`)
                      removePeer.mutate(peer.id)
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </span>
              </div>
            ))
          )}
        </Card>

        <div className="grid grid-cols-2 gap-4">
          <Card
            title="This device"
            description="Accept connections from your other devices"
            actions={
              <Badge tone={status.serverRunning ? 'success' : 'neutral'}>
                <span
                  className={cn(
                    'size-1.5 rounded-full',
                    status.serverRunning ? 'bg-ok' : 'bg-faint'
                  )}
                />
                {!status.serverRunning
                  ? 'Stopped'
                  : sync.serverEnabled
                    ? 'Listening'
                    : 'Pairing only'}
              </Badge>
            }
          >
            <div className="space-y-4">
              <Checkbox
                label="Accept sync connections"
                description="Needed for other devices to sync with or pair to this one"
                checked={sync.serverEnabled}
                onChange={(serverEnabled) => {
                  log('cmd', serverEnabled ? 'Started listening' : 'Stopped listening')
                  update.mutate({ sync: { serverEnabled } })
                }}
              />
              <div className="grid grid-cols-[1fr_6rem] gap-3">
                <Field
                  label="Listen address"
                  hint="Use your Tailscale IP to limit it to your tailnet"
                >
                  <Input
                    className="font-mono"
                    defaultValue={sync.bindAddress}
                    onBlur={(e) =>
                      e.target.value.trim() !== sync.bindAddress &&
                      update.mutate({ sync: { bindAddress: e.target.value.trim() || '0.0.0.0' } })
                    }
                  />
                </Field>
                <Field label="Port">
                  <Input
                    className="font-mono"
                    defaultValue={sync.port}
                    inputMode="numeric"
                    onBlur={(e) =>
                      Number(e.target.value) !== sync.port &&
                      update.mutate({ sync: { port: Number(e.target.value) } })
                    }
                  />
                </Field>
              </div>
              {status.serverError && <ErrorText error={status.serverError} />}
              {status.listenAddresses.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted">Reachable at</p>
                  <div className="flex flex-wrap gap-1.5">
                    {status.listenAddresses.map((address) => (
                      <span
                        key={address}
                        className="inline-flex items-center gap-1.5 rounded-md bg-canvas px-2 py-1 font-mono text-xs text-fg ring-1 ring-line select-text ring-inset"
                      >
                        {address}
                        {address.startsWith('100.') && (
                          <span className="font-sans text-[10px] text-accent">tailscale</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <Field label="Auto sync">
                <Select
                  value={sync.autoSyncMinutes}
                  onChange={(e) =>
                    update.mutate({ sync: { autoSyncMinutes: Number(e.target.value) } })
                  }
                >
                  {AUTO_SYNC_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </Card>
          <PairingCard />
        </div>

        <ActivityCard />
      </div>

      {adding && <AddDeviceModal defaultPort={sync.port} onClose={() => setAdding(false)} />}
    </div>
  )
}

const LOG_ICON: Record<LogLine['kind'], { icon: typeof Check; className: string }> = {
  cmd: { icon: ArrowRight, className: 'text-muted' },
  ok: { icon: Check, className: 'text-ok' },
  err: { icon: X, className: 'text-danger' },
  info: { icon: Info, className: 'text-info' }
}

function ActivityCard(): React.JSX.Element {
  const lines = syncLogStore.use()
  return (
    <Card title="Activity" description="This session only" bodyClassName="px-2 pb-2 pt-3">
      {lines.length === 0 ? (
        <p className="px-3 pb-2 text-xs text-faint">Nothing yet.</p>
      ) : (
        <ol className="max-h-60 overflow-y-auto">
          {[...lines].reverse().map((line) => {
            const { icon: Icon, className } = LOG_ICON[line.kind]
            return (
              <li key={line.id} className="flex items-start gap-3 rounded-lg px-3 py-1.5 text-xs">
                <span className="w-16 shrink-0 font-mono text-faint tabular-nums">
                  {new Date(line.at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                  })}
                </span>
                <Icon className={cn('mt-px size-3.5 shrink-0', className)} />
                <span
                  className={cn(
                    'min-w-0 break-words select-text',
                    line.kind === 'err' ? 'text-danger' : 'text-fg'
                  )}
                >
                  {line.text}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </Card>
  )
}

function useCountdown(expiresAt: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!expiresAt) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [expiresAt])
  return expiresAt ? Math.max(0, Math.round((expiresAt - now) / 1000)) : 0
}

function PairingCard(): React.JSX.Element {
  const queryClient = useQueryClient()
  const { data: status } = useSuspenseQuery(queries.syncStatus())
  const remaining = useCountdown(status.pairing?.expiresAt ?? null)

  const onStatus = (next: typeof status): void => {
    queryClient.setQueryData(queries.syncStatus().queryKey, next)
  }
  const start = useMutation({
    mutationFn: () => api.invoke('sync:start-pairing'),
    onMutate: () => log('cmd', 'Opened pairing'),
    onSuccess: (next) => {
      onStatus(next)
      log('info', `Pairing open for 5 minutes on ${next.listenAddresses.join(', ')}`)
    },
    onError: (error) => {
      log('err', error.message)
      toastError(error)
    }
  })
  const stop = useMutation({
    mutationFn: () => api.invoke('sync:stop-pairing'),
    onMutate: () => log('cmd', 'Closed pairing'),
    onSuccess: onStatus
  })

  useEffect(() => {
    if (status.pairing && remaining === 0) void queryClient.invalidateQueries(queries.syncStatus())
  }, [remaining, status.pairing, queryClient])

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Smartphone className="size-4 text-accent" />
          Pair a new device
        </span>
      }
      description="Set up your vault on another computer"
    >
      {status.pairing ? (
        <div className="space-y-4">
          <p className="text-xs text-muted">
            On the new device, choose <span className="text-fg">Join an existing vault</span> and
            enter one of this device&apos;s addresses with this code:
          </p>
          <div className="flex gap-1.5">
            {[...status.pairing.code].map((digit, i) => (
              <span
                key={i}
                className="flex h-14 w-11 items-center justify-center rounded-lg bg-canvas font-mono text-2xl font-semibold text-accent ring-1 ring-accent/30 select-text ring-inset"
              >
                {digit}
              </span>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted">
              Expires in{' '}
              <span className="font-mono text-fg tabular-nums">
                {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
              </span>
              . The new device still needs your master password.
            </p>
            <Button size="sm" onClick={() => stop.mutate()}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-muted">
            Opens a 5-minute window and shows a one-time code. Sync connections are accepted
            temporarily if they are off.
          </p>
          <Button variant="primary" onClick={() => start.mutate()} disabled={start.isPending}>
            Start pairing
          </Button>
        </div>
      )}
    </Card>
  )
}

function AddDeviceModal({
  defaultPort,
  onClose
}: {
  defaultPort: number
  onClose: () => void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState(String(defaultPort))

  const tailscale = useQuery({
    queryKey: ['sync', 'tailscale'],
    queryFn: () => api.invoke('sync:tailscale-peers'),
    enabled: false
  })

  const add = useMutation({
    mutationFn: () => api.invoke('sync:add-peer', { name, host, port: Number(port) }),
    onSuccess: async (peer) => {
      log('cmd', `Added ${peer.name} (${peer.host}:${peer.port})`)
      await queryClient.invalidateQueries(queries.settings())
      toast(`Added ${peer.name}`)
      onClose()
    }
  })

  const choose = (peer: TailscalePeer): void => {
    setName(peer.name)
    setHost(peer.dnsName || peer.ips[0])
  }

  return (
    <Modal
      title="Add a device"
      description="Sync with a device that already has this vault."
      onClose={onClose}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          add.mutate()
        }}
      >
        <div className="overflow-hidden rounded-xl border border-line">
          <div className="flex items-center justify-between py-1.5 pr-1.5 pl-3">
            <span className="flex items-center gap-2 text-xs text-muted">
              <Network className="size-3.5" />
              Tailscale devices
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void tailscale.refetch()}
              disabled={tailscale.isFetching}
            >
              {tailscale.isFetching ? 'Scanning…' : tailscale.data ? 'Refresh' : 'Scan tailnet'}
            </Button>
          </div>
          {tailscale.error && (
            <div className="px-3 pb-2">
              <ErrorText error={tailscale.error} />
            </div>
          )}
          {tailscale.data && (
            <ul className="max-h-40 overflow-y-auto border-t border-line p-1">
              {tailscale.data
                .filter((p) => !p.self)
                .map((peer) => (
                  <li key={peer.dnsName || peer.ips[0]}>
                    <button
                      type="button"
                      onClick={() => choose(peer)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-hover"
                    >
                      <span
                        className={cn('size-1.5 rounded-full', peer.online ? 'bg-ok' : 'bg-faint')}
                      />
                      <span className="flex-1 truncate text-fg">{peer.name}</span>
                      <span className="font-mono text-faint">{peer.ips[0]}</span>
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="work-laptop" />
        </Field>
        <div className="grid grid-cols-[1fr_6rem] gap-3">
          <Field label="Address" hint="Tailscale IP, MagicDNS name, or LAN IP">
            <Input className="font-mono" value={host} onChange={(e) => setHost(e.target.value)} />
          </Field>
          <Field label="Port">
            <Input
              className="font-mono"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              inputMode="numeric"
            />
          </Field>
        </div>
        <ErrorText error={add.error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!host.trim() || add.isPending}>
            Add device
          </Button>
        </div>
      </form>
    </Modal>
  )
}
