/** RFC 4180 CSV parser: handles quoted fields, escaped quotes, and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  while (i < input.length) {
    const ch = input[i]
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
      } else {
        field += ch
      }
      i++
      continue
    }

    if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      if (ch === '\r' && input[i + 1] === '\n') i++
    } else {
      field += ch
    }
    i++
  }

  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((r) => r.some((value) => value.trim() !== ''))
}

/** Parses CSV with a header row into objects keyed by lower-cased, trimmed header names. */
export function parseCsvRecords(text: string): {
  headers: string[]
  records: Record<string, string>[]
} {
  const [headerRow, ...rows] = parseCsv(text)
  if (!headerRow) return { headers: [], records: [] }
  const headers = headerRow.map((h) => h.trim().toLowerCase())
  const records = rows.map((row) => {
    const record: Record<string, string> = {}
    headers.forEach((header, index) => {
      if (header && record[header] === undefined) record[header] = row[index] ?? ''
    })
    return record
  })
  return { headers, records }
}

function escapeField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function stringifyCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeField).join(',')).join('\r\n') + '\r\n'
}
