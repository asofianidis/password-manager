import { createFileRoute } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'

export const Route = createFileRoute('/')({
  component: HomePage
})

function HomePage(): React.JSX.Element {
  const ping = useMutation({ mutationFn: () => window.api.ping() })

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Password Manager</h1>
      <p className="text-zinc-400">
        Electron + React + TanStack Router + TanStack Query + Tailwind
      </p>
      <button
        className="rounded-md border border-zinc-700 bg-zinc-800 px-3.5 py-1.5 font-semibold hover:bg-zinc-700 disabled:opacity-50"
        onClick={() => ping.mutate()}
        disabled={ping.isPending}
      >
        Ping main process
      </button>
      {ping.data && <p>Main process replied: {ping.data}</p>}
    </div>
  )
}
