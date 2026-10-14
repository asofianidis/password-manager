import { forwardRef, useState, type ComponentProps, type ReactNode } from 'react'
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  X,
  XCircle
} from 'lucide-react'
import type { StrengthScore } from '@shared/types'
import { STRENGTH_LABELS, hostOf, strengthBg, strengthText } from '@renderer/lib/format'
import { cn } from '@renderer/lib/cn'
import { dismissToast, useToasts } from '@renderer/lib/toast'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-accent font-medium text-accent-fg hover:bg-accent-hover',
  secondary: 'bg-raised text-bright ring-1 ring-line-strong ring-inset hover:bg-hover',
  ghost: 'text-muted hover:bg-hover hover:text-bright',
  danger: 'bg-danger/10 text-danger ring-1 ring-danger/30 ring-inset hover:bg-danger/20'
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: ComponentProps<'button'> & {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg' | 'icon'
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' && 'h-7 px-2.5 text-xs',
        size === 'md' && 'h-8 px-3 text-[13px]',
        size === 'lg' && 'h-10 px-4 text-sm',
        size === 'icon' && 'size-7',
        buttonVariants[variant],
        className
      )}
      {...props}
    />
  )
}

const inputBase =
  'rounded-lg border border-line-strong bg-canvas px-3 text-[13px] text-bright transition-colors placeholder:text-faint focus:border-accent/60 focus:ring-3 focus:ring-accent/10 focus:outline-none'

export const Input = forwardRef<HTMLInputElement, ComponentProps<'input'>>(function Input(
  { className, ...props },
  ref
) {
  // Full width unless the caller sets its own width (class order can't override it reliably)
  const fullWidth = !/(^|\s)w-/.test(className ?? '')
  return (
    <input
      ref={ref}
      className={cn(inputBase, 'h-8', fullWidth && 'w-full', className)}
      {...props}
    />
  )
})

export function Textarea({ className, ...props }: ComponentProps<'textarea'>): React.JSX.Element {
  return <textarea className={cn(inputBase, 'min-h-24 w-full py-2', className)} {...props} />
}

export const PasswordInput = forwardRef<
  HTMLInputElement,
  Omit<ComponentProps<'input'>, 'type'> & {
    trailing?: ReactNode
    /** Controlled visibility; uncontrolled when omitted */
    visible?: boolean
    onVisibleChange?: (visible: boolean) => void
  }
>(function PasswordInput(
  { className, trailing, visible: controlled, onVisibleChange, ...props },
  ref
) {
  const [uncontrolled, setUncontrolled] = useState(false)
  const visible = controlled ?? uncontrolled
  const setVisible = (update: (v: boolean) => boolean): void => {
    const next = update(visible)
    setUncontrolled(next)
    onVisibleChange?.(next)
  }
  return (
    <div className="relative">
      <Input
        ref={ref}
        type={visible ? 'text' : 'password'}
        className={cn(
          'pr-9 font-mono placeholder:font-sans',
          trailing ? 'pr-28' : undefined,
          className
        )}
        autoComplete="off"
        spellCheck={false}
        {...props}
      />
      <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
        {trailing}
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          className="flex size-7 items-center justify-center rounded-md text-muted hover:text-bright"
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
      </div>
    </div>
  )
})

export function Select({ className, ...props }: ComponentProps<'select'>): React.JSX.Element {
  return (
    <div className={cn('relative', className)}>
      <select className={cn(inputBase, 'h-8 w-full appearance-none pr-8')} {...props} />
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted" />
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
    <label className={cn('block space-y-1.5', className)}>
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-faint">{hint}</span>}
    </label>
  )
}

/** Toggle switch with an optional label and description. */
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
        'flex cursor-pointer items-start gap-3',
        disabled && 'pointer-events-none opacity-40'
      )}
    >
      <Switch checked={checked} onChange={onChange} disabled={disabled} />
      <span>
        <span className="block text-bright">{label}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </span>
    </label>
  )
}

export function Switch({
  checked,
  onChange,
  disabled,
  label
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative mt-px inline-flex h-[18px] w-8 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        checked ? 'bg-accent' : 'bg-line-strong'
      )}
    >
      <span
        className={cn(
          'size-3.5 rounded-full shadow-sm transition-transform',
          checked ? 'translate-x-4 bg-accent-fg' : 'translate-x-0.5 bg-muted'
        )}
      />
    </button>
  )
}

/** Pill-shaped segmented control. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className
}: {
  value: T
  options: { value: T; label: ReactNode; count?: number }[]
  onChange: (value: T) => void
  className?: string
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg bg-canvas p-0.5 ring-1 ring-line-strong ring-inset',
        className
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            'flex h-6 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors',
            value === option.value ? 'bg-sel text-bright shadow-sm' : 'text-muted hover:text-bright'
          )}
        >
          {option.label}
          {option.count !== undefined && (
            <span
              className={cn('tabular-nums', value === option.value ? 'text-muted' : 'text-faint')}
            >
              {option.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

/** Large page title with optional subtitle and actions. */
export function PageHeader({
  title,
  subtitle,
  actions,
  className
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <header className={cn('flex items-end justify-between gap-4 px-8 pt-7 pb-5', className)}>
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold tracking-tight text-bright">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}

/** A rounded surface with an optional header. */
export function Card({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  id
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  id?: string
}): React.JSX.Element {
  return (
    <section id={id} className={cn('rounded-xl border border-line bg-raised/60', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-4 px-5 pt-4">
          <div className="min-w-0">
            {title && <h2 className="font-medium text-bright">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={cn('p-5', bodyClassName)}>{children}</div>
    </section>
  )
}

/** Small uppercase label for grouping list items. */
export function Eyebrow({
  children,
  className
}: {
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex items-center justify-between text-[11px] font-medium tracking-wide text-faint uppercase',
        className
      )}
    >
      {children}
    </div>
  )
}

/** App mark: a key glyph on an accent tile. */
export function LogoMark({ size = 'md' }: { size?: 'md' | 'lg' }): React.JSX.Element {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center bg-accent text-accent-fg shadow-[0_0_24px_-6px] shadow-accent/60',
        size === 'md' ? 'size-7 rounded-lg' : 'size-12 rounded-2xl'
      )}
    >
      <KeyRound className={size === 'md' ? 'size-4' : 'size-6'} strokeWidth={2.25} />
    </span>
  )
}

/* ---------- entries ---------- */

const MONOGRAM_HUES = [
  'bg-[#2a3b1a] text-[#c4f042]',
  'bg-[#1a3330] text-[#5fe0c8]',
  'bg-[#1d2a44] text-[#85a9ff]',
  'bg-[#33213d] text-[#d49bff]',
  'bg-[#3d2421] text-[#ff8f7a]',
  'bg-[#3a311a] text-[#f2c45b]'
]

/** Colored letter tile standing in for a site icon. */
export function Monogram({
  title,
  url,
  size = 'md'
}: {
  title: string
  url?: string
  size?: 'sm' | 'md' | 'lg'
}): React.JSX.Element {
  const source = hostOf(url ?? '') || title
  let hash = 0
  for (const ch of source) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  const letter = (title.trim()[0] ?? '?').toUpperCase()
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center font-semibold',
        MONOGRAM_HUES[hash % MONOGRAM_HUES.length],
        size === 'sm' && 'size-7 rounded-lg text-xs',
        size === 'md' && 'size-9 rounded-[10px] text-sm',
        size === 'lg' && 'size-14 rounded-2xl text-xl'
      )}
    >
      {letter}
    </span>
  )
}

/** Monospace secret with digits and symbols tinted so look-alike characters are easy to tell apart. */
export function Secret({
  value,
  className
}: {
  value: string
  className?: string
}): React.JSX.Element {
  return (
    <span className={cn('font-mono break-all select-text', className)}>
      {[...value].map((ch, i) => (
        <span
          key={i}
          className={
            /[0-9]/.test(ch) ? 'text-info' : /[a-zA-Z]/.test(ch) ? undefined : 'text-accent'
          }
        >
          {ch}
        </span>
      ))}
    </span>
  )
}

/* ---------- strength ---------- */

/** Five-segment meter with a label, e.g. `▮▮▮▯▯ Fair`. */
export function StrengthMeter({
  score,
  detail,
  className
}: {
  score: StrengthScore
  detail?: string
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs', className)}>
      <span className="flex shrink-0 gap-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={cn(
              'h-1.5 w-5 rounded-full',
              i <= score ? strengthBg[score] : 'bg-line-strong'
            )}
          />
        ))}
      </span>
      <span className={cn('font-medium whitespace-nowrap', strengthText[score])}>
        {STRENGTH_LABELS[score]}
      </span>
      {detail && <span className="text-muted">{detail}</span>}
    </div>
  )
}

export function StrengthBadge({ score }: { score: StrengthScore }): React.JSX.Element {
  return <span className={cn('text-[11px]', strengthText[score])}>{STRENGTH_LABELS[score]}</span>
}

export function Badge({
  tone = 'neutral',
  children,
  className
}: {
  tone?: 'neutral' | 'warning' | 'danger' | 'success' | 'info' | 'accent'
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 text-[11px] leading-5 font-medium',
        tone === 'neutral' && 'bg-hover text-muted',
        tone === 'warning' && 'bg-warn/10 text-warn',
        tone === 'danger' && 'bg-danger/10 text-danger',
        tone === 'success' && 'bg-ok/10 text-ok',
        tone === 'info' && 'bg-info/10 text-info',
        tone === 'accent' && 'bg-accent/10 text-accent',
        className
      )}
    >
      {children}
    </span>
  )
}

export function Kbd({
  children,
  className
}: {
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-line-strong bg-canvas px-1 font-sans text-[10px] text-muted',
        className
      )}
    >
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
      {copied ? <Check className="size-3.5 text-accent" /> : <Copy className="size-3.5" />}
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
    <p className="text-xs text-danger">{error instanceof Error ? error.message : String(error)}</p>
  )
}

export function Toaster(): React.JSX.Element {
  const toasts = useToasts()
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-96 flex-col gap-2">
      {toasts.map((t) => {
        const Icon = t.tone === 'error' ? XCircle : t.tone === 'success' ? CheckCircle2 : Info
        return (
          <div
            key={t.id}
            className="pointer-events-auto flex animate-rise items-start gap-2.5 rounded-xl border border-line-strong bg-raised px-3.5 py-3 text-[13px] shadow-2xl shadow-black/50"
          >
            <Icon
              className={cn(
                'mt-px size-4 shrink-0',
                t.tone === 'error' && 'text-danger',
                t.tone === 'success' && 'text-accent',
                t.tone === 'info' && 'text-info'
              )}
            />
            <span className="flex-1 break-words text-bright">{t.message}</span>
            <button onClick={() => dismissToast(t.id)} className="text-muted hover:text-bright">
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
  description,
  onClose,
  children,
  wide
}: {
  title: string
  description?: ReactNode
  onClose: () => void
  children: ReactNode
  wide?: boolean
}): React.JSX.Element {
  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/60 pt-24 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        className={cn(
          'w-full animate-rise rounded-2xl border border-line-strong bg-panel shadow-2xl shadow-black/60',
          wide ? 'max-w-2xl' : 'max-w-lg'
        )}
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5">
          <div>
            <h2 className="text-[15px] font-semibold text-bright">{title}</h2>
            {description && <p className="mt-1 text-xs text-muted">{description}</p>}
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={onClose}
            aria-label="Close"
            className="-mt-1 -mr-1"
          >
            <X className="size-4" />
          </Button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}
