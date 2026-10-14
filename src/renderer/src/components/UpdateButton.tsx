import { useQuery } from '@tanstack/react-query'
import { Download, LoaderCircle, RotateCw } from 'lucide-react'
import { api, queries } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { isMac } from '@renderer/lib/keys'
import { toastError } from '@renderer/lib/toast'

/** Shown only while a newer release is available; renders nothing otherwise. */
export function UpdateButton({ className }: { className?: string }): React.JSX.Element | null {
  const { data: update } = useQuery(queries.update())
  if (!update || update.state === 'idle') return null

  const { state, version, progress, error } = update
  const label =
    state === 'ready'
      ? `Restart to update to v${version}`
      : state === 'downloading'
        ? `Downloading v${version}… ${progress ?? 0}%`
        : `Update to v${version}`
  const title =
    error ??
    (state === 'ready'
      ? 'Restart the app and install the update'
      : isMac
        ? 'Open the release page to download the update'
        : 'Download the update')
  const Icon = state === 'ready' ? RotateCw : state === 'downloading' ? LoaderCircle : Download

  return (
    <button
      onClick={() => void api.invoke('update:install').catch(toastError)}
      disabled={state === 'downloading'}
      title={title}
      className={cn(
        'flex h-8 items-center gap-2 rounded-lg bg-accent/10 px-2.5 text-xs font-medium text-accent ring-1 ring-accent/25 ring-inset hover:bg-accent/15 disabled:cursor-default',
        error && 'bg-danger/10 text-danger ring-danger/25',
        className
      )}
    >
      <Icon className={cn('size-3.5 shrink-0', state === 'downloading' && 'animate-spin')} />
      <span className="truncate">{label}</span>
    </button>
  )
}
