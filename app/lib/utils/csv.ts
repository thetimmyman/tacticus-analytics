// RFC 4180: every field quoted, quotes doubled, CRLF rows. Excel callers should prepend a UTF-8 BOM.

export type CsvCell = string | number | boolean | null | undefined

function escapeCell(cell: CsvCell): string {
  if (cell === null || cell === undefined) return '""'
  return `"${String(cell).replace(/"/g, '""')}"`
}

export function rowsToCsv(
  headers: string[],
  rows: readonly CsvCell[][]
): string {
  const lines = [headers.map(escapeCell).join(',')]
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(','))
  }
  return lines.join('\r\n')
}
