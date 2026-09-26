'use client'

import { useState, useRef, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@tacticus/ui-kit'
import { Button } from '@tacticus/ui-kit'
import { extractErrorMessage } from '@/app/lib/utils/error-message'
import { computeSeasonAndWarNumberFromStart } from '@/app/lib/war/guild-war-parser'
import {
  Upload,
  Download,
  CheckCircle2,
  XCircle,
  Info,
  FileJson,
  Trash2,
  Swords,
  Map,
  Target,
  Users
} from 'lucide-react'

interface WarDataImportProps {
  guildCode: string
  userRole: string
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

// Seasons auto-derive from the war start; the dropdown covers manual backfills.
const MIN_LABELED_SEASON = 21
const CURRENT_SEASON = computeSeasonAndWarNumberFromStart(Date.now()).season
const SEASON_OPTIONS = Array.from(
  { length: Math.max(CURRENT_SEASON + 2 - MIN_LABELED_SEASON, 0) },
  (_, i) => CURRENT_SEASON + 1 - i
)

function payloadAspects(p: unknown): { war: boolean; status: boolean } {
  let war = false
  let status = false
  if (!isPlainObject(p)) return { war, status }

  const eventResults = p.eventResults
  if (Array.isArray(eventResults)) {
    for (const r of eventResults) {
      const erd = isPlainObject(r) ? r.eventResponseData : undefined
      if (!isPlainObject(erd)) continue
      if (Array.isArray(erd.activityLogs)) war = true
      const gws = erd.guildWarStatus
      if (isPlainObject(gws) && Array.isArray(gws.members)) status = true
    }
  }

  const player = p.player
  if (isPlainObject(player)) {
    const hero = player.hero
    const live = isPlainObject(hero) ? hero.liveEvents : undefined
    if (isPlainObject(live) && Array.isArray(live.liveEvents)) war = true
  }

  return { war, status }
}

function describeRawPayload(parsed: unknown): {
  warResponses: number
  statusResponses: number
} {
  const payloads = Array.isArray(parsed) ? parsed : [parsed]
  let warResponses = 0
  let statusResponses = 0
  for (const p of payloads) {
    const { war, status } = payloadAspects(p)
    if (war) warResponses++
    if (status) statusResponses++
  }
  return { warResponses, statusResponses }
}

interface ParsedPreview {
  wars: number
  zones: number
  attempts: number
  participation: number
}

interface ImportResult {
  success: boolean
  message: string
  counts?: ParsedPreview
}

export default function WarDataImport({
  guildCode,
  userRole
}: WarDataImportProps) {
  const [jsonText, setJsonText] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)
  const [preview, setPreview] = useState<ParsedPreview | null>(null)
  const [rawPreview, setRawPreview] = useState<{
    warResponses: number
    statusResponses: number
  } | null>(null)
  const [importing, setImporting] = useState(false)
  const [seasonOverride, setSeasonOverride] = useState<string>('auto')
  const [warNumberOverride, setWarNumberOverride] = useState<string>('auto')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [exporting, setExporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canManage = userRole === 'leader' || userRole === 'officer'

  const parseJson = useCallback((text: string) => {
    setParseError(null)
    setPreview(null)
    setRawPreview(null)
    setResult(null)

    if (!text.trim()) return

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      setParseError('Invalid JSON — check syntax and try again')
      return
    }

    if (!parsed || typeof parsed !== 'object') {
      setParseError(
        'Expected JSON — paste the app export or the raw in-game war JSON'
      )
      return
    }

    const obj = parsed as Record<string, unknown>

    // An array, or an object without a top-level "wars" array; parsed server-side.
    if (Array.isArray(parsed) || !Array.isArray(obj.wars)) {
      const desc = describeRawPayload(parsed)
      if (desc.warResponses === 0 && desc.statusResponses === 0) {
        setParseError(
          'Unrecognized JSON. Paste the app export ({ "wars": [...] }) or the raw in-game GET_GUILD_WAR_ACTIVITY_LOGS / GET_GUILD_WAR_STATUS response.'
        )
        return
      }
      setRawPreview(desc)
      return
    }

    if (obj.wars.length === 0) {
      setParseError('The "wars" array is empty')
      return
    }

    if (obj.wars.length > 50) {
      setParseError(
        `Too many wars (${obj.wars.length}) — maximum is 50 per import`
      )
      return
    }

    for (let i = 0; i < obj.wars.length; i++) {
      const war = obj.wars[i] as Record<string, unknown>
      if (!war.war_id) {
        setParseError(`wars[${i}]: missing required field "war_id"`)
        return
      }
      if (!war.opponent_guild_name) {
        setParseError(
          `wars[${i}]: missing required field "opponent_guild_name"`
        )
        return
      }
      if (!war.war_status) {
        setParseError(`wars[${i}]: missing required field "war_status"`)
        return
      }
    }

    let zones = 0
    let attempts = 0
    let participation = 0
    for (const war of obj.wars) {
      const w = war as Record<string, unknown>
      const warZones = Array.isArray(w.zones) ? w.zones : []
      zones += warZones.length
      for (const zone of warZones) {
        const z = zone as Record<string, unknown>
        attempts += Array.isArray(z.attempts) ? z.attempts.length : 0
      }
      participation += Array.isArray(w.participation)
        ? (w.participation as unknown[]).length
        : 0
    }

    setPreview({
      wars: obj.wars.length,
      zones,
      attempts,
      participation
    })
  }, [])

  const handleTextChange = (text: string) => {
    setJsonText(text)
    parseJson(text)
  }

  const handleFileUpload = (file: File) => {
    if (!file.name.endsWith('.json')) {
      setParseError('Only .json files are accepted')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setParseError('File too large — maximum 10 MB')
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      setJsonText(text)
      parseJson(text)
    }
    reader.onerror = () => {
      setParseError('Failed to read file')
    }
    reader.readAsText(file)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFileUpload(file)
  }

  const handleClear = () => {
    setJsonText('')
    setParseError(null)
    setPreview(null)
    setRawPreview(null)
    setResult(null)
    setSeasonOverride('auto')
    setWarNumberOverride('auto')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleImport = async () => {
    if ((!preview && !rawPreview) || importing) return

    try {
      setImporting(true)
      setResult(null)

      const overrides: Record<string, number> = {}
      if (seasonOverride !== 'auto')
        overrides.war_season = Number(seasonOverride)
      if (warNumberOverride !== 'auto')
        overrides.war_number = Number(warNumberOverride)

      const response = await fetch('/api/guild-war/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guild_code: guildCode,
          data: JSON.parse(jsonText),
          ...(Object.keys(overrides).length > 0 ? { overrides } : {})
        })
      })

      // Proxy errors can return HTML or empty bodies that make `.json()` throw.
      const rawText = await response.text()
      let data: Record<string, unknown> | null = null
      if (rawText) {
        try {
          data = JSON.parse(rawText) as Record<string, unknown>
        } catch {
          data = null
        }
      }

      if (!response.ok) {
        const detail =
          data && Array.isArray(data.details)
            ? data.details.join(', ')
            : extractErrorMessage(
                data,
                'The server returned an unreadable response. Please try again.'
              )
        setResult({ success: false, message: detail })
        return
      }

      if (!data) {
        // An unparseable 2xx is a failure, not a crash or a silent paste clear.
        setResult({
          success: false,
          message:
            'The server returned an unreadable response. Please try again.'
        })
        return
      }

      // A 200 can carry row-level failures; keep the paste so the operator can retry.
      const succeeded = data.success !== false
      setResult({
        success: succeeded,
        message:
          typeof data.message === 'string' ? data.message : 'Import failed',
        counts: data.counts as ParsedPreview | undefined
      })
      if (!succeeded) return
      setJsonText('')
      setPreview(null)
      setRawPreview(null)
      setSeasonOverride('auto')
      setWarNumberOverride('auto')
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      setResult({
        success: false,
        message: err instanceof Error ? err.message : 'Import failed'
      })
    } finally {
      setImporting(false)
    }
  }

  const handleExport = async () => {
    try {
      setExporting(true)
      const response = await fetch('/api/guild-war/export?limit=20')
      if (!response.ok) {
        const data = await response.json()
        setResult({
          success: false,
          message: extractErrorMessage(data, 'Export failed')
        })
        return
      }
      const data = await response.json()
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json'
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `war-data-${guildCode}-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setResult({
        success: false,
        message: err instanceof Error ? err.message : 'Export failed'
      })
    } finally {
      setExporting(false)
    }
  }

  const handleDownloadTemplate = () => {
    // A real zone type id: the schema accepts any string and a placeholder would render as a name.
    const template = {
      wars: [
        {
          war_id: 'example-war-001',
          opponent_guild_name: 'Opponent Guild Name',
          war_status: 'completed',
          war_result: 'win',
          guild_score: 1500,
          opponent_score: 1200,
          war_start_date: '2025-01-01T00:00:00Z',
          war_end_date: '2025-01-02T00:00:00Z',
          war_season: 1,
          battlefield_level: 5,
          zones: [
            {
              zone_number: 1,
              zone_type: 'Trenches1',
              zone_status: 'completed',
              assigned_players: ['player-uuid-1'],
              attempts: [
                {
                  player_id: 'player-uuid-1',
                  player_name: 'PlayerName',
                  attempt_number: 1,
                  attempt_status: 'success',
                  attempt_result: 'win',
                  damage_dealt: 5000,
                  score_earned: 100
                }
              ]
            }
          ],
          participation: [
            {
              user_id: 'player-uuid-1',
              display_name: 'PlayerName',
              opted_in: true,
              attempts_used: 1,
              attempts_remaining: 2,
              score: 100
            }
          ]
        }
      ]
    }
    const blob = new Blob([JSON.stringify(template, null, 2)], {
      type: 'application/json'
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'war-import-template.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  // The tab shows for every role, so explain who can import.
  if (!canManage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Import / Export War Data
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/30">
            <div className="flex items-start gap-2">
              <Info className="h-5 w-5 text-blue-400 mt-0.5 shrink-0" />
              <div className="text-sm text-blue-400/90">
                <p>
                  Only guild <strong>leaders</strong> and{' '}
                  <strong>officers</strong> can import war data. Your current
                  role is{' '}
                  <code className="bg-blue-500/20 px-1 rounded">
                    {userRole}
                  </code>
                  .
                </p>
                <p className="mt-2">
                  Send your war JSON to a leader or officer, and they can import
                  it from this page.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Import / Export War Data
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={exporting}
          >
            <Download className="h-4 w-4 mr-2" />
            {exporting ? 'Exporting...' : 'Export Wars'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Info banner */}
        <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/30">
          <div className="flex items-start gap-2">
            <Info className="h-5 w-5 text-blue-400 mt-0.5 shrink-0" />
            <div className="text-sm text-blue-400/90">
              <p>
                Paste the raw in-game war JSON (the LOKI{' '}
                <code className="bg-blue-500/20 px-1 rounded">
                  GET_GUILD_WAR_ACTIVITY_LOGS
                </code>{' '}
                and/or{' '}
                <code className="bg-blue-500/20 px-1 rounded">
                  GET_GUILD_WAR_STATUS
                </code>{' '}
                response), or the app&apos;s own export, or upload a{' '}
                <code className="bg-blue-500/20 px-1 rounded">.json</code> file.
                Full battle data needs the activity-logs response;
                opt-ins/attempts need the status response. Existing records with
                the same war ID are updated.
              </p>
            </div>
          </div>
        </div>

        {/* Result banners */}
        {result?.success && (
          <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-400 mt-0.5" />
              <p className="text-green-400">{result.message}</p>
            </div>
          </div>
        )}

        {result && !result.success && (
          <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30">
            <div className="flex items-start gap-2">
              <XCircle className="h-5 w-5 text-red-400 mt-0.5" />
              <div>
                <p className="text-red-400 font-medium">Import Failed</p>
                <p className="text-red-400/80 text-sm">{result.message}</p>
              </div>
            </div>
          </div>
        )}

        {/* Textarea with drag-and-drop */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`relative rounded-lg transition-colors ${
            isDragOver ? 'ring-2 ring-[var(--accent)]' : ''
          }`}
        >
          <textarea
            value={jsonText}
            onChange={(e) => handleTextChange(e.target.value)}
            rows={12}
            placeholder={`{
  "wars": [
    {
      "war_id": "war-123",
      "opponent_guild_name": "Enemy Guild",
      "war_status": "completed",
      "war_result": "win",
      "guild_score": 1500,
      "opponent_score": 1200,
      "zones": [...],
      "participation": [...]
    }
  ]
}`}
            className={`w-full px-3 py-2 bg-[color-mix(in_srgb,var(--bg-secondary)_50%,transparent)] border rounded-lg
              text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]
              focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_50%,transparent)] focus:border-[var(--accent)]
              transition-colors resize-y font-mono text-sm
              ${parseError ? 'border-red-400 focus:border-red-400 focus:ring-red-400/50' : 'border-[var(--card-border)]'}`}
          />
          {isDragOver && (
            <div className="absolute inset-0 flex items-center justify-center bg-[color-mix(in_srgb,var(--bg-primary)_80%,transparent)] rounded-lg border-2 border-dashed border-[var(--accent)]">
              <div className="flex items-center gap-2 text-[var(--accent)]">
                <FileJson className="h-6 w-6" />
                <span className="font-medium">Drop .json file here</span>
              </div>
            </div>
          )}
        </div>

        {/* Parse error */}
        {parseError && <p className="text-red-400 text-sm">{parseError}</p>}

        {/* File upload + template buttons */}
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFileUpload(file)
            }}
            className="hidden"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileJson className="h-4 w-4 mr-2" />
            Upload .json file
          </Button>
          <Button variant="ghost" size="sm" onClick={handleDownloadTemplate}>
            <Download className="h-4 w-4 mr-2" />
            Download template
          </Button>
        </div>

        {/* Preview summary */}
        {preview && (
          <div className="p-4 rounded-lg bg-[color-mix(in_srgb,var(--bg-secondary)_50%,transparent)] border border-[var(--card-border)]">
            <p className="text-sm font-medium text-[var(--text-primary)] mb-3">
              Import Preview
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="flex items-center gap-2">
                <Swords className="h-4 w-4 text-[var(--text-secondary)]" />
                <span className="text-sm text-[var(--text-secondary)]">
                  <span className="font-medium text-[var(--text-primary)]">
                    {preview.wars}
                  </span>{' '}
                  war{preview.wars !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Map className="h-4 w-4 text-[var(--text-secondary)]" />
                <span className="text-sm text-[var(--text-secondary)]">
                  <span className="font-medium text-[var(--text-primary)]">
                    {preview.zones}
                  </span>{' '}
                  zone{preview.zones !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-[var(--text-secondary)]" />
                <span className="text-sm text-[var(--text-secondary)]">
                  <span className="font-medium text-[var(--text-primary)]">
                    {preview.attempts}
                  </span>{' '}
                  attempt{preview.attempts !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-[var(--text-secondary)]" />
                <span className="text-sm text-[var(--text-secondary)]">
                  <span className="font-medium text-[var(--text-primary)]">
                    {preview.participation}
                  </span>{' '}
                  player{preview.participation !== 1 ? 's' : ''}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Raw in-game JSON preview */}
        {rawPreview && (
          <div className="p-4 rounded-lg bg-[color-mix(in_srgb,var(--bg-secondary)_50%,transparent)] border border-[var(--card-border)]">
            <p className="text-sm font-medium text-[var(--text-primary)] mb-2">
              Raw in-game war data detected
            </p>
            <div className="space-y-1 text-sm text-[var(--text-secondary)]">
              <div className="flex items-center gap-2">
                <Swords className="h-4 w-4" />
                <span>
                  <span className="font-medium text-[var(--text-primary)]">
                    {rawPreview.warResponses}
                  </span>{' '}
                  battle/zone response{rawPreview.warResponses !== 1 ? 's' : ''}
                  {rawPreview.warResponses === 0 && (
                    <span className="text-[var(--text-tertiary)]">
                      {' '}
                      — paste GET_GUILD_WAR_ACTIVITY_LOGS for battles
                    </span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                <span>
                  <span className="font-medium text-[var(--text-primary)]">
                    {rawPreview.statusResponses}
                  </span>{' '}
                  roster/status response
                  {rawPreview.statusResponses !== 1 ? 's' : ''}
                  {rawPreview.statusResponses === 0 && (
                    <span className="text-[var(--text-tertiary)]">
                      {' '}
                      — paste GET_GUILD_WAR_STATUS for opt-ins/attempts
                    </span>
                  )}
                </span>
              </div>
            </div>
            {/* Overrides for backfills the calendar cannot label. */}
            <div className="mt-3 flex flex-wrap items-end gap-4">
              <label className="text-xs text-[var(--text-secondary)]">
                <span className="block mb-1">Season</span>
                <select
                  value={seasonOverride}
                  onChange={(e) => setSeasonOverride(e.target.value)}
                  className="rounded-md border border-[var(--card-border)] bg-[var(--bg-secondary)] px-2 py-1 text-sm text-[var(--text-primary)]"
                >
                  <option value="auto">Auto-detect</option>
                  {SEASON_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      Season {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-[var(--text-secondary)]">
                <span className="block mb-1">War (battle)</span>
                <select
                  value={warNumberOverride}
                  onChange={(e) => setWarNumberOverride(e.target.value)}
                  className="rounded-md border border-[var(--card-border)] bg-[var(--bg-secondary)] px-2 py-1 text-sm text-[var(--text-primary)]"
                >
                  <option value="auto">Auto-detect</option>
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      War {n} of 6
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-[var(--text-tertiary)] max-w-xs">
                Auto-detect reads the season and war number from the war&apos;s
                start date. Override only if the data predates season{' '}
                {MIN_LABELED_SEASON}.
              </p>
            </div>
            <p className="mt-2 text-xs text-[var(--text-tertiary)]">
              Parsed and ingested on import, identical to an automatic sync.
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-3">
          {jsonText && (
            <Button variant="outline" size="sm" onClick={handleClear}>
              <Trash2 className="h-4 w-4 mr-2" />
              Clear
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleImport}
            disabled={(!preview && !rawPreview) || importing}
          >
            <Upload className="h-4 w-4 mr-2" />
            {importing ? 'Importing...' : 'Import Data'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
