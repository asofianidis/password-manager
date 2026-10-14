import { useMemo, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { ChevronRight, FileUp, Plus, Wand2 } from 'lucide-react'
import type { EntrySummary } from '@shared/types'
import { queries } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { entryProblems, type Severity } from '@renderer/lib/problems'
import { Button, Monogram, PageHeader, Segmented } from '@renderer/components/ui'

export const Route = createFileRoute('/_app/')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(queries.health()),
      context.queryClient.ensureQueryData(queries.entries()),
      context.queryClient.ensureQueryData(queries.settings())
    ]),
  component: HealthPage
})

const SEVERITY_TONE: Record<Severity, string> = {
  error: 'bg-danger/10 text-danger',
  warning: 'bg-warn/10 text-warn',
  info: 'bg-info/10 text-info'
}

function scoreTone(score: number): { text: string; stroke: string; label: string } {
  if (score >= 80) return { text: 'text-accent', stroke: 'stroke-accent', label: 'Healthy' }
  if (score >= 50) return { text: 'text-warn', stroke: 'stroke-warn', label: 'Needs attention' }
  return { text: 'text-danger', stroke: 'stroke-danger', label: 'At risk' }
}

function ScoreRing({ score }: { score: number }): React.JSX.Element {
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const tone = scoreTone(score)
  return (
    <div className="relative size-32 shrink-0">
      <svg viewBox="0 0 120 120" className="size-full -rotate-90">
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          strokeWidth="8"
          className="stroke-line-strong"
        />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - score / 100)}
          className={cn(tone.stroke, 'transition-[stroke-dashoffset] duration-700')}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn('text-3xl font-semibold tabular-nums', tone.text)}>{score}</span>
        <span className="text-[11px] text-faint">of 100</span>
      </div>
    </div>
  )
}

type IssueFilter = 'all' | Severity

function HealthPage(): React.JSX.Element {
  const { data: report } = useSuspenseQuery(queries.health())
  const { data: entries } = useSuspenseQuery(queries.entries())
  const { data: settings } = useSuspenseQuery(queries.settings())
  const [show, setShow] = useState<IssueFilter>('all')
  const navigate = useNavigate()

  const withProblems = useMemo(
    () =>
      entries
        .map((entry) => ({
          entry,
          problems: entryProblems(entry).filter((p) => show === 'all' || p.severity === show)
        }))
        .filter((x) => x.problems.length > 0)
        .sort(
          (a, b) => a.entry.score - b.entry.score || a.entry.title.localeCompare(b.entry.title)
        ),
    [entries, show]
  )

  if (report.total === 0) return <EmptyVault />

  const tone = scoreTone(report.score)
  const open = (entry: EntrySummary, fix = false): void =>
    void navigate({
      to: '/passwords',
      search: { id: entry.id, edit: fix || undefined, generate: fix || undefined }
    })

  const stats = [
    {
      label: 'Weak',
      value: report.weak.length,
      hint: 'Easy to guess',
      dot: 'bg-danger',
      filter: 'weak' as const
    },
    {
      label: 'Reused',
      value: report.reused.length,
      hint: 'Shared across sites',
      dot: 'bg-warn',
      filter: 'reused' as const
    },
    {
      label: 'Old',
      value: report.old.length,
      hint: `Unchanged ${settings.oldPasswordDays}+ days`,
      dot: 'bg-info',
      filter: 'old' as const
    },
    {
      label: 'No password',
      value: report.empty.length,
      hint: 'Username or notes only',
      dot: 'bg-faint',
      filter: undefined
    }
  ]

  return (
    <div className="mx-auto max-w-5xl pb-12">
      <PageHeader
        title="Health"
        subtitle={`${report.total} password${report.total === 1 ? '' : 's'} checked locally. Nothing leaves this device.`}
      />

      <div className="grid grid-cols-[auto_1fr] gap-4 px-8">
        <div className="flex items-center gap-6 rounded-xl border border-line bg-raised/60 p-6 pr-10">
          <ScoreRing score={report.score} />
          <div>
            <p className="text-[11px] tracking-wide text-faint uppercase">Vault score</p>
            <p className={cn('mt-1 text-lg font-semibold', tone.text)}>{tone.label}</p>
            <p className="mt-1 max-w-44 text-xs text-muted">
              {report.weak.length + report.reused.length === 0
                ? 'No weak or reused passwords.'
                : `Fix ${report.weak.length + report.reused.length} weak or reused password${report.weak.length + report.reused.length === 1 ? '' : 's'} to raise it.`}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {stats.map((stat) => (
            <Link
              key={stat.label}
              to="/passwords"
              search={stat.filter ? { filter: stat.filter } : {}}
              disabled={!stat.filter}
              className="group flex flex-col justify-between rounded-xl border border-line bg-raised/60 px-5 py-4 transition-colors hover:border-line-strong"
            >
              <span className="flex items-center gap-2 text-xs text-muted">
                <span className={cn('size-1.5 rounded-full', stat.dot)} />
                {stat.label}
                {stat.filter && (
                  <ChevronRight className="ml-auto size-3.5 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                )}
              </span>
              <span className="mt-2 flex items-baseline gap-2">
                <span
                  className={cn(
                    'text-2xl font-semibold tabular-nums',
                    stat.value ? 'text-bright' : 'text-faint'
                  )}
                >
                  {stat.value}
                </span>
                <span className="text-[11px] text-faint">{stat.hint}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-8 px-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium text-bright">Issues</h2>
          <Segmented
            value={show}
            onChange={setShow}
            options={[
              { value: 'all', label: 'All' },
              { value: 'error', label: 'Weak', count: report.weak.length },
              { value: 'warning', label: 'Reused', count: report.reused.length },
              { value: 'info', label: 'Old', count: report.old.length }
            ]}
          />
        </div>
        <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          {withProblems.map(({ entry, problems }) => (
            <div
              key={entry.id}
              onClick={() => open(entry)}
              className="group flex cursor-pointer items-center gap-4 px-4 py-3 transition-colors hover:bg-hover"
            >
              <Monogram title={entry.title} url={entry.url} size="sm" />
              <div className="w-48 min-w-0 shrink-0">
                <p className="truncate text-bright">{entry.title}</p>
                <p className="truncate text-xs text-faint">{entry.username || entry.folder}</p>
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {problems.map((p) => (
                  <span
                    key={p.message}
                    title={p.message}
                    className={cn(
                      'inline-flex max-w-full items-center gap-1.5 truncate rounded-full px-2 py-0.5 text-[11px]',
                      SEVERITY_TONE[p.severity]
                    )}
                  >
                    <p.icon className="size-3 shrink-0" />
                    <span className="truncate">{p.message}</span>
                  </span>
                ))}
              </div>
              {problems.some((p) => p.fixable) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-accent opacity-0 group-hover:opacity-100 hover:text-accent"
                  onClick={(e) => {
                    e.stopPropagation()
                    open(entry, true)
                  }}
                >
                  <Wand2 className="size-3.5" />
                  Fix
                </Button>
              )}
            </div>
          ))}
          {withProblems.length === 0 && (
            <p className="px-4 py-10 text-center text-xs text-muted">
              Nothing to fix here. Nice work.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function EmptyVault(): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 bg-dots text-center">
      <div>
        <p className="text-lg font-semibold text-bright">Start your vault</p>
        <p className="mt-1 text-[13px] text-muted">
          Add a password, or bring everything over from another manager.
        </p>
      </div>
      <div className="flex gap-2">
        <Link to="/passwords" search={{ id: 'new' }}>
          <Button variant="primary">
            <Plus className="size-3.5" strokeWidth={2.5} />
            New password
          </Button>
        </Link>
        <Link to="/settings" search={{ section: 'data', action: 'import' }}>
          <Button>
            <FileUp className="size-3.5" />
            Import from Dashlane, Chrome, Bitwarden…
          </Button>
        </Link>
      </div>
    </div>
  )
}
