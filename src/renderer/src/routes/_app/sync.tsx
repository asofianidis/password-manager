import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import {
  CheckCircle2,
  Laptop,
  Network,
  Plus,
  RefreshCw,
  Smartphone,
  Trash2,
  XCircle
} from 'lucide-react'
import type { SettingsPatch, TailscalePeer } from '@shared/types'
import { api, queries } from '@renderer/lib/api'
import { timeAgo } from '@renderer/lib/format'
import { toast, toastError } from '@renderer/lib/toast'
import {
  Badge,
  Button,
  Card,
  ErrorText,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Toggle
} from '@renderer/components/ui'
import { cn } from '@renderer/lib/cn'

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
    mutationFn: (peerId?: string) => api.invoke('sync:now', peerId),
    onSuccess: (results) => {
      const failed = results.filter((r) => !r.ok)
      if (failed.length === 0) {
        const received = results.reduce((sum, r) => sum + r.received, 0)
        toast(
          received > 0 ? `Synced · ${received} change(s) received` : 'Synced · already up to date'
        )
      } else {
        toast(`${failed.length} device(s) failed to sync`, 'error')
      }
    },
    onError: toastError,
    onSettled: () => queryClient.invalidateQueries(queries.settings())
  })

  const removePeer = useMutation({
    mutationFn: (id: string) => api.invoke('sync:remove-peer', id),
    onSuccess: () => queryClient.invalidateQueries(queries.settings()),
    onError: toastError
  })

  const { sync } = settings

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <PageHeader
        title="Sync"
        description="Devices sync directly with each other. Nothing is sent to a cloud server."
        actions={
          sync.peers.length > 0 && (
            <Button
              variant="primary"
              onClick={() => syncNow.mutate(undefined)}
              disabled={syncNow.isPending || status.syncing}
            >
              <RefreshCw
                className={cn('size-4', (syncNow.isPending || status.syncing) && 'animate-spin')}
              />
              Sync now
            </Button>
          )
        }
      />

      <Card title="How it works">
        <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-400">
          <li>
            Each device can listen for sync requests from your other devices. Put them on the same{' '}
            <b className="text-zinc-200">Tailscale</b> tailnet (recommended) or the same trusted
            network.
          </li>
          <li>
            Every message is end-to-end encrypted with your vault key, so only devices that have
            your vault can read or send changes.
          </li>
          <li>Both devices must be unlocked while they sync.</li>
        </ul>
      </Card>

      <Card
        title="This device"
        description="Let your other devices connect to this one."
        actions={
          <Badge tone={status.serverRunning ? 'success' : 'neutral'}>
            {!status.serverRunning
              ? 'Not listening'
              : sync.serverEnabled
                ? 'Listening'
                : 'Listening for pairing only'}
          </Badge>
        }
      >
        <div className="space-y-5">
          <Toggle
            label="Accept sync connections"
            description="Required for other devices to sync with or pair to this one."
            checked={sync.serverEnabled}
            onChange={(serverEnabled) => update.mutate({ sync: { serverEnabled } })}
          />
          <div className="grid grid-cols-[1fr_8rem] gap-3">
            <Field
              label="Listen on"
              hint="Use your Tailscale IP to only accept connections from your tailnet."
            >
              <Input
                defaultValue={sync.bindAddress}
                onBlur={(e) =>
                  e.target.value.trim() !== sync.bindAddress &&
                  update.mutate({ sync: { bindAddress: e.target.value.trim() || '0.0.0.0' } })
                }
                className="font-mono"
              />
            </Field>
            <Field label="Port">
              <Input
                defaultValue={sync.port}
                inputMode="numeric"
                onBlur={(e) =>
                  Number(e.target.value) !== sync.port &&
                  update.mutate({ sync: { port: Number(e.target.value) } })
                }
                className="font-mono"
              />
            </Field>
          </div>
          {status.serverError && <p className="text-sm text-red-400">{status.serverError}</p>}
          {status.listenAddresses.length > 0 && (
            <div>
              <p className="mb-1.5 text-sm font-medium text-zinc-300">Reachable at</p>
              <div className="flex flex-wrap gap-2">
                {status.listenAddresses.map((address) => (
                  <code
                    key={address}
                    className="rounded-md bg-zinc-950 px-2 py-1 text-xs text-zinc-300"
                  >
                    {address}
                    {address.startsWith('100.') && (
                      <span className="ml-1.5 text-emerald-400">tailscale</span>
                    )}
                  </code>
                ))}
              </div>
            </div>
          )}
          <Field label="Automatic sync">
            <Select
              value={sync.autoSyncMinutes}
              onChange={(e) => update.mutate({ sync: { autoSyncMinutes: Number(e.target.value) } })}
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

      <Card
        title="Devices"
        description="Devices this one syncs with."
        actions={
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" />
            Add device
          </Button>
        }
      >
        {sync.peers.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-500">No devices yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {sync.peers.map((peer) => (
              <li key={peer.id} className="flex items-center gap-4 py-3">
                <Laptop className="size-5 text-zinc-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{peer.name}</p>
                  <p className="truncate font-mono text-xs text-zinc-500">
                    {peer.host}:{peer.port}
                  </p>
                  {peer.lastError ? (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-red-400">
                      <XCircle className="size-3" /> {peer.lastError}
                    </p>
                  ) : (
                    peer.lastSyncAt && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-emerald-400">
                        <CheckCircle2 className="size-3" /> Synced {timeAgo(peer.lastSyncAt)}
                      </p>
                    )
                  )}
                </div>
                <Button
                  size="sm"
                  onClick={() => syncNow.mutate(peer.id)}
                  disabled={syncNow.isPending || status.syncing}
                >
                  Sync
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => removePeer.mutate(peer.id)}
                  aria-label="Remove device"
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {adding && <AddPeerModal defaultPort={sync.port} onClose={() => setAdding(false)} />}
    </div>
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
    onSuccess: onStatus,
    onError: toastError
  })
  const stop = useMutation({
    mutationFn: () => api.invoke('sync:stop-pairing'),
    onSuccess: onStatus
  })

  useEffect(() => {
    if (status.pairing && remaining === 0) void queryClient.invalidateQueries(queries.syncStatus())
  }, [remaining, status.pairing, queryClient])

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Smartphone className="size-4" />
          Pair a new device
        </span>
      }
      description="Set up your vault on another computer or your phone."
    >
      {status.pairing ? (
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">
            On the new device choose <b className="text-zinc-200">Join from device</b>, then enter
            one of the addresses above and this code:
          </p>
          <p className="font-mono text-4xl font-semibold tracking-[0.3em] text-emerald-400">
            {status.pairing.code}
          </p>
          <div className="flex items-center justify-between">
            <p className="text-xs text-zinc-500">
              Expires in {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}. The
              new device still needs your master password.
            </p>
            <Button size="sm" onClick={() => stop.mutate()}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button onClick={() => start.mutate()} disabled={start.isPending}>
          Start pairing
        </Button>
      )}
    </Card>
  )
}

function AddPeerModal({
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
    onSuccess: async () => {
      await queryClient.invalidateQueries(queries.settings())
      toast('Device added')
      onClose()
    }
  })

  const choose = (peer: TailscalePeer): void => {
    setName(peer.name)
    setHost(peer.dnsName || peer.ips[0])
  }

  return (
    <Modal title="Add device" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          add.mutate()
        }}
      >
        <div className="rounded-lg border border-zinc-800 p-3">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Network className="size-4" />
              Tailscale devices
            </p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void tailscale.refetch()}
              disabled={tailscale.isFetching}
            >
              {tailscale.isFetching ? 'Looking…' : tailscale.data ? 'Refresh' : 'Find devices'}
            </Button>
          </div>
          <ErrorText error={tailscale.error} />
          {tailscale.data && (
            <ul className="mt-2 max-h-48 overflow-y-auto">
              {tailscale.data
                .filter((p) => !p.self)
                .map((peer) => (
                  <li key={peer.dnsName || peer.ips[0]}>
                    <button
                      type="button"
                      onClick={() => choose(peer)}
                      className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-zinc-800"
                    >
                      <span
                        className={cn(
                          'size-2 rounded-full',
                          peer.online ? 'bg-emerald-500' : 'bg-zinc-600'
                        )}
                      />
                      <span className="flex-1 truncate">{peer.name}</span>
                      <span className="font-mono text-xs text-zinc-500">{peer.ips[0]}</span>
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Work laptop" />
        </Field>
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Field label="Address" hint="Tailscale IP, MagicDNS name, or LAN IP">
            <Input value={host} onChange={(e) => setHost(e.target.value)} className="font-mono" />
          </Field>
          <Field label="Port">
            <Input
              value={port}
              onChange={(e) => setPort(e.target.value)}
              inputMode="numeric"
              className="font-mono"
            />
          </Field>
        </div>
        <ErrorText error={add.error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={!host.trim() || add.isPending}>
            Add device
          </Button>
        </div>
      </form>
    </Modal>
  )
}
