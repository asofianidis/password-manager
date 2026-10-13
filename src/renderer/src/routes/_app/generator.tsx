import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { RefreshCw, Save } from 'lucide-react'
import type { GeneratedPassword, GeneratorOptions } from '@shared/types'
import { api, queries } from '@renderer/lib/api'
import { MOD, isMod } from '@renderer/lib/keys'
import { toast, toastError } from '@renderer/lib/toast'
import { Breadcrumbs, Button, CopyButton, StrengthMeter } from '@renderer/components/ui'
import { Terminal } from '@renderer/components/Terminal'
import { CodeBlock, type CodeLine } from '@renderer/components/code'
import { Comment, Kw, Num, Prop, Punc, Type } from '@renderer/components/syntax'

export const Route = createFileRoute('/_app/generator')({
  loader: ({ context }) => context.queryClient.ensureQueryData(queries.settings()),
  component: GeneratorPage
})

const I = '  '

function commandLine(o: GeneratorOptions): string {
  if (o.mode === 'passphrase') {
    return [
      'pm generate --passphrase',
      `--words ${o.words}`,
      `--separator "${o.separator}"`,
      o.capitalize && '--capitalize',
      o.includeNumber && '--number'
    ]
      .filter(Boolean)
      .join(' ')
  }
  return [
    'pm generate',
    `--length ${o.length}`,
    o.uppercase && '--upper',
    o.lowercase && '--lower',
    o.digits && '--digits',
    o.symbols && '--symbols',
    o.excludeAmbiguous && '--no-ambiguous'
  ]
    .filter(Boolean)
    .join(' ')
}

interface Run {
  id: number
  command: string
  result: GeneratedPassword
}

let runId = 0

function GeneratorPage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const { data: settings } = useSuspenseQuery(queries.settings())
  const [options, setOptions] = useState<GeneratorOptions>(settings.generator)
  const [runs, setRuns] = useState<Run[]>([])
  const set = <K extends keyof GeneratorOptions>(key: K, value: GeneratorOptions[K]): void =>
    setOptions((prev) => ({ ...prev, [key]: value }))

  const generate = useMutation({
    mutationFn: (o: GeneratorOptions) => api.invoke('generator:generate', o),
    onSuccess: (result, o) =>
      setRuns((prev) => [...prev.slice(-7), { id: ++runId, command: commandLine(o), result }]),
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
      toast('Saved generator.config.ts as the default for new passwords')
    },
    onError: toastError
  })

  const dirty = JSON.stringify(options) !== JSON.stringify(settings.generator)
  const latest = runs.at(-1)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (isMod(e) && e.key.toLowerCase() === 's') {
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

  const bool = (
    key:
      | 'uppercase'
      | 'lowercase'
      | 'digits'
      | 'symbols'
      | 'excludeAmbiguous'
      | 'capitalize'
      | 'includeNumber',
    comment?: string
  ): CodeLine => ({
    key,
    content: (
      <>
        {I}
        <Prop>{key}</Prop>
        <Punc>: </Punc>
        <button
          onClick={() => set(key, !options[key])}
          className="rounded-sm text-syn-keyword hover:bg-ide-input hover:underline"
          title="Click to toggle"
        >
          {String(options[key])}
        </button>
        <Punc>,</Punc>
      </>
    ),
    trailing: comment && <Comment>{`// ${comment}`}</Comment>
  })

  const num = (key: 'length' | 'words', min: number, max: number): CodeLine => ({
    key,
    content: (
      <>
        {I}
        <Prop>{key}</Prop>
        <Punc>: </Punc>
        <Num>
          <input
            type="number"
            min={min}
            max={max}
            value={options[key]}
            onChange={(e) => set(key, Math.min(max, Math.max(min, Number(e.target.value) || min)))}
            className="w-[5ch] rounded-sm bg-transparent text-syn-number outline-none focus:bg-ide-input"
          />
        </Num>
        <Punc>,</Punc>
        <input
          type="range"
          min={min}
          max={max}
          value={options[key]}
          onChange={(e) => set(key, Number(e.target.value))}
          className="ml-4 w-40 align-middle accent-ide-accent"
        />
      </>
    ),
    trailing: <Comment>{`// ${min}–${max}`}</Comment>
  })

  const lines: CodeLine[] = [
    { content: <Comment>{'// generator.config.ts — click values to edit'}</Comment> },
    { content: <Comment>{`// ${MOD}↵ regenerate · ${MOD}S save as default`}</Comment> },
    { content: '' },
    {
      content: (
        <>
          <Kw>export default</Kw> <Punc>{'{'}</Punc>
        </>
      )
    },
    {
      key: 'mode',
      content: (
        <>
          {I}
          <Prop>mode</Prop>
          <Punc>: </Punc>
          <button
            onClick={() => set('mode', options.mode === 'random' ? 'passphrase' : 'random')}
            className="rounded-sm text-syn-string hover:bg-ide-input hover:underline"
            title="Click to switch"
          >
            &quot;{options.mode}&quot;
          </button>
          <Punc>,</Punc>
        </>
      ),
      trailing: <Comment>{'// "random" | "passphrase"'}</Comment>
    },
    ...(options.mode === 'random'
      ? [
          num('length', 8, 64),
          bool('uppercase', 'A-Z'),
          bool('lowercase', 'a-z'),
          bool('digits', '0-9'),
          bool('symbols', '!@#$%^&*…'),
          bool('excludeAmbiguous', 'skip I l 1 O 0')
        ]
      : [
          num('words', 3, 12),
          {
            key: 'separator',
            content: (
              <>
                {I}
                <Prop>separator</Prop>
                <Punc>: </Punc>
                <span className="text-syn-string">
                  &quot;
                  <input
                    value={options.separator}
                    maxLength={3}
                    onChange={(e) => set('separator', e.target.value)}
                    className="[field-sizing:content] min-w-[1ch] rounded-sm bg-transparent text-syn-string outline-none focus:bg-ide-input"
                  />
                  &quot;
                </span>
                <Punc>,</Punc>
              </>
            )
          },
          bool('capitalize'),
          bool('includeNumber'),
          {
            key: 'wordlist',
            content: (
              <Comment>{`${I}// words from the EFF diceware list (7,776 words, ~12.9 bits each)`}</Comment>
            )
          }
        ]),
    {
      content: (
        <>
          <Punc>{'}'}</Punc> <Kw>satisfies</Kw> <Type>GeneratorOptions</Type>
        </>
      )
    }
  ]

  return (
    <div className="flex h-full flex-col">
      <Breadcrumbs
        path={['vault', 'generator', `generator.config.ts${dirty ? ' ●' : ''}`]}
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => mutate(options)}
              title={`Regenerate (${MOD}↵)`}
            >
              <RefreshCw className="size-3.5" />
              Regenerate
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => saveDefaults.mutate()}
              disabled={!dirty || saveDefaults.isPending}
            >
              <Save className="size-3.5" />
              Save as default
            </Button>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <CodeBlock lines={lines} />
      </div>

      <Terminal className="h-72">
        {runs.map((run) => {
          const isLatest = run === latest
          return (
            <div key={run.id} className={isLatest ? undefined : 'opacity-50'}>
              <div>
                <span className="text-syn-string">➜</span>{' '}
                <span className="text-syn-fn">~/vault</span>{' '}
                <span className="text-ide-bright">{run.command}</span>
              </div>
              <div className="group flex items-center gap-2">
                <span className="font-semibold break-all text-ide-bright">
                  {run.result.password}
                </span>
                <span className={isLatest ? undefined : 'opacity-0 group-hover:opacity-100'}>
                  <CopyButton
                    label="Copy password"
                    onCopy={async () => {
                      await api.invoke('clipboard:copy-secret', run.result.password)
                      toast('Password copied to clipboard')
                    }}
                  />
                </span>
              </div>
              {isLatest && (
                <StrengthMeter
                  score={run.result.strength.score}
                  detail={`cracked in ${run.result.strength.crackTime}`}
                />
              )}
            </div>
          )
        })}
      </Terminal>
    </div>
  )
}
