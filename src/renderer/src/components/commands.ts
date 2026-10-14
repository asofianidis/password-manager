import { useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@renderer/lib/api'
import { MOD, SHIFT } from '@renderer/lib/keys'
import { toast, toastError } from '@renderer/lib/toast'
import { log, openPalette } from '@renderer/lib/workspace'

export interface AppCommand {
  id: string
  category: string
  label: string
  shortcut?: string
  run: () => void
}

export async function runSync(peerId?: string): Promise<void> {
  log('cmd', peerId ? 'Syncing with one device' : 'Syncing with all devices')
  try {
    const [results, settings] = await Promise.all([
      api.invoke('sync:now', peerId),
      api.invoke('settings:get')
    ])
    const names = new Map(settings.sync.peers.map((p) => [p.id, p]))
    for (const r of results) {
      const peer = names.get(r.peerId)
      const target = peer ? peer.name : r.peerId
      if (r.ok) log('ok', `${target}: sent ${r.sent}, received ${r.received}`)
      else log('err', `${target}: ${r.error}`)
    }
    const failed = results.filter((r) => !r.ok).length
    if (failed) toast(`Sync failed for ${failed} device${failed === 1 ? '' : 's'}`, 'error')
    else toast('Sync complete')
  } catch (error) {
    log('err', error instanceof Error ? error.message : String(error))
    toastError(error)
  }
}

async function checkForUpdates(): Promise<void> {
  try {
    const { state, version } = await api.invoke('update:check')
    toast(
      state === 'idle' ? 'You’re on the latest version' : `Version ${version} is available`,
      'info'
    )
  } catch (error) {
    toastError(error)
  }
}

export function useAppCommands(): AppCommand[] {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  return useMemo(
    (): AppCommand[] => [
      {
        id: 'new',
        category: 'Passwords',
        label: 'New Password',
        shortcut: `${MOD}N`,
        run: () => void navigate({ to: '/passwords', search: { id: 'new' } })
      },
      {
        id: 'find',
        category: 'Passwords',
        label: 'Go to Password…',
        shortcut: `${MOD}P`,
        run: () => openPalette('')
      },
      {
        id: 'weak',
        category: 'Passwords',
        label: 'Show Weak Passwords',
        run: () => void navigate({ to: '/passwords', search: { filter: 'weak' } })
      },
      {
        id: 'reused',
        category: 'Passwords',
        label: 'Show Reused Passwords',
        run: () => void navigate({ to: '/passwords', search: { filter: 'reused' } })
      },
      {
        id: 'problems',
        category: 'View',
        label: 'Show Health',
        shortcut: `${MOD}${SHIFT}M`,
        run: () => void navigate({ to: '/' })
      },
      {
        id: 'explorer',
        category: 'View',
        label: 'Show Vault',
        shortcut: `${MOD}${SHIFT}E`,
        run: () => void navigate({ to: '/passwords' })
      },
      {
        id: 'generator',
        category: 'Generator',
        label: 'Generate Password',
        shortcut: `${MOD}${SHIFT}G`,
        run: () => void navigate({ to: '/generator' })
      },
      {
        id: 'sync',
        category: 'Sync',
        label: 'Sync Now',
        run: () => void runSync().then(() => queryClient.invalidateQueries())
      },
      {
        id: 'sync-view',
        category: 'View',
        label: 'Show Sync',
        run: () => void navigate({ to: '/sync' })
      },
      {
        id: 'pair',
        category: 'Sync',
        label: 'Pair a New Device',
        run: () => void navigate({ to: '/sync' })
      },
      {
        id: 'import',
        category: 'File',
        label: 'Import Passwords…',
        run: () => void navigate({ to: '/settings', search: { section: 'data', action: 'import' } })
      },
      {
        id: 'export',
        category: 'File',
        label: 'Export Passwords…',
        run: () => void navigate({ to: '/settings', search: { section: 'data' } })
      },
      {
        id: 'master',
        category: 'Vault',
        label: 'Change Master Password',
        run: () => void navigate({ to: '/settings', search: { section: 'security' } })
      },
      {
        id: 'lock',
        category: 'Vault',
        label: 'Lock Vault',
        shortcut: `${MOD}L`,
        run: () => void api.invoke('vault:lock').catch(toastError)
      },
      {
        id: 'settings',
        category: 'Preferences',
        label: 'Open Settings',
        shortcut: `${MOD},`,
        run: () => void navigate({ to: '/settings' })
      },
      {
        id: 'update',
        category: 'Preferences',
        label: 'Check for Updates',
        run: () => void checkForUpdates()
      }
    ],
    [navigate, queryClient]
  )
}
