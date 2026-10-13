import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery
} from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import type { GeneratorOptions } from '@shared/types'
import { api, queries } from '@renderer/lib/api'
import { toast, toastError } from '@renderer/lib/toast'
import {
  Button,
  Card,
  CopyButton,
  Field,
  Input,
  PageHeader,
  StrengthMeter,
  Toggle
} from '@renderer/components/ui'
import { cn } from '@renderer/lib/cn'

export const Route = createFileRoute('/_app/generator')({
  loader: ({ context }) => context.queryClient.ensureQueryData(queries.settings()),
  component: GeneratorPage
})

function GeneratorPage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const { data: settings } = useSuspenseQuery(queries.settings())
  const [options, setOptions] = useState<GeneratorOptions>(settings.generator)
  const [nonce, setNonce] = useState(0)
  const set = <K extends keyof GeneratorOptions>(key: K, value: GeneratorOptions[K]): void =>
    setOptions((prev) => ({ ...prev, [key]: value }))

  const { data: generated, isFetching } = useQuery({
    queryKey: ['generator', options, nonce],
    queryFn: () => api.invoke('generator:generate', options),
    placeholderData: keepPreviousData,
    gcTime: 0,
    staleTime: Infinity
  })

  const saveDefaults = useMutation({
    mutationFn: () => api.invoke('settings:update', { generator: options }),
    onSuccess: (next) => {
      queryClient.setQueryData(queries.settings().queryKey, next)
      toast('Saved as default for new passwords')
    },
    onError: toastError
  })

  const isDefault = JSON.stringify(options) === JSON.stringify(settings.generator)

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <PageHeader
        title="Password generator"
        description="Generated locally using a cryptographically secure random source."
      />

      <Card>
        <div className="flex items-center gap-3">
          <p
            className={cn(
              'min-h-12 flex-1 rounded-lg bg-zinc-950 px-4 py-3 font-mono text-lg break-all select-text',
              isFetching && 'opacity-60'
            )}
          >
            {generated?.password}
          </p>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setNonce((n) => n + 1)}
            aria-label="Regenerate"
          >
            <RefreshCw className="size-4" />
          </Button>
          <CopyButton
            label="Copy password"
            onCopy={async () => {
              if (!generated) return
              await api.invoke('clipboard:copy-secret', generated.password)
              toast('Password copied')
            }}
          />
        </div>
        {generated && (
          <div className="mt-4">
            <StrengthMeter
              score={generated.strength.score}
              detail={`Cracked in ${generated.strength.crackTime}`}
            />
          </div>
        )}
      </Card>

      <Card
        title="Options"
        actions={
          <Button
            size="sm"
            onClick={() => saveDefaults.mutate()}
            disabled={isDefault || saveDefaults.isPending}
          >
            Save as default
          </Button>
        }
      >
        <div className="mb-6 grid grid-cols-2 gap-1 rounded-lg bg-zinc-950 p-1">
          {(['random', 'passphrase'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => set('mode', mode)}
              className={cn(
                'rounded-md py-2 text-sm font-medium',
                options.mode === mode
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              )}
            >
              {mode === 'random' ? 'Random characters' : 'Passphrase'}
            </button>
          ))}
        </div>

        {options.mode === 'random' ? (
          <div className="space-y-5">
            <Slider
              label="Length"
              value={options.length}
              min={8}
              max={64}
              onChange={(v) => set('length', v)}
            />
            <div className="grid grid-cols-2 gap-x-8 gap-y-4">
              <Toggle
                label="Uppercase (A-Z)"
                checked={options.uppercase}
                onChange={(v) => set('uppercase', v)}
              />
              <Toggle
                label="Lowercase (a-z)"
                checked={options.lowercase}
                onChange={(v) => set('lowercase', v)}
              />
              <Toggle
                label="Digits (0-9)"
                checked={options.digits}
                onChange={(v) => set('digits', v)}
              />
              <Toggle
                label="Symbols (!@#$…)"
                checked={options.symbols}
                onChange={(v) => set('symbols', v)}
              />
              <Toggle
                label="Avoid ambiguous characters"
                description="Excludes I, l, 1, O, 0 and similar"
                checked={options.excludeAmbiguous}
                onChange={(v) => set('excludeAmbiguous', v)}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <Slider
              label="Words"
              value={options.words}
              min={3}
              max={12}
              onChange={(v) => set('words', v)}
            />
            <div className="grid grid-cols-2 gap-x-8 gap-y-4">
              <Field label="Separator">
                <Input
                  value={options.separator}
                  maxLength={3}
                  onChange={(e) => set('separator', e.target.value)}
                  className="w-24 font-mono"
                />
              </Field>
              <div className="space-y-4">
                <Toggle
                  label="Capitalize words"
                  checked={options.capitalize}
                  onChange={(v) => set('capitalize', v)}
                />
                <Toggle
                  label="Include a number"
                  checked={options.includeNumber}
                  onChange={(v) => set('includeNumber', v)}
                />
              </div>
            </div>
            <p className="text-xs text-zinc-500">
              Words are drawn from the EFF diceware list (7,776 words, ~12.9 bits each).
            </p>
          </div>
        )}
      </Card>
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}): React.JSX.Element {
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span className="font-medium text-zinc-300">{label}</span>
        <span className="font-mono text-zinc-100">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-emerald-500"
      />
    </div>
  )
}
