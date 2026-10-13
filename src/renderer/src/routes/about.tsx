import { createFileRoute } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'

const appInfoQuery = queryOptions({
  queryKey: ['app-info'],
  queryFn: () => window.api.getAppInfo()
})

export const Route = createFileRoute('/about')({
  loader: ({ context }) => context.queryClient.ensureQueryData(appInfoQuery),
  component: AboutPage
})

function AboutPage(): React.JSX.Element {
  const { data } = useSuspenseQuery(appInfoQuery)

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">About</h1>
      <ul className="list-disc pl-5 text-zinc-300">
        <li>
          App: {data.name} v{data.version}
        </li>
        <li>Electron: v{data.electron}</li>
        <li>Chromium: v{data.chrome}</li>
        <li>Node: v{data.node}</li>
      </ul>
    </div>
  )
}
