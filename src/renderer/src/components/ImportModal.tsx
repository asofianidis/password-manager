import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FileUp } from 'lucide-react'
import type { ImportFile, ImportFormat, ImportPreview } from '@shared/types'
import { IMPORT_FORMAT_LABELS } from '@shared/importers'
import { api } from '@renderer/lib/api'
import { toast } from '@renderer/lib/toast'
import { Button, ErrorText, Field, Modal, PasswordInput, Select, Toggle } from './ui'

export function ImportModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const queryClient = useQueryClient()
  const [file, setFile] = useState<ImportFile | null>(null)
  const [format, setFormat] = useState<ImportFormat>('auto')
  const [password, setPassword] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [skipDuplicates, setSkipDuplicates] = useState(true)

  const close = (): void => {
    if (file) void api.invoke('import:cancel', file.token)
    onClose()
  }

  const pick = useMutation({
    mutationFn: () => api.invoke('import:pick-file'),
    onSuccess: (picked) => {
      if (!picked) return
      if (file) void api.invoke('import:cancel', file.token)
      setFile(picked)
      setFormat(picked.detectedFormat ?? 'generic-csv')
      setPreview(null)
    }
  })

  const load = useMutation({
    mutationFn: () => api.invoke('import:preview', file!.token, format, password || undefined),
    onSuccess: setPreview
  })

  const commit = useMutation({
    mutationFn: () => api.invoke('import:commit', file!.token, skipDuplicates),
    onSuccess: async (count) => {
      await queryClient.invalidateQueries({ queryKey: ['vault'] })
      toast(`Imported ${count} password${count === 1 ? '' : 's'}`)
      onClose()
    }
  })

  const needsPassword = format === 'pm-encrypted'
  const toImport = preview ? preview.total - (skipDuplicates ? preview.duplicates : 0) : 0

  return (
    <Modal title="Import passwords" onClose={close}>
      <div className="space-y-4">
        <Button onClick={() => pick.mutate()} disabled={pick.isPending} className="w-full">
          <FileUp className="size-4" />
          {file ? file.fileName : 'Choose export file…'}
        </Button>
        <ErrorText error={pick.error} />

        {file && (
          <>
            <Field
              label="Format"
              hint={
                file.detectedFormat
                  ? 'Detected automatically. Change it if the preview looks wrong.'
                  : 'Could not detect the format; pick one.'
              }
            >
              <Select
                value={format}
                onChange={(e) => {
                  setFormat(e.target.value as ImportFormat)
                  setPreview(null)
                }}
              >
                {(Object.keys(IMPORT_FORMAT_LABELS) as ImportFormat[])
                  .filter((f) => f !== 'auto')
                  .map((f) => (
                    <option key={f} value={f}>
                      {IMPORT_FORMAT_LABELS[f]}
                    </option>
                  ))}
              </Select>
            </Field>
            {needsPassword && (
              <Field label="Backup password">
                <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
            )}
            {!preview && (
              <Button
                onClick={() => load.mutate()}
                disabled={load.isPending || (needsPassword && !password)}
              >
                {load.isPending ? 'Reading…' : 'Preview'}
              </Button>
            )}
            <ErrorText error={load.error} />
          </>
        )}

        {preview && (
          <div className="space-y-4 rounded-lg border border-zinc-800 p-4">
            <p className="text-sm">
              Found <b>{preview.total}</b> password{preview.total === 1 ? '' : 's'}
              {preview.duplicates > 0 && (
                <>
                  , <b>{preview.duplicates}</b> already in your vault
                </>
              )}
              .
            </p>
            {preview.warnings.map((warning) => (
              <p key={warning} className="text-xs text-amber-300">
                {warning}
              </p>
            ))}
            {preview.sample.length > 0 && (
              <ul className="space-y-1 text-xs text-zinc-400">
                {preview.sample.map((s, i) => (
                  <li key={i} className="truncate">
                    <span className="text-zinc-200">{s.title}</span> · {s.username || '—'}
                  </li>
                ))}
                {preview.total > preview.sample.length && (
                  <li>…and {preview.total - preview.sample.length} more</li>
                )}
              </ul>
            )}
            {preview.duplicates > 0 && (
              <Toggle
                label="Skip duplicates"
                checked={skipDuplicates}
                onChange={setSkipDuplicates}
              />
            )}
            <ErrorText error={commit.error} />
            <div className="flex justify-end gap-2">
              <Button onClick={close}>Cancel</Button>
              <Button
                variant="primary"
                onClick={() => commit.mutate()}
                disabled={toImport === 0 || commit.isPending}
              >
                Import {toImport}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
