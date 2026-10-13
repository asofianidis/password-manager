import { forwardRef, useState, type ComponentProps, type ReactNode } from 'react'
import { Check, ChevronDown, Copy, Eye, EyeOff, Info, X, XCircle, CheckCircle2 } from 'lucide-react'
import type { StrengthScore } from '@shared/types'
import { STRENGTH_LABELS, strengthText } from '@renderer/lib/format'
import { cn } from '@renderer/lib/cn'
import { dismissToast, useToasts } from '@renderer/lib/toast'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-ide-button text-white hover:bg-ide-button-hover',
  secondary: 'bg-ide-hover text-ide-fg ring-1 ring-ide-border hover:bg-ide-sel',
  ghost: 'text-ide-muted hover:bg-ide-hover hover:text-ide-bright',
  danger: 'text-syn-prop ring-1 ring-syn-prop/40 hover:bg-syn-prop/10'
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: ComponentProps<'button'> & {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'icon'
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-sm transition-colors focus-visible:outline-1 focus-visible:outline-ide-accent disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' && 'h-6 px-2 text-xs',
        size === 'md' && 'h-7 px-3 text-xs',
        size === 'icon' && 'size-6',
        buttonVariants[variant],
        className
      )}
      {...props}
    />
  )
}

const inputBase =
  'w-full rounded-sm border border-ide-border bg-ide-input px-2 text-[13px] text-ide-bright placeholder:text-ide-faint focus:border-ide-accent focus:outline-none'

export const Input = forwardRef<HTMLInputElement, ComponentProps<'input'>>(function Input(
  { className, ...props },
  ref
) {
  return <input ref={ref} className={cn(inputBase, 'h-7', className)} {...props} />
})

export function Textarea({ className, ...props }: ComponentProps<'textarea'>): React.JSX.Element {
  return <textarea className={cn(inputBase, 'min-h-24 py-1.5', className)} {...props} />
}

export const PasswordInput = forwardRef<HTMLInputElement, Omit<ComponentProps<'input'>, 'type'>>(
  function PasswordInput({ className, ...props }, ref) {
    const [visible, setVisible] = useState(false)
    return (
      <div className="relative">
        <Input
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={cn('pr-8', className)}
          autoComplete="off"
          spellCheck={false}
          {...props}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 flex w-7 items-center justify-center text-ide-muted hover:text-ide-bright"
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
      </div>
    )
  }
)

export function Select({ className, ...props }: ComponentProps<'select'>): React.JSX.Element {
  return (
    <div className={cn('relative', className)}>
      <select className={cn(inputBase, 'h-7 appearance-none pr-7')} {...props} />
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-ide-muted" />
    </div>
  )
}

export function Field({
  label,
  hint,
  children,
  className
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <label className={cn('block space-y-1', className)}>
      <span className="text-xs text-ide-muted">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-ide-faint">{hint}</span>}
    </label>
  )
}

/** IDE-style checkbox setting. */
export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
}): React.JSX.Element {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-2.5',
        disabled && 'pointer-events-none opacity-40'
      )}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border',
          checked ? 'border-ide-accent bg-ide-button' : 'border-ide-faint bg-ide-input'
        )}
      >
        {checked && <Check className="size-3 text-white" strokeWidth={3} />}
      </button>
      <span>
        <span className="block text-ide-fg">{label}</span>
        {description && <span className="block text-xs text-ide-muted">{description}</span>}
      </span>
    </label>
  )
}

/** Uppercase panel header, like VS Code's EXPLORER / PROBLEMS headers. */
export function PanelHeader({
  title,
  actions,
  className
}: {
  title: ReactNode
  actions?: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex h-8 shrink-0 items-center justify-between gap-2 px-3 text-[11px] font-semibold tracking-wider text-ide-muted uppercase',
        className
      )}
    >
      <span className="truncate">{title}</span>
      {actions && <div className="flex items-center gap-0.5 normal-case">{actions}</div>}
    </div>
  )
}

/** A bordered section within a page body. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
  id
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  id?: string
}): React.JSX.Element {
  return (
    <section id={id} className={cn('border border-ide-border bg-ide-panel', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-4 border-b border-ide-border px-4 py-2">
          <div className="min-w-0">
            {title && <h2 className="text-ide-bright">{title}</h2>}
            {description && <p className="text-xs text-syn-comment">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

/** Breadcrumb-style page header: `vault › settings`. */
export function Breadcrumbs({
  path,
  actions
}: {
  path: string[]
  actions?: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-ide-border bg-ide-bg px-4 text-xs text-ide-muted">
      <div className="flex min-w-0 items-center gap-1.5">
        {path.map((part, i) => (
          <span key={i} className="flex items-center gap-1.5 truncate">
            {i > 0 && <span className="text-ide-faint">›</span>}
            <span className={i === path.length - 1 ? 'text-ide-fg' : undefined}>{part}</span>
          </span>
        ))}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  )
}

/* ---------- strength ---------- */

/** ASCII meter, e.g. `[■■□□□] weak`. */
export function StrengthMeter({
  score,
  detail
}: {
  score: StrengthScore
  detail?: string
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={strengthText[score]}>
        [{'■'.repeat(score + 1)}
        <span className="text-ide-faint">{'□'.repeat(4 - score)}</span>]
      </span>
      <span className={strengthText[score]}>{STRENGTH_LABELS[score].toLowerCase()}</span>
      {detail && <span className="text-syn-comment">{`// ${detail}`}</span>}
    </div>
  )
}

export function StrengthBadge({ score }: { score: StrengthScore }): React.JSX.Element {
  return (
    <span className={cn('text-[11px]', strengthText[score])}>
      {STRENGTH_LABELS[score].toLowerCase()}
    </span>
  )
}

export function Badge({
  tone = 'neutral',
  children
}: {
  tone?: 'neutral' | 'warning' | 'danger' | 'success' | 'info'
  children: ReactNode
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm px-1.5 text-[11px] leading-5',
        tone === 'neutral' && 'bg-ide-hover text-ide-muted',
        tone === 'warning' && 'bg-syn-type/10 text-syn-type',
        tone === 'danger' && 'bg-syn-prop/10 text-syn-prop',
        tone === 'success' && 'bg-syn-string/10 text-syn-string',
        tone === 'info' && 'bg-ide-accent/10 text-ide-accent'
      )}
    >
      {children}
    </span>
  )
}

export function Kbd({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <kbd className="rounded-sm border border-ide-border bg-ide-input px-1 text-[10px] text-ide-muted">
      {children}
    </kbd>
  )
}

/** Shows a check briefly after `onCopy` succeeds. */
export function CopyButton({
  onCopy,
  label = 'Copy'
}: {
  onCopy: () => Promise<unknown> | void
  label?: string
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="icon"
      variant="ghost"
      title={label}
      aria-label={label}
      onClick={async () => {
        await onCopy()
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
    >
      {copied ? <Check className="size-3.5 text-syn-string" /> : <Copy className="size-3.5" />}
    </Button>
  )
}

export function RevealButton({
  revealed,
  onToggle
}: {
  revealed: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <Button
      size="icon"
      variant="ghost"
      onClick={onToggle}
      title={revealed ? 'Hide' : 'Reveal'}
      aria-label={revealed ? 'Hide password' : 'Show password'}
    >
      {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
    </Button>
  )
}

export function ErrorText({ error }: { error: unknown }): React.JSX.Element | null {
  if (!error) return null
  return (
    <p className="text-xs text-syn-prop">
      <span className="font-semibold">error:</span>{' '}
      {error instanceof Error ? error.message : String(error)}
    </p>
  )
}

export function Toaster(): React.JSX.Element {
  const toasts = useToasts()
  return (
    <div className="pointer-events-none fixed right-3 bottom-8 z-50 flex w-96 flex-col gap-2">
      {toasts.map((t) => {
        const Icon = t.tone === 'error' ? XCircle : t.tone === 'success' ? CheckCircle2 : Info
        return (
          <div
            key={t.id}
            className="pointer-events-auto flex items-start gap-2.5 border border-ide-border bg-ide-panel px-3 py-2.5 text-xs shadow-xl shadow-black/40"
          >
            <Icon
              className={cn(
                'mt-px size-4 shrink-0',
                t.tone === 'error' && 'text-syn-prop',
                t.tone === 'success' && 'text-syn-string',
                t.tone === 'info' && 'text-ide-accent'
              )}
            />
            <span className="flex-1 break-words text-ide-fg">{t.message}</span>
            <button
              onClick={() => dismissToast(t.id)}
              className="text-ide-muted hover:text-ide-bright"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

export function Modal({
  title,
  onClose,
  children,
  wide
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}): React.JSX.Element {
  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/50 pt-24"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        className={cn(
          'w-full border border-ide-border bg-ide-panel shadow-2xl shadow-black/60',
          wide ? 'max-w-2xl' : 'max-w-lg'
        )}
      >
        <div className="flex h-8 items-center justify-between border-b border-ide-border pr-1 pl-3">
          <h2 className="text-xs text-ide-muted">{title}</h2>
          <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close">
            <X className="size-3.5" />
          </Button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}
