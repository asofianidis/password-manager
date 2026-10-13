import { BrowserWindow, dialog } from 'electron'
import { promises as fs } from 'fs'
import { basename } from 'path'
import { randomUUID } from 'crypto'
import { unzipSync, strFromU8 } from 'fflate'
import type { ExportFormat, ImportFile, ImportFormat, ImportPreview } from '../shared/types'
import { stringifyCsv } from '../shared/csv'
import {
  detectFormat,
  duplicateKey,
  normalizeImported,
  parseImport,
  type ImportedEntry
} from '../shared/importers'
import {
  AAD,
  DecryptionError,
  deriveKey,
  newKdfParams,
  openJson,
  sealJson,
  type KdfParams
} from './vault/crypto'
import { vault } from './vault/vault'
import { writeFileAtomic } from './fs-utils'

interface PendingImport {
  fileName: string
  text: string
  detectedFormat: ImportFormat | null
  parsed: ImportedEntry[] | null
}

const pending = new Map<string, PendingImport>()

const MAX_IMPORT_BYTES = 50 * 1024 * 1024

/** Pulls the relevant file out of ZIP-based exports (Dashlane ZIP, 1Password 1PUX). */
function extractFromZip(buffer: Buffer): string {
  const files = unzipSync(new Uint8Array(buffer))
  const names = Object.keys(files)
  const exportData = names.find((n) => basename(n) === 'export.data')
  if (exportData) return strFromU8(files[exportData])
  const credentials = names.find((n) => basename(n).toLowerCase() === 'credentials.csv')
  if (credentials) return strFromU8(files[credentials])
  const csv = names.find((n) => n.toLowerCase().endsWith('.csv'))
  if (csv) return strFromU8(files[csv])
  throw new Error(
    'The archive does not contain a supported export (credentials.csv or export.data).'
  )
}

export async function pickImportFile(window: BrowserWindow | null): Promise<ImportFile | null> {
  const options: Electron.OpenDialogOptions = {
    title: 'Import passwords',
    properties: ['openFile'],
    filters: [
      { name: 'Password exports', extensions: ['csv', 'json', 'zip', '1pux', 'pmbackup'] },
      { name: 'All files', extensions: ['*'] }
    ]
  }
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return null

  const path = result.filePaths[0]
  const stat = await fs.stat(path)
  if (stat.size > MAX_IMPORT_BYTES) throw new Error('File is too large to import.')
  const buffer = await fs.readFile(path)
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b
  const text = isZip ? extractFromZip(buffer) : buffer.toString('utf8')
  const fileName = basename(path)
  // Archives are reduced to the CSV/JSON inside them, so detect on that content
  const detectedFormat = detectFormat(isZip ? 'archive.csv' : fileName, text)

  const token = randomUUID()
  pending.set(token, { fileName, text, detectedFormat, parsed: null })
  return { token, fileName, detectedFormat, needsPassword: detectedFormat === 'pm-encrypted' }
}

interface EncryptedExport {
  format: 'pm-export'
  version: 1
  encrypted: true
  exportedAt: number
  kdf: KdfParams
  /** base64 sealed JSON { entries }, AAD = pm:export:v1 */
  data: string
}

interface PlainExport {
  format: 'pm-export'
  version: 1
  encrypted: false
  exportedAt: number
  entries: ExportedEntry[]
}

type ExportedEntry = Omit<ImportedEntry, 'createdAt' | 'updatedAt'> & {
  createdAt: number
  updatedAt: number
}

async function decryptExport(text: string, password: string): Promise<ImportedEntry[]> {
  const file = JSON.parse(text) as EncryptedExport
  const key = await deriveKey(password, file.kdf)
  try {
    const { entries } = openJson<{ entries: Partial<ImportedEntry>[] }>(
      key,
      file.data,
      AAD.exportData
    )
    return entries.map(normalizeImported)
  } catch (error) {
    if (error instanceof DecryptionError) throw new Error('Incorrect backup password.')
    throw error
  } finally {
    key.fill(0)
  }
}

export async function previewImport(
  token: string,
  requested: ImportFormat,
  password?: string
): Promise<ImportPreview> {
  const item = pending.get(token)
  if (!item) throw new Error('Import session expired. Choose the file again.')
  const format = requested === 'auto' ? item.detectedFormat : requested
  if (!format || format === 'auto') {
    throw new Error('Could not detect the file format. Choose the format manually.')
  }

  let entries: ImportedEntry[]
  const warnings: string[] = []
  if (format === 'pm-encrypted') {
    if (!password) throw new Error('This backup is encrypted. Enter its password.')
    entries = await decryptExport(item.text, password)
  } else {
    const parsed = parseImport(format, item.text)
    entries = parsed.entries
    warnings.push(...parsed.warnings)
  }

  const existing = new Set(vault.list().map(duplicateKey))
  const duplicates = entries.filter((e) => existing.has(duplicateKey(e))).length
  item.parsed = entries

  return {
    token,
    format,
    total: entries.length,
    duplicates,
    sample: entries.slice(0, 5).map(({ title, username, url }) => ({ title, username, url })),
    warnings
  }
}

export async function commitImport(token: string, skipDuplicates: boolean): Promise<number> {
  const item = pending.get(token)
  if (!item?.parsed) throw new Error('Preview the import before committing it.')
  const existing = new Set(vault.list().map(duplicateKey))
  const seen = new Set<string>()
  const toAdd = item.parsed.filter((entry) => {
    if (!skipDuplicates) return true
    const key = duplicateKey(entry)
    if (existing.has(key) || seen.has(key)) return false
    seen.add(key)
    return true
  })
  await vault.createEntries(toAdd)
  pending.delete(token)
  return toAdd.length
}

export function cancelImport(token: string): void {
  pending.delete(token)
}

function exportEntries(): ExportedEntry[] {
  return vault.list().map((e) => ({
    title: e.title,
    username: e.username,
    password: e.password,
    url: e.url,
    notes: e.notes,
    totp: e.totp,
    folder: e.folder,
    favorite: e.favorite,
    createdAt: e.createdAt,
    updatedAt: e.passwordUpdatedAt
  }))
}

export async function saveExport(
  window: BrowserWindow | null,
  format: ExportFormat,
  exportPassword?: string
): Promise<string | null> {
  if (format === 'pm-encrypted' && (!exportPassword || exportPassword.length < 8)) {
    throw new Error('Backup password must be at least 8 characters.')
  }

  const date = new Date().toISOString().slice(0, 10)
  const extension = format === 'csv' ? 'csv' : format === 'pm-encrypted' ? 'pmbackup' : 'json'
  const options: Electron.SaveDialogOptions = {
    title: 'Export passwords',
    defaultPath: `passwords-${date}.${extension}`,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
  }
  const result = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null

  const entries = exportEntries()
  let contents: string
  if (format === 'csv') {
    contents = stringifyCsv([
      ['title', 'url', 'username', 'password', 'notes', 'totp', 'folder', 'favorite'],
      ...entries.map((e) => [
        e.title,
        e.url,
        e.username,
        e.password,
        e.notes,
        e.totp,
        e.folder,
        e.favorite ? 'true' : 'false'
      ])
    ])
  } else if (format === 'pm-json') {
    const file: PlainExport = {
      format: 'pm-export',
      version: 1,
      encrypted: false,
      exportedAt: Date.now(),
      entries
    }
    contents = JSON.stringify(file, null, 2)
  } else {
    const kdf = newKdfParams()
    const key = await deriveKey(exportPassword!, kdf)
    try {
      const file: EncryptedExport = {
        format: 'pm-export',
        version: 1,
        encrypted: true,
        exportedAt: Date.now(),
        kdf,
        data: sealJson(key, { entries }, AAD.exportData)
      }
      contents = JSON.stringify(file)
    } finally {
      key.fill(0)
    }
  }

  await writeFileAtomic(result.filePath, contents)
  return result.filePath
}
