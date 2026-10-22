import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'
import { api, queries } from '@renderer/lib/api'
import { toast, toastError } from '@renderer/lib/toast'
import { Button, ErrorText, PasswordInput } from './ui'

/**
 * Shown when another device changed the master password. This device keeps using its current key
 * until the new password is entered, so a bad header from a peer can't lock it out.
 */
export function PendingKeyBanner(): React.JSX.Element | null {
  const queryClient = useQueryClient()
  const { data: status } = useQuery(queries.status())
  const [password, setPassword] = useState('')

  const onStatus = (): Promise<void> => queryClient.invalidateQueries({ queryKey: ['vault'] })
  const adopt = useMutation({
    mutationFn: () => api.invoke('vault:adopt-pending-key', password),
    onSuccess: async () => {
      setPassword('')
      await onStatus()
      toast('Switched to the new master password')
    },
    onError: () => setPassword('')
  })
  const discard = useMutation({
    mutationFn: () => api.invoke('vault:discard-pending-key'),
    onSuccess: onStatus,
    onError: toastError
  })

  if (!status?.pendingKeyChange) return null
  return (
    <div className="mx-8 mt-6 rounded-xl bg-warn/[0.07] p-4 ring-1 ring-warn/25 ring-inset">
      <p className="flex items-center gap-2 font-medium text-bright">
        <KeyRound className="size-4 text-warn" />
        The master password was changed on another device
      </p>
      <p className="mt-1 text-xs text-muted">
        Enter the new master password to keep syncing. Until then this device keeps working with the
        old one. If you didn&apos;t change it, dismiss this.
      </p>
      <form
        className="mt-3 flex max-w-lg gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (password && !adopt.isPending) adopt.mutate()
        }}
      >
        <PasswordInput
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New master password"
          readOnly={adopt.isPending}
        />
        <Button type="submit" variant="primary" disabled={!password || adopt.isPending}>
          {adopt.isPending ? 'Checking…' : 'Switch'}
        </Button>
        <Button variant="ghost" onClick={() => discard.mutate()} disabled={discard.isPending}>
          Dismiss
        </Button>
      </form>
      <div className="mt-2">
        <ErrorText error={adopt.error} />
      </div>
    </div>
  )
}
