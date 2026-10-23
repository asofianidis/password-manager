import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CloudOff, Download, FileText, ImageIcon, Paperclip, X } from 'lucide-react'
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_ENTRY, type Attachment } from '@shared/types'
import { api } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { formatBytes } from '@renderer/lib/format'
import { toast, toastError } from '@renderer/lib/toast'
import { Button, Modal } from './ui'

/** Formats an <img> can show. HEIC and TIFF photos are kept, but only as files. */
const isImage = (mime: string): boolean =>
  /^image\/(png|jpe?g|gif|webp|bmp|avif|svg\+xml)$/i.test(mime)

/** Which attachments have their file on this device; the rest arrive with the next sync. */
function usePresent(attachments: Attachment[]): Set<string> | null {
  const ids = attachments.map((a) => a.id)
  const { data } = useQuery({
    queryKey: ['vault', 'attachments-present', ids],
    queryFn: () => api.invoke('attachments:present', ids),
    enabled: ids.length > 0
  })
  return data ? new Set(data) : null
}

/** Decrypts a saved attachment into an object URL, revoked when the component goes away. */
function useObjectUrl(
  entryId: string | undefined,
  attachment: Attachment,
  enabled: boolean
): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled || !entryId) return
    let cancelled = false
    let objectUrl: string | null = null
    api
      .invoke('attachments:read', entryId, attachment.id)
      .then((data) => {
        if (cancelled) return
        // Arrives over IPC as a plain, unshared buffer
        const bytes = data as Uint8Array<ArrayBuffer>
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: attachment.mime }))
        setUrl(objectUrl)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [entryId, attachment.id, attachment.mime, enabled])
  return url
}

function Tile({
  entryId,
  attachment,
  present,
  localUrl,
  onRemove
}: {
  entryId?: string
  attachment: Attachment
  present: boolean
  /** Preview for a file added in the editor and not saved yet */
  localUrl?: string
  onRemove?: () => void
}): React.JSX.Element {
  const image = isImage(attachment.mime)
  const savedUrl = useObjectUrl(entryId, attachment, image && present && !localUrl)
  const url = localUrl ?? savedUrl
  const [viewing, setViewing] = useState(false)
  const Icon = image ? ImageIcon : FileText

  const save = async (): Promise<void> => {
    try {
      const path = await api.invoke('attachments:save', entryId!, attachment.id)
      if (path) toast(`Saved ${attachment.name}`)
    } catch (error) {
      toastError(error)
    }
  }

  return (
    <div className="group relative overflow-hidden rounded-xl border border-line bg-canvas">
      <button
        type="button"
        disabled={!url}
        onClick={() => setViewing(true)}
        className="flex h-28 w-full items-center justify-center bg-raised/60 disabled:cursor-default"
        title={url ? 'View' : undefined}
      >
        {url ? (
          <img src={url} alt={attachment.name} className="size-full object-cover" />
        ) : present || localUrl !== undefined || !entryId ? (
          <Icon className="size-7 text-faint" />
        ) : (
          <span className="flex flex-col items-center gap-1 px-2 text-center text-[11px] text-faint">
            <CloudOff className="size-5" />
            Not downloaded yet. Sync to fetch it.
          </span>
        )}
      </button>
      <div className="flex items-center gap-1 px-2.5 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-fg" title={attachment.name}>
            {attachment.name}
          </p>
          <p className="text-[11px] text-faint">{formatBytes(attachment.size)}</p>
        </div>
        {onRemove ? (
          <Button size="icon" variant="ghost" title="Remove" onClick={onRemove}>
            <X className="size-3.5" />
          </Button>
        ) : (
          entryId &&
          present && (
            <Button size="icon" variant="ghost" title="Save to a file" onClick={() => void save()}>
              <Download className="size-3.5" />
            </Button>
          )
        )}
      </div>
      {viewing && url && (
        <Modal title={attachment.name} onClose={() => setViewing(false)} wide>
          <img
            src={url}
            alt={attachment.name}
            className="mx-auto max-h-[65vh] rounded-lg object-contain"
          />
        </Modal>
      )}
    </div>
  )
}

/** Read-only grid of an entry's files, with previews for images. */
export function AttachmentsView({
  entryId,
  attachments
}: {
  entryId: string
  attachments: Attachment[]
}): React.JSX.Element | null {
  const present = usePresent(attachments)
  if (attachments.length === 0) return null
  return (
    <div className="grid grid-cols-3 gap-3">
      {attachments.map((a) => (
        <Tile key={a.id} entryId={entryId} attachment={a} present={present?.has(a.id) ?? true} />
      ))}
    </div>
  )
}

/**
 * Lets the user add (pick or drop) and remove files. Added files are encrypted and stored right
 * away; they're kept once the entry is saved.
 */
export function AttachmentsEditor({
  entryId,
  attachments,
  onChange,
  accept,
  prompt = 'Add files'
}: {
  entryId?: string
  attachments: Attachment[]
  onChange: (attachments: Attachment[]) => void
  accept?: string
  prompt?: string
}): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null)
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const present = usePresent(attachments)
  const previewUrls = useRef<string[]>([])

  useEffect(() => () => previewUrls.current.forEach((url) => URL.revokeObjectURL(url)), [])

  const add = async (files: File[]): Promise<void> => {
    if (files.length === 0) return
    setBusy(true)
    try {
      let next = attachments
      for (const file of files) {
        if (next.length >= MAX_ATTACHMENTS_PER_ENTRY) {
          throw new Error(`An item can have up to ${MAX_ATTACHMENTS_PER_ENTRY} files`)
        }
        if (file.size > MAX_ATTACHMENT_BYTES) {
          throw new Error(`${file.name} is larger than ${formatBytes(MAX_ATTACHMENT_BYTES)}`)
        }
        const data = new Uint8Array(await file.arrayBuffer())
        const attachment = await api.invoke('attachments:add', file.name, file.type, data)
        if (isImage(attachment.mime)) {
          const url = URL.createObjectURL(file)
          previewUrls.current.push(url)
          setPreviews((prev) => ({ ...prev, [attachment.id]: url }))
        }
        next = [...next, attachment]
        onChange(next)
      }
    } catch (error) {
      toastError(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid grid-cols-3 gap-3">
      {attachments.map((a) => (
        <Tile
          key={a.id}
          entryId={entryId}
          attachment={a}
          present={present?.has(a.id) ?? true}
          localUrl={previews[a.id]}
          onRemove={() => onChange(attachments.filter((other) => other.id !== a.id))}
        />
      ))}
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void add([...e.dataTransfer.files])
        }}
        className={cn(
          'flex min-h-[10.5rem] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed text-xs transition-colors',
          dragging
            ? 'border-accent bg-accent/5 text-accent'
            : 'border-line-strong text-muted hover:border-accent/50 hover:text-bright'
        )}
      >
        <Paperclip className="size-4" />
        {busy ? 'Encrypting…' : prompt}
        <span className="text-[11px] text-faint">or drop here</span>
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept={accept}
        className="hidden"
        onChange={(e) => {
          void add([...(e.target.files ?? [])])
          e.target.value = ''
        }}
      />
    </div>
  )
}
