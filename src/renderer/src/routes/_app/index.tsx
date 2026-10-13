import { Link, createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  CalendarClock,
  Copy,
  KeyRound,
  ShieldAlert,
  type LucideIcon
} from 'lucide-react'
import type { EntrySummary } from '@shared/types'
import { queries } from '@renderer/lib/api'
import { hostOf, timeAgo } from '@renderer/lib/format'
import { Button, Card, PageHeader, StrengthBadge } from '@renderer/components/ui'
import { cn } from '@renderer/lib/cn'

export const Route = createFileRoute('/_app/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(queries.health()),
  component: DashboardPage
})

type Filter = 'weak' | 'reused' | 'old'

function DashboardPage(): React.JSX.Element {
  const { data: report } = useSuspenseQuery(queries.health())
  const { data: settings } = useSuspenseQuery(queries.settings())

  if (report.total === 0) {
    return (
      <div className="p-8">
        <PageHeader title="Dashboard" />
        <Card>
          <div className="flex flex-col items-center py-10 text-center">
            <KeyRound className="mb-4 size-10 text-zinc-600" />
            <h2 className="text-lg font-semibold">Your vault is empty</h2>
            <p className="mt-1 max-w-sm text-sm text-zinc-400">
              Add your first password, or import from Dashlane, Chrome, Bitwarden, 1Password, and
              more.
            </p>
            <div className="mt-6 flex gap-3">
              <Link to="/passwords" search={{ id: 'new' }}>
                <Button variant="primary">Add password</Button>
              </Link>
              <Link to="/settings" hash="import">
                <Button>Import passwords</Button>
              </Link>
            </div>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-8">
      <PageHeader title="Dashboard" description="An overview of your vault’s health." />

      <div className="grid grid-cols-[16rem_1fr] gap-6">
        <Card className="flex flex-col items-center justify-center">
          <ScoreRing score={report.score} />
          <p className="mt-3 text-sm text-zinc-400">Password health</p>
        </Card>
        <div className="grid grid-cols-2 gap-4">
          <Stat icon={KeyRound} label="Total passwords" value={report.total} />
          <Stat
            icon={ShieldAlert}
            label="Weak passwords"
            value={report.weak.length}
            tone={report.weak.length > 0 ? 'danger' : 'ok'}
            filter="weak"
          />
          <Stat
            icon={Copy}
            label="Reused passwords"
            value={report.reused.length}
            tone={report.reused.length > 0 ? 'warning' : 'ok'}
            filter="reused"
          />
          <Stat
            icon={CalendarClock}
            label={`Older than ${settings.oldPasswordDays} days`}
            value={report.old.length}
            tone={report.old.length > 0 ? 'warning' : 'ok'}
            filter="old"
          />
        </div>
      </div>

      {report.weak.length > 0 && (
        <IssueList
          title="Weak passwords to replace"
          description="These could be guessed quickly. Generate a strong replacement for each."
          entries={report.weak}
          filter="weak"
          detail={(e) => <StrengthBadge score={e.score} />}
        />
      )}
      {report.reused.length > 0 && (
        <IssueList
          title="Reused passwords"
          description="If one of these sites is breached, every account sharing the password is exposed."
          entries={report.reused}
          filter="reused"
          detail={() => <span className="text-xs text-amber-300">Reused</span>}
        />
      )}
      {report.weak.length === 0 && report.reused.length === 0 && (
        <Card>
          <p className="text-sm text-emerald-400">
            No weak or reused passwords. Your vault is in good shape.
          </p>
        </Card>
      )}
    </div>
  )
}

function ScoreRing({ score }: { score: number }): React.JSX.Element {
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const color =
    score >= 80 ? 'stroke-emerald-500' : score >= 50 ? 'stroke-amber-400' : 'stroke-red-500'
  return (
    <div className="relative size-36">
      <svg viewBox="0 0 120 120" className="size-full -rotate-90">
        <circle cx="60" cy="60" r={radius} className="fill-none stroke-zinc-800" strokeWidth="10" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          className={cn('fill-none transition-all', color)}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - score / 100)}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-3xl font-semibold">{score}</span>
      </div>
    </div>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
  tone = 'neutral',
  filter
}: {
  icon: LucideIcon
  label: string
  value: number
  tone?: 'neutral' | 'ok' | 'warning' | 'danger'
  filter?: Filter
}): React.JSX.Element {
  const body = (
    <div
      className={cn(
        'h-full rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 transition-colors',
        filter && 'hover:border-zinc-700 hover:bg-zinc-900'
      )}
    >
      <div className="flex items-center gap-2 text-sm text-zinc-400">
        <Icon className="size-4" />
        {label}
      </div>
      <p
        className={cn(
          'mt-2 text-3xl font-semibold',
          tone === 'danger' && 'text-red-400',
          tone === 'warning' && 'text-amber-300',
          tone === 'ok' && 'text-emerald-400'
        )}
      >
        {value}
      </p>
    </div>
  )
  return filter ? (
    <Link to="/passwords" search={{ filter }}>
      {body}
    </Link>
  ) : (
    body
  )
}

function IssueList({
  title,
  description,
  entries,
  filter,
  detail
}: {
  title: string
  description: string
  entries: EntrySummary[]
  filter: Filter
  detail: (entry: EntrySummary) => React.ReactNode
}): React.JSX.Element {
  const shown = entries.slice(0, 6)
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-amber-300" />
          {title}
        </span>
      }
      description={description}
      actions={
        entries.length > shown.length && (
          <Link
            to="/passwords"
            search={{ filter }}
            className="text-sm text-emerald-400 hover:underline"
          >
            View all {entries.length}
          </Link>
        )
      }
    >
      <ul className="divide-y divide-zinc-800">
        {shown.map((entry) => (
          <li key={entry.id} className="flex items-center gap-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{entry.title}</p>
              <p className="truncate text-xs text-zinc-500">
                {entry.username || hostOf(entry.url)} · changed {timeAgo(entry.passwordUpdatedAt)}
              </p>
            </div>
            {detail(entry)}
            <Link to="/passwords" search={{ id: entry.id, edit: true }}>
              <Button size="sm">Change</Button>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}
