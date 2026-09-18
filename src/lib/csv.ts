/** Serialise a matrix of cells to RFC-4180-ish CSV (CRLF rows, quoted when needed). */
export function toCSV(rows: Array<Array<string | number | null | undefined>>): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const s = cell == null ? '' : String(cell)
          return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
        })
        .join(','),
    )
    .join('\r\n')
}

const DELIMITER_CANDIDATES = [',', ';', '\t'] as const

/**
 * Guess the field delimiter from the first few lines. Handles the common
 * European convention of `;` (often paired with `,` as the decimal separator,
 * e.g. Dutch/German Excel) as well as plain commas and tab-separated exports.
 */
export function detectDelimiter(text: string): string {
  const sample = text.split(/\r\n|\r|\n/, 5).join('\n')
  let best: string = ','
  let bestCount = 0
  for (const d of DELIMITER_CANDIDATES) {
    const count = sample.split(d).length - 1
    if (count > bestCount) {
      bestCount = count
      best = d
    }
  }
  return best
}

/**
 * Parse CSV text into a matrix of strings. Handles quoted fields and CRLF/LF.
 * `delimiter` defaults to an auto-detected one (comma, semicolon, or tab).
 */
export function parseCSV(text: string, delimiter?: string): string[][] {
  const delim = delimiter ?? detectDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const n = text.length

  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
  }

  while (i < n) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === delim) {
      endField()
      i++
      continue
    }
    if (ch === '\r') {
      i++
      continue
    }
    if (ch === '\n') {
      endRow()
      i++
      continue
    }
    field += ch
    i++
  }
  // trailing field / row
  if (field.length > 0 || row.length > 0) endRow()
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ''))
}

/** Save text via the Electron native dialog when available, else a browser download. */
export async function saveTextFile(defaultName: string, contents: string): Promise<void> {
  const api = (window as unknown as { api?: { saveFile?: (n: string, c: string) => Promise<unknown> } }).api
  if (api?.saveFile) {
    await api.saveFile(defaultName, contents)
    return
  }
  const blob = new Blob([contents], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = defaultName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Read a text file via the Electron native dialog when available, else an <input type=file>. */
export async function openTextFile(extensions: string[]): Promise<string | null> {
  const api = (
    window as unknown as {
      api?: { openFile?: (e: string[]) => Promise<{ ok: boolean; contents?: string }> }
    }
  ).api
  if (api?.openFile) {
    const res = await api.openFile(extensions)
    return res.ok && res.contents != null ? res.contents : null
  }
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = extensions.map((e) => '.' + e).join(',')
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.onerror = () => resolve(null)
      reader.readAsText(file)
    }
    input.click()
  })
}
