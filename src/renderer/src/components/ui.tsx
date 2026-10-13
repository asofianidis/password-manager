import { forwardRef, useState, type ComponentProps, type ReactNode } from 'react'
import { Check, Copy, Eye, EyeOff, X } from 'lucide-react'
import type { StrengthScore } from '@shared/types'
import { STRENGTH_LABELS } from '@renderer/lib/format'
import { cn } from '@renderer/lib/cn'
import { dismissToast, useToasts } from '@renderer/lib/toast'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400',
  secondary: 'border border-zinc-700 bg-zinc-800/60 text-zinc-100 hover:bg-zinc-700/80',
  ghost: 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100',
  danger: 'bg-red-500/10 text-red-400 ring-1 ring-red-500/30 hover:bg-red-500/20'
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
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' && 'h-8 px-3 text-sm',
        size === 'md' && 'h-10 px-4 text-sm',
        size === 'icon' && 'size-8',
        buttonVariants[variant],
        className
      )}
      {...props}
    />
  )
}

export const Input = forwardRef<HTMLInputElement, ComponentProps<'input'>>(function Input(
  { className, ...props },
  ref
) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none',
        className
      )}
      {...props}
    />
  )
})

export function Textarea({ className, ...props }: ComponentProps<'textarea'>): React.JSX.Element {
  return (
    <textarea
      className={cn(
        'min-h-24 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none',
        className
      )}
      {...props}
    />
  )
}

export function PasswordInput({
  className,
  ...props
}: Omit<ComponentProps<'input'>, 'type'>): React.JSX.Element {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <Input
        type={visible ? 'text' : 'password'}
        className={cn('pr-10 font-mono', className)}
        autoComplete="off"
        spellCheck={false}
        {...props}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-zinc-400 hover:text-zinc-100"
        aria-label={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}

export function Select({ className, ...props }: ComponentProps<'select'>): React.JSX.Element {
  return (
    <select
      className={cn(
        'h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none',
        className
      )}
      {...props}
    />
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
      <span className="text-sm font-medium text-zinc-300">{label}</span>
      {children}
      {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
    </label>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  description?: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <label className={cn('flex items-start justify-between gap-4', disabled && 'opacity-50')}>
      <span>
        <span className="block text-sm font-medium text-zinc-200">{label}</span>
        {description && <span className="block text-xs text-zinc-500">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors',
          checked ? 'bg-emerald-500' : 'bg-zinc-700'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 size-5 rounded-full bg-white transition-transform',
            checked && 'translate-x-5'
          )}
        />
      </button>
    </label>
  )
}

export function Card({
  title,
  description,
  actions,
  children,
  className
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <section className={cn('rounded-xl border border-zinc-800 bg-zinc-900/50 p-5', className)}>
      {(title || actions) && (
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            {title && <h2 className="font-semibold text-zinc-100">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-zinc-400">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  )
}

export function PageHeader({
  title,
  description,
  actions
}: {
  title: string
  description?: string
  actions?: ReactNode
}): React.JSX.Element {
  return (
    <header className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-zinc-400">{description}</p>}
      </div>
      {actions}
    </header>
  )
}

const strengthColors: Record<StrengthScore, string> = {
  0: 'bg-red-500',
  1: 'bg-orange-500',
  2: 'bg-amber-400',
  3: 'bg-lime-400',
  4: 'bg-emerald-500'
}

const strengthText: Record<StrengthScore, string> = {
  0: 'text-red-400',
  1: 'text-orange-400',
  2: 'text-amber-300',
  3: 'text-lime-300',
  4: 'text-emerald-400'
}

export function StrengthMeter({
  score,
  detail
}: {
  score: StrengthScore
  detail?: string
}): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={cn(
              'h-1.5 flex-1 rounded-full',
              i <= score ? strengthColors[score] : 'bg-zinc-800'
            )}
          />
        ))}
      </div>
      <div className="flex justify-between text-xs">
        <span className={strengthText[score]}>{STRENGTH_LABELS[score]}</span>
        {detail && <span className="text-zinc-500">{detail}</span>}
      </div>
    </div>
  )
}

export function StrengthBadge({ score }: { score: StrengthScore }): React.JSX.Element {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs', strengthText[score])}>
      <span className={cn('size-1.5 rounded-full', strengthColors[score])} />
      {STRENGTH_LABELS[score]}
    </span>
  )
}

export function Badge({
  tone = 'neutral',
  children
}: {
  tone?: 'neutral' | 'warning' | 'danger' | 'success'
  children: ReactNode
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium ring-1',
        tone === 'neutral' && 'bg-zinc-800 text-zinc-300 ring-zinc-700',
        tone === 'warning' && 'bg-amber-500/10 text-amber-300 ring-amber-500/30',
        tone === 'danger' && 'bg-red-500/10 text-red-400 ring-red-500/30',
        tone === 'success' && 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/30'
      )}
    >
      {children}
    </span>
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
      {copied ? <Check className="size-4 text-emerald-400" /> : <Copy className="size-4" />}
    </Button>
  )
}

export function ErrorText({ error }: { error: unknown }): React.JSX.Element | null {
  if (!error) return null
  return (
    <p className="text-sm text-red-400">{error instanceof Error ? error.message : String(error)}</p>
  )
}

export function Toaster(): React.JSX.Element {
  const toasts = useToasts()
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto flex max-w-sm items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg',
            t.tone === 'success' && 'border-emerald-500/30 bg-zinc-900 text-emerald-300',
            t.tone === 'error' && 'border-red-500/30 bg-zinc-900 text-red-300',
            t.tone === 'info' && 'border-zinc-700 bg-zinc-900 text-zinc-200'
          )}
        >
          <span className="flex-1">{t.message}</span>
          <button onClick={() => dismissToast(t.id)} className="text-zinc-500 hover:text-zinc-200">
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  )
}

export function Modal({
  title,
  onClose,
  children
}: {
  title: string
  onClose: () => void
  children: ReactNode
}): React.JSX.Element {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>
        {children}
      </div>
    </div>
  )
}
