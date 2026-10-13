import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { CircleDot, Network, Plus, RefreshCw, Smartphone, Trash2 } from 'lucide-react'
import type { SettingsPatch, TailscalePeer } from '@shared/types'
import { api, queries } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { timeAgo } from '@renderer/lib/format'
import { toast, toastError } from '@renderer/lib/toast'
import { log, syncLogStore } from '@renderer/lib/workspace'
import { runSync } from '@renderer/components/commands'
import { Terminal } from '@renderer/components/Terminal'
import {
  Badge,
  Breadcrumbs,
  Button,
  Checkbox,
  ErrorText,
  Field,
  Input,
  Modal,
  Section,
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
  [0, 'off'],
  [5, 'every 5 minutes'],
  [15, 'every 15 minutes'],
  [60, 'every hour']
] as const

function SyncPage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const { data: settings } = useSuspenseQuery(queries.settings())
  const { data: status } = useSuspenseQuery(queries.syncStatus())
  const logLines = syncLogStore.use()
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
    <div className="flex h-full flex-col">
      <Breadcrumbs
        path={['vault', 'sync']}
        actions={
          sync.peers.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => syncNow.mutate(undefined)}
              disabled={busy}
            >
              <RefreshCw className={cn('size-3.5', busy && 'animate-spin')} />
              Sync all
            </Button>
          )
        }
      />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        <p className="text-xs text-syn-comment">
          {
            '// devices sync peer-to-peer (no cloud). payloads are end-to-end encrypted with your vault key.'
          }
          <br />
          {'// use a Tailscale tailnet or a trusted LAN. both devices must be unlocked to sync.'}
        </p>

        <Section
          title="Remotes"
          description="devices this one pushes to and pulls from"
          actions={
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="size-3.5" />
              Add remote
            </Button>
          }
        >
          {sync.peers.length === 0 ? (
            <p className="text-xs text-ide-muted">
              No remotes. Add one, or pair a new device below.
            </p>
          ) : (
            <table className="w-full text-[13px]">
              <tbody>
                {sync.peers.map((peer) => (
                  <tr key={peer.id} className="group hover:bg-ide-hover">
                    <td className="w-5 py-1">
                      <CircleDot
                        className={cn(
                          'size-3.5',
                          peer.lastError
                            ? 'text-syn-prop'
                            : peer.lastSyncAt
                              ? 'text-syn-string'
                              : 'text-ide-faint'
                        )}
                      />
                    </td>
                    <td className="py-1 pr-4 text-syn-fn">{peer.name}</td>
                    <td className="py-1 pr-4 text-ide-muted">
                      {peer.host}:{peer.port}
                    </td>
                    <td className="truncate py-1 text-xs">
                      {peer.lastError ? (
                        <span className="text-syn-prop">{peer.lastError}</span>
                      ) : (
                        <span className="text-ide-muted">synced {timeAgo(peer.lastSyncAt)}</span>
                      )}
                    </td>
                    <td className="w-24 py-1 text-right">
                      <span className="opacity-0 group-hover:opacity-100">
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Sync"
                          onClick={() => syncNow.mutate(peer.id)}
                          disabled={busy}
                        >
                          <RefreshCw className="size-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Remove remote"
                          onClick={() => {
                            log('cmd', `pm remote remove ${peer.name}`)
                            removePeer.mutate(peer.id)
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <div className="grid grid-cols-2 gap-4">
          <Section
            title="This device"
            description="accept connections from your other devices"
            actions={
              <Badge tone={status.serverRunning ? 'success' : 'neutral'}>
                {!status.serverRunning
                  ? 'stopped'
                  : sync.serverEnabled
                    ? 'listening'
                    : 'pairing only'}
              </Badge>
            }
          >
            <div className="space-y-3">
              <Checkbox
                label="Accept sync connections"
                description="required for other devices to sync with or pair to this one"
                checked={sync.serverEnabled}
                onChange={(serverEnabled) => {
                  log('cmd', `pm serve ${serverEnabled ? '--start' : '--stop'}`)
                  update.mutate({ sync: { serverEnabled } })
                }}
              />
              <div className="grid grid-cols-[1fr_6rem] gap-2">
                <Field
                  label="listen address"
                  hint="your Tailscale IP limits connections to your tailnet"
                >
                  <Input
                    defaultValue={sync.bindAddress}
                    onBlur={(e) =>
                      e.target.value.trim() !== sync.bindAddress &&
                      update.mutate({ sync: { bindAddress: e.target.value.trim() || '0.0.0.0' } })
                    }
                  />
                </Field>
                <Field label="port">
                  <Input
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
                <div className="text-xs">
                  <span className="text-ide-muted">reachable at</span>
                  {status.listenAddresses.map((address) => (
                    <div key={address} className="text-ide-fg select-text">
                      {address}
                      {address.startsWith('100.') && (
                        <span className="ml-2 text-syn-string">tailscale</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <Field label="auto sync">
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
          </Section>
          <PairingSection />
        </div>
      </div>

      <Terminal className="h-48" lines={logLines} />

      {adding && <AddRemoteModal defaultPort={sync.port} onClose={() => setAdding(false)} />}
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

function PairingSection(): React.JSX.Element {
  const queryClient = useQueryClient()
  const { data: status } = useSuspenseQuery(queries.syncStatus())
  const remaining = useCountdown(status.pairing?.expiresAt ?? null)

  const onStatus = (next: typeof status): void => {
    queryClient.setQueryData(queries.syncStatus().queryKey, next)
  }
  const start = useMutation({
    mutationFn: () => api.invoke('sync:start-pairing'),
    onMutate: () => log('cmd', 'pm pair --start'),
    onSuccess: (next) => {
      onStatus(next)
      log('info', `pairing open for 5 minutes on ${next.listenAddresses.join(', ')}`)
    },
    onError: (error) => {
      log('err', error.message)
      toastError(error)
    }
  })
  const stop = useMutation({
    mutationFn: () => api.invoke('sync:stop-pairing'),
    onMutate: () => log('cmd', 'pm pair --stop'),
    onSuccess: onStatus
  })

  useEffect(() => {
    if (status.pairing && remaining === 0) void queryClient.invalidateQueries(queries.syncStatus())
  }, [remaining, status.pairing, queryClient])

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <Smartphone className="size-3.5" />
          Pair a new device
        </span>
      }
      description="set up your vault on another computer or phone"
    >
      {status.pairing ? (
        <div className="space-y-3">
          <p className="text-xs text-ide-muted">
            On the new device run <span className="text-ide-fg">pm join</span> with one of the
            addresses shown and this code:
          </p>
          <p className="text-4xl font-semibold tracking-[0.3em] text-syn-string select-text">
            {status.pairing.code}
          </p>
          <p className="text-xs text-syn-comment">
            {`// expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')} · the new device still needs your master password`}
          </p>
          <Button size="sm" onClick={() => stop.mutate()}>
            Cancel pairing
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-ide-muted">
            Opens a 5-minute window and shows a one-time code. Sync connections are accepted
            temporarily if they are off.
          </p>
          <Button onClick={() => start.mutate()} disabled={start.isPending}>
            Start pairing
          </Button>
        </div>
      )}
    </Section>
  )
}

function AddRemoteModal({
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
      log('cmd', `pm remote add ${peer.name} ${peer.host}:${peer.port}`)
      await queryClient.invalidateQueries(queries.settings())
      toast(`Added remote ${peer.name}`)
      onClose()
    }
  })

  const choose = (peer: TailscalePeer): void => {
    setName(peer.name)
    setHost(peer.dnsName || peer.ips[0])
  }

  return (
    <Modal title="pm remote add" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          add.mutate()
        }}
      >
        <div className="border border-ide-border">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="flex items-center gap-2 text-xs text-ide-muted">
              <Network className="size-3.5" />
              tailscale devices
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void tailscale.refetch()}
              disabled={tailscale.isFetching}
            >
              {tailscale.isFetching ? 'scanning…' : tailscale.data ? 'refresh' : 'scan tailnet'}
            </Button>
          </div>
          {tailscale.error && (
            <div className="px-2 pb-2">
              <ErrorText error={tailscale.error} />
            </div>
          )}
          {tailscale.data && (
            <ul className="max-h-40 overflow-y-auto border-t border-ide-border py-1">
              {tailscale.data
                .filter((p) => !p.self)
                .map((peer) => (
                  <li key={peer.dnsName || peer.ips[0]}>
                    <button
                      type="button"
                      onClick={() => choose(peer)}
                      className="flex w-full items-center gap-2 px-2 py-0.5 text-left text-xs hover:bg-ide-hover"
                    >
                      <span
                        className={cn(
                          'size-1.5 rounded-full',
                          peer.online ? 'bg-syn-string' : 'bg-ide-faint'
                        )}
                      />
                      <span className="flex-1 truncate">{peer.name}</span>
                      <span className="text-ide-muted">{peer.ips[0]}</span>
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
        <Field label="name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="work-laptop" />
        </Field>
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <Field label="address" hint="Tailscale IP, MagicDNS name, or LAN IP">
            <Input value={host} onChange={(e) => setHost(e.target.value)} />
          </Field>
          <Field label="port">
            <Input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" />
          </Field>
        </div>
        <ErrorText error={add.error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={!host.trim() || add.isPending}>
            Add remote
          </Button>
        </div>
      </form>
    </Modal>
  )
}
