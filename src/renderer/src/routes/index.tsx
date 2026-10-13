import { createFileRoute } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'

export const Route = createFileRoute('/')({
  component: HomePage
})

function HomePage(): React.JSX.Element {
  const ping = useMutation({ mutationFn: () => window.api.ping() })

  return (
    <div>
      <h1>Password Manager</h1>
      <p>Electron + React + TanStack Router + TanStack Query</p>
      <button onClick={() => ping.mutate()} disabled={ping.isPending}>
        Ping main process
      </button>
      {ping.data && <p>Main process replied: {ping.data}</p>}
    </div>
  )
}
