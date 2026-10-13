import { useMemo, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, FileKey2, FilePlus2, FileUp } from 'lucide-react'
import type { EntrySummary } from '@shared/types'
import { queries } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { identifier } from '@renderer/lib/format'
import { SEVERITY_STYLE, entryProblems, type Severity } from '@renderer/lib/problems'
import { Breadcrumbs, Button, PanelHeader } from '@renderer/components/ui'

export const Route = createFileRoute('/_app/')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(queries.health()),
      context.queryClient.ensureQueryData(queries.entries()),
      context.queryClient.ensureQueryData(queries.settings())
    ]),
  component: ProblemsPage
})

function bar(score: number, width = 30): string {
  const filled = Math.round((score / 100) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

function ProblemsPage(): React.JSX.Element {
  const { data: report } = useSuspenseQuery(queries.health())
  const { data: entries } = useSuspenseQuery(queries.entries())
  const { data: settings } = useSuspenseQuery(queries.settings())
  const [show, setShow] = useState<Record<Severity, boolean>>({
    error: true,
    warning: true,
    info: true
  })
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const navigate = useNavigate()

  const withProblems = useMemo(
    () =>
      entries
        .map((entry) => ({ entry, problems: entryProblems(entry).filter((p) => show[p.severity]) }))
        .filter((x) => x.problems.length > 0)
        .sort(
          (a, b) => a.entry.score - b.entry.score || a.entry.title.localeCompare(b.entry.title)
        ),
    [entries, show]
  )

  if (report.total === 0) return <EmptyVault />

  const counts = {
    error: report.weak.length,
    warning: report.reused.length,
    info: report.old.length
  }
  const scoreColor =
    report.score >= 80 ? 'text-syn-string' : report.score >= 50 ? 'text-syn-type' : 'text-syn-prop'

  const open = (entry: EntrySummary, fix = false): void =>
    void navigate({
      to: '/passwords',
      search: { id: entry.id, edit: fix || undefined, generate: fix || undefined }
    })

  return (
    <div className="flex h-full flex-col">
      <Breadcrumbs path={['vault', 'problems']} />

      <pre className="shrink-0 border-b border-ide-border px-5 py-4 text-[13px] leading-6 whitespace-pre-wrap select-text">
        <span className="text-syn-string">➜</span> <span className="text-syn-fn">~/vault</span>{' '}
        <span className="text-ide-bright">pm audit</span>
        {'\n'}
        <span className="text-syn-string">✔</span> scanned {report.total} credential
        {report.total === 1 ? '' : 's'}
        {'\n'}
        <span className={counts.error ? 'text-syn-prop' : 'text-syn-string'}>
          {counts.error ? '✖' : '✔'}
        </span>{' '}
        {counts.error} weak password{counts.error === 1 ? '' : 's'}
        {'\n'}
        <span className={counts.warning ? 'text-syn-type' : 'text-syn-string'}>
          {counts.warning ? '⚠' : '✔'}
        </span>{' '}
        {counts.warning} reused password{counts.warning === 1 ? '' : 's'}
        {'\n'}
        <span className={counts.info ? 'text-ide-accent' : 'text-syn-string'}>
          {counts.info ? 'ℹ' : '✔'}
        </span>{' '}
        {counts.info} unchanged for {settings.oldPasswordDays}+ days
        {report.empty.length > 0 && (
          <>
            {'\n'}
            <span className="text-ide-muted">·</span> {report.empty.length} without a password
          </>
        )}
        {'\n\n'}
        health <span className={scoreColor}>{bar(report.score)}</span>{' '}
        <span className={cn('font-semibold', scoreColor)}>{report.score}/100</span>
      </pre>

      <PanelHeader
        className="border-b border-ide-border"
        title={
          <span>
            Problems{' '}
            <span className="ml-1 rounded-full bg-ide-hover px-1.5 text-ide-fg">
              {counts.error + counts.warning + counts.info}
            </span>
          </span>
        }
        actions={(['error', 'warning', 'info'] as const).map((severity) => {
          const { icon: Icon, color } = SEVERITY_STYLE[severity]
          return (
            <button
              key={severity}
              onClick={() => setShow((s) => ({ ...s, [severity]: !s[severity] }))}
              title={`Toggle ${severity}s`}
              className={cn(
                'flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px]',
                show[severity] ? 'bg-ide-sel text-ide-fg' : 'text-ide-faint hover:bg-ide-hover'
              )}
            >
              <Icon className={cn('size-3', show[severity] && color)} />
              {counts[severity]}
            </button>
          )
        })}
      />

      <div className="min-h-0 flex-1 overflow-y-auto py-1 text-[13px]">
        {withProblems.map(({ entry, problems }) => {
          const isCollapsed = collapsed.has(entry.id)
          const Chevron = isCollapsed ? ChevronRight : ChevronDown
          return (
            <div key={entry.id}>
              <button
                onClick={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev)
                    if (next.has(entry.id)) next.delete(entry.id)
                    else next.add(entry.id)
                    return next
                  })
                }
                className="flex h-[22px] w-full items-center gap-1.5 px-2 text-left hover:bg-ide-hover"
              >
                <Chevron className="size-3.5 shrink-0 text-ide-muted" />
                <FileKey2 className="size-3.5 shrink-0 text-syn-type" />
                <span className="text-ide-bright">{identifier(entry.title)}.ts</span>
                <span className="truncate text-xs text-ide-faint">
                  {entry.folder ? `vault/${entry.folder}` : 'vault'} · {entry.username}
                </span>
                <span className="ml-1 rounded-full bg-ide-hover px-1.5 text-[11px] text-ide-fg">
                  {problems.length}
                </span>
              </button>
              {!isCollapsed &&
                problems.map((p) => (
                  <div
                    key={p.message}
                    onClick={() => open(entry)}
                    className="group flex h-[22px] cursor-pointer items-center gap-2 pr-3 pl-10 hover:bg-ide-hover"
                  >
                    <p.icon className={cn('size-3.5 shrink-0', p.color)} />
                    <span className="truncate text-ide-fg">{p.message}</span>
                    <span className="shrink-0 text-xs text-ide-faint">
                      pm(strength) [Ln 7, Col 3]
                    </span>
                    {p.fixable && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          open(entry, true)
                        }}
                        className="ml-auto shrink-0 text-xs text-ide-accent opacity-0 group-hover:opacity-100 hover:underline"
                      >
                        quick fix
                      </button>
                    )}
                  </div>
                ))}
            </div>
          )
        })}
        {withProblems.length === 0 && (
          <p className="px-4 py-2 text-xs text-ide-muted">
            No problems have been detected in the vault.
          </p>
        )}
      </div>
    </div>
  )
}

function EmptyVault(): React.JSX.Element {
  return (
    <div className="flex h-full flex-col">
      <Breadcrumbs path={['vault', 'problems']} />
      <pre className="px-5 py-4 text-[13px] leading-6 whitespace-pre-wrap">
        <span className="text-syn-string">➜</span> <span className="text-syn-fn">~/vault</span>{' '}
        <span className="text-ide-bright">pm audit</span>
        {'\n'}
        <span className="text-ide-muted">vault is empty — nothing to audit</span>
      </pre>
      <div className="flex gap-2 px-5">
        <Link to="/passwords" search={{ id: 'new' }}>
          <Button variant="primary">
            <FilePlus2 className="size-3.5" />
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
