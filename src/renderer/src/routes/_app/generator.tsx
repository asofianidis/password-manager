import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { RefreshCw, Save, Vault } from 'lucide-react'
import type { GeneratedPassword, GeneratorOptions } from '@shared/types'
import { api, queries } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { MOD, SHIFT, isMod } from '@renderer/lib/keys'
import { toast, toastError } from '@renderer/lib/toast'
import {
  Button,
  CopyButton,
  Eyebrow,
  Input,
  Kbd,
  PageHeader,
  Secret,
  Segmented,
  StrengthMeter,
  Switch
} from '@renderer/components/ui'
import { SaveGeneratedModal } from '@renderer/components/SaveGeneratedModal'

export const Route = createFileRoute('/_app/generator')({
  loader: ({ context }) => context.queryClient.ensureQueryData(queries.settings()),
  component: GeneratorPage
})

interface Run {
  id: number
  result: GeneratedPassword
}

let runId = 0

const copySecret = async (password: string): Promise<void> => {
  await api.invoke('clipboard:copy-secret', password)
  toast('Password copied to clipboard')
}

type Toggle =
  | 'uppercase'
  | 'lowercase'
  | 'digits'
  | 'symbols'
  | 'excludeAmbiguous'
  | 'capitalize'
  | 'includeNumber'

function GeneratorPage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const { data: settings } = useSuspenseQuery(queries.settings())
  const [options, setOptions] = useState<GeneratorOptions>(settings.generator)
  const [runs, setRuns] = useState<Run[]>([])
  // Password being saved to the vault; the dialog is open while set
  const [saving, setSaving] = useState<string | null>(null)
  const set = <K extends keyof GeneratorOptions>(key: K, value: GeneratorOptions[K]): void =>
    setOptions((prev) => ({ ...prev, [key]: value }))

  const generate = useMutation({
    mutationFn: (o: GeneratorOptions) => api.invoke('generator:generate', o),
    onSuccess: (result) => setRuns((prev) => [...prev.slice(-9), { id: ++runId, result }]),
    onError: toastError
  })
  const { mutate } = generate

  // Regenerate whenever the options change
  useEffect(() => {
    mutate(options)
  }, [options, mutate])

  const saveDefaults = useMutation({
    mutationFn: () => api.invoke('settings:update', { generator: options }),
    onSuccess: (next) => {
      queryClient.setQueryData(queries.settings().queryKey, next)
      toast('Saved as the default for new passwords')
    },
    onError: toastError
  })

  const dirty = JSON.stringify(options) !== JSON.stringify(settings.generator)
  const latest = runs.at(-1)
  const history = runs.slice(0, -1).reverse()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // Leave keys to the save dialog while it's open
      if (saving !== null) return
      if (isMod(e) && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (latest) setSaving(latest.result.password)
      } else if (isMod(e) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (dirty) saveDefaults.mutate()
      } else if (isMod(e) && e.key === 'Enter') {
        e.preventDefault()
        mutate(options)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const toggle = (key: Toggle, label: string, detail?: string): React.JSX.Element => (
    <label
      key={key}
      className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2.5 hover:bg-hover"
    >
      <span>
        <span className="text-fg">{label}</span>
        {detail && <span className="ml-2 font-mono text-xs text-faint">{detail}</span>}
      </span>
      <Switch checked={options[key]} onChange={(v) => set(key, v)} label={label} />
    </label>
  )

  const slider = (
    key: 'length' | 'words',
    label: string,
    min: number,
    max: number
  ): React.JSX.Element => (
    <div className="space-y-2 px-3 pt-1 pb-3">
      <div className="flex items-center justify-between">
        <span className="text-fg">{label}</span>
        <Input
          type="number"
          min={min}
          max={max}
          value={options[key]}
          onChange={(e) => set(key, Math.min(max, Math.max(min, Number(e.target.value) || min)))}
          className="h-7 w-16 text-center font-mono tabular-nums"
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={options[key]}
        onChange={(e) => set(key, Number(e.target.value))}
        className="w-full"
      />
      <div className="flex justify-between text-[10px] text-faint tabular-nums">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  )

  return (
    <div className="mx-auto max-w-4xl pb-12">
      <PageHeader
        title="Generator"
        subtitle="Random strings or diceware passphrases, generated on this device."
        actions={
          <Button onClick={() => saveDefaults.mutate()} disabled={!dirty || saveDefaults.isPending}>
            <Save className="size-3.5" />
            Save as default
            <Kbd className="ml-1">{MOD}S</Kbd>
          </Button>
        }
      />

      <div className="space-y-4 px-8">
        <div className="relative overflow-hidden rounded-2xl border border-line-strong bg-canvas p-6">
          <div className="pointer-events-none absolute -top-24 -right-24 size-64 rounded-full bg-accent/[0.07] blur-3xl" />
          <div className="relative flex min-h-16 items-center">
            {latest ? (
              <Secret
                value={latest.result.password}
                className="text-[22px] leading-snug tracking-wide text-bright"
              />
            ) : (
              <span className="text-faint">Generating…</span>
            )}
          </div>
          <div className="relative mt-5 flex items-center justify-between gap-4">
            {latest && (
              <StrengthMeter
                score={latest.result.strength.score}
                detail={`cracked in ${latest.result.strength.crackTime}`}
              />
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button onClick={() => mutate(options)} title={`Regenerate (${MOD}↵)`}>
                <RefreshCw className={cn('size-3.5', generate.isPending && 'animate-spin')} />
                Regenerate
                <Kbd className="ml-1">{MOD}↵</Kbd>
              </Button>
              <Button
                disabled={!latest}
                onClick={() => latest && void copySecret(latest.result.password).catch(toastError)}
              >
                Copy
              </Button>
              <Button
                variant="primary"
                disabled={!latest}
                title={`Save to vault (${MOD}${SHIFT}S)`}
                onClick={() => latest && setSaving(latest.result.password)}
              >
                <Vault className="size-3.5" />
                Save to vault
                <Kbd className="ml-1 border-accent-fg/20 bg-accent-fg/10 text-accent-fg">
                  {MOD}
                  {SHIFT}S
                </Kbd>
              </Button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-[1fr_18rem] gap-4">
          <div className="rounded-xl border border-line bg-raised/60 p-2">
            <div className="flex items-center justify-between px-3 pt-2 pb-3">
              <span className="font-medium text-bright">Options</span>
              <Segmented
                value={options.mode}
                onChange={(mode) => set('mode', mode)}
                options={[
                  { value: 'random', label: 'Random' },
                  { value: 'passphrase', label: 'Passphrase' }
                ]}
              />
            </div>
            {options.mode === 'random' ? (
              <>
                {slider('length', 'Length', 8, 64)}
                <div className="grid grid-cols-2">
                  {toggle('uppercase', 'Uppercase', 'A–Z')}
                  {toggle('lowercase', 'Lowercase', 'a–z')}
                  {toggle('digits', 'Digits', '0–9')}
                  {toggle('symbols', 'Symbols', '!@#$%')}
                  {toggle('excludeAmbiguous', 'Avoid look-alikes', 'Il1O0')}
                </div>
              </>
            ) : (
              <>
                {slider('words', 'Words', 3, 12)}
                <div className="grid grid-cols-2">
                  <label className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5">
                    <span className="text-fg">Separator</span>
                    <Input
                      value={options.separator}
                      maxLength={3}
                      onChange={(e) => set('separator', e.target.value)}
                      className="h-7 w-16 text-center font-mono"
                    />
                  </label>
                  {toggle('capitalize', 'Capitalize words')}
                  {toggle('includeNumber', 'Include a number')}
                </div>
                <p className="px-3 pt-1 pb-2 text-[11px] text-faint">
                  Words come from the EFF diceware list (7,776 words, about 12.9 bits each).
                </p>
              </>
            )}
          </div>

          <div className="rounded-xl border border-line p-2">
            <Eyebrow className="px-3 pt-2 pb-2">Recent</Eyebrow>
            {history.length === 0 && (
              <p className="px-3 py-2 text-xs text-faint">Previous results show up here.</p>
            )}
            {history.map((run) => (
              <div
                key={run.id}
                className="group flex items-center gap-2 rounded-lg py-1 pr-1 pl-3 hover:bg-hover"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted group-hover:text-fg">
                  {run.result.password}
                </span>
                <span className="flex opacity-0 group-hover:opacity-100">
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Save to vault"
                    aria-label="Save to vault"
                    onClick={() => setSaving(run.result.password)}
                  >
                    <Vault className="size-3.5" />
                  </Button>
                  <CopyButton
                    label="Copy password"
                    onCopy={() => copySecret(run.result.password)}
                  />
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {saving !== null && <SaveGeneratedModal password={saving} onClose={() => setSaving(null)} />}
    </div>
  )
}
