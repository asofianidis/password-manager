import type { ReactNode } from 'react'
import { cn } from '@renderer/lib/cn'

export interface CodeLine {
  /** Stable key; defaults to the line index */
  key?: string
  content: ReactNode
  /** Shown on the right when the line is hovered */
  actions?: ReactNode
  /** Always-visible trailing content (e.g. a comment) */
  trailing?: ReactNode
  highlight?: 'error' | 'warning'
}

/** Renders lines with a line-number gutter, like an editor buffer. */
export function CodeBlock({
  lines,
  className
}: {
  lines: CodeLine[]
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('py-2 font-mono text-[13px] leading-6', className)}>
      {lines.map((line, i) => (
        <div
          key={line.key ?? i}
          className={cn(
            'group/line flex min-h-6 items-start hover:bg-ide-line',
            line.highlight === 'error' && 'bg-syn-prop/[0.06]',
            line.highlight === 'warning' && 'bg-syn-type/[0.05]'
          )}
        >
          <span className="w-14 shrink-0 pr-4 text-right text-ide-faint tabular-nums select-none group-hover/line:text-ide-muted">
            {i + 1}
          </span>
          <div className="min-w-0 flex-1 pr-2 break-words whitespace-pre-wrap select-text">
            {line.content}
            {line.trailing && <span className="ml-3">{line.trailing}</span>}
          </div>
          {line.actions && (
            <div className="flex shrink-0 items-center gap-0.5 pr-3 opacity-0 group-hover/line:opacity-100 focus-within:opacity-100">
              {line.actions}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
