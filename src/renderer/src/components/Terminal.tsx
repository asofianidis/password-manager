import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@renderer/lib/cn'
import type { LogLine } from '@renderer/lib/workspace'
import { PanelHeader } from './ui'

/** Bottom terminal panel that follows its output. */
export function Terminal({
  title = 'Terminal',
  lines,
  actions,
  className,
  children
}: {
  title?: string
  lines?: LogLine[]
  actions?: ReactNode
  className?: string
  children?: ReactNode
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [lines, children])

  return (
    <div
      className={cn('flex shrink-0 flex-col border-t border-ide-border bg-ide-panel', className)}
    >
      <PanelHeader title={title} actions={actions} />
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 text-[13px] leading-6 select-text"
      >
        {lines?.map((line) => (
          <div key={line.id} className="break-words">
            {line.kind === 'cmd' ? (
              <>
                <span className="text-syn-string">➜</span>{' '}
                <span className="text-syn-fn">~/vault</span>{' '}
                <span className="text-ide-bright">{line.text}</span>
              </>
            ) : (
              <span
                className={cn(
                  line.kind === 'ok' && 'text-syn-string',
                  line.kind === 'err' && 'text-syn-prop',
                  line.kind === 'info' && 'text-ide-muted'
                )}
              >
                {line.kind === 'ok' ? '✔ ' : line.kind === 'err' ? '✖ ' : ''}
                {line.text}
              </span>
            )}
          </div>
        ))}
        {children}
        <div>
          <span className="text-syn-string">➜</span> <span className="text-syn-fn">~/vault</span>{' '}
          <span className="inline-block h-4 w-2 animate-blink bg-ide-fg align-middle" />
        </div>
      </div>
    </div>
  )
}
