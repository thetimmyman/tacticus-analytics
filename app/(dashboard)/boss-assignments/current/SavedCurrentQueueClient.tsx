'use client'

import { useEffect, useRef, useState } from 'react'
import {
  MAX_TOKENS,
  SEASON_MAX_SPENDABLE_TOKENS
} from '@/app/lib/calculations/token-calculation'
import { MAX_GUILD_MEMBERS } from '@/app/lib/season-forecast/season-outlook-reduce'
import {
  savedState,
  replacementSummary,
  clearSummary
} from '@/app/lib/boss-assignments/saved-assignments-input'
import type { SavedAssignments } from '@/app/lib/boss-assignments/saved-assignments-types'
import type { SavedQueueCalculation } from '@/app/lib/boss-assignments/saved-queue-types'

export interface SavedCurrentQueueClientProps {
  contextKey: string
  season: string
  seasons: string[]
  canCalculate: boolean
}

const READ_ERROR =
  'Saved assignment intent unavailable. Reload the current saved season.'
const MODEL_ERROR =
  'Saved queue could not be calculated. Saved assignment intent is unchanged.'
const UNKNOWN_WRITE =
  'Saved assignment outcome unavailable; reload the current saved season before retrying'
const MAX_RESPONSE_BYTES = 1024 * 1024

type RecordValue = Record<string, unknown>
function object(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid queue response')
  return value as RecordValue
}
function fields(value: unknown, names: string[]): RecordValue {
  const row = object(value)
  if (
    Object.keys(row).length !== names.length ||
    !Object.keys(row).every((key) => names.includes(key))
  )
    throw new Error('Invalid queue fields')
  return row
}
function text(value: unknown, max = 1024): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    throw new Error('Invalid queue label')
  return value
}
function identifier(value: unknown): string {
  const id = text(value, 256)
  if (!id || id.trim() !== id) throw new Error('Invalid queue player')
  return id
}
function number(
  value: unknown,
  max = Number.MAX_SAFE_INTEGER,
  integer = false
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > max ||
    (integer && !Number.isSafeInteger(value))
  )
    throw new Error('Invalid queue metric')
  return value
}
function bool(value: unknown) {
  if (typeof value !== 'boolean') throw new Error('Invalid queue flag')
  return value
}
function timestamp(value: unknown): string {
  const result = text(value, 30)
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(result) ||
    !Number.isFinite(Date.parse(result)) ||
    new Date(result).toISOString() !== result
  )
    throw new Error('Invalid queue time')
  return result
}
function stageIdentity(value: unknown) {
  const row = object(value)
  if (typeof row.stageCode !== 'string' || !/^[ML][1-5]$/.test(row.stageCode))
    throw new Error('Invalid queue stage')
  return {
    stageCode: row.stageCode,
    loopIndex: number(row.loopIndex, 2147483647, true)
  }
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    throw new Error('Invalid queue list')
  return value
}
function readSaved(
  value: unknown,
  season: string,
  action: 'read' | 'replace' | 'clear' = 'read'
): SavedAssignments {
  const body = object(value)
  if (
    !Object.keys(body).every((key) =>
      [
        'source',
        'season',
        'assignments',
        'bosses',
        'canReplace',
        'canClear',
        'summary',
        'deleted'
      ].includes(key)
    ) ||
    body.source !== 'saved-local' ||
    body.season !== season
  )
    throw new Error('Invalid saved intent')
  if (action === 'replace') replacementSummary(body.summary)
  if (action === 'clear') clearSummary(body.deleted)
  if (
    action === 'read' &&
    (Object.hasOwn(body, 'summary') || Object.hasOwn(body, 'deleted'))
  )
    throw new Error('Unexpected mutation receipt')
  return {
    source: 'saved-local',
    season,
    ...savedState(body.assignments, body.bosses),
    canReplace: bool(body.canReplace),
    canClear: bool(body.canClear)
  }
}
function readCalculation(
  value: unknown,
  season: string,
  asOf: string
): SavedQueueCalculation {
  const body = fields(value, [
    'source',
    'season',
    'configId',
    'asOf',
    'timeZone',
    'rosterSource',
    'players',
    'stages',
    'replacement',
    'metrics',
    'feasibility',
    'warnings'
  ])
  if (
    body.source !== 'saved-season' ||
    body.season !== season ||
    body.asOf !== asOf ||
    body.rosterSource !== 'current-saved-roster' ||
    !text(body.configId, 256)
  )
    throw new Error('Queue context mismatch')
  const timeZone = text(body.timeZone, 100)
  new Intl.DateTimeFormat('en', { timeZone })
  const ids = new Set<string>()
  const players = list(body.players, MAX_GUILD_MEMBERS).map((value) => {
    const row = fields(value, [
      'playerId',
      'displayName',
      'tier',
      'currentTokens',
      'nextRegenAt',
      'tokensUsedThisSeason',
      'spendableByEnd',
      'tokensPlanned'
    ])
    const playerId = identifier(row.playerId)
    if (ids.has(playerId)) throw new Error('Duplicate queue player')
    ids.add(playerId)
    if (
      typeof row.tier !== 'string' ||
      !['strong', 'mid', 'developing'].includes(row.tier)
    )
      throw new Error('Invalid queue tier')
    if (row.nextRegenAt !== null) timestamp(row.nextRegenAt)
    return {
      playerId,
      displayName: text(row.displayName),
      tier: row.tier,
      currentTokens: number(row.currentTokens, MAX_TOKENS, true),
      nextRegenAt: row.nextRegenAt,
      tokensUsedThisSeason: number(
        row.tokensUsedThisSeason,
        SEASON_MAX_SPENDABLE_TOKENS,
        true
      ),
      spendableByEnd: number(
        row.spendableByEnd,
        SEASON_MAX_SPENDABLE_TOKENS,
        true
      ),
      tokensPlanned: number(
        row.tokensPlanned,
        SEASON_MAX_SPENDABLE_TOKENS,
        true
      )
    }
  })
  const stagesSeen = new Set<string>()
  const stageTotals = new Map<string, number>()
  let allTokens = 0
  const stages = list(body.stages, 50).map((value) => {
    const row = fields(value, [
      'stageCode',
      'loopIndex',
      'projectedStartAt',
      'inboundDurationSeconds',
      'inboundDurationSource',
      'conditionalOnPriorClear',
      'assignments',
      'projections'
    ])
    const identity = stageIdentity(row)
    const key = JSON.stringify(identity)
    if (stagesSeen.has(key)) throw new Error('Duplicate queue stage')
    stagesSeen.add(key)
    if (Date.parse(timestamp(row.projectedStartAt)) < Date.parse(asOf))
      throw new Error('Invalid projected time')
    if (row.inboundDurationSeconds !== null) number(row.inboundDurationSeconds)
    if (
      ![null, 'current_season', 'rolling_window', 'fallback'].includes(
        row.inboundDurationSource as string | null
      )
    )
      throw new Error('Invalid duration source')
    bool(row.conditionalOnPriorClear)
    const assignmentKeys = new Set<string>()
    const assigned = list(row.assignments, 90).map((value) => {
      const a = fields(value, ['playerId', 'encounter', 'tokens'])
      const id = identifier(a.playerId)
      if (
        !ids.has(id) ||
        typeof a.encounter !== 'string' ||
        !['main', 'prime1', 'prime2'].includes(a.encounter)
      )
        throw new Error('Invalid stage assignment')
      const allocationKey = JSON.stringify([id, a.encounter])
      if (assignmentKeys.has(allocationKey))
        throw new Error('Duplicate stage assignment')
      assignmentKeys.add(allocationKey)
      const tokens = number(a.tokens, SEASON_MAX_SPENDABLE_TOKENS, true)
      allTokens += tokens
      stageTotals.set(id, (stageTotals.get(id) ?? 0) + tokens)
      return { playerId: id, encounter: a.encounter, tokens }
    })
    const projections = fields(row.projections, ['main', 'prime1', 'prime2'])
    for (const slot of ['main', 'prime1', 'prime2']) {
      const projection = projections[slot]
      if (slot !== 'main' && projection === null) {
        if (assigned.some((a) => a.encounter === slot))
          throw new Error('Missing prime projection')
        continue
      }
      const p = fields(projection, [
        'bossName',
        'startingHp',
        'projectedRemainingHp',
        'projectedDamage',
        'tokensPlanned',
        'isPrime'
      ])
      if (!text(p.bossName, 128) || bool(p.isPrime) !== (slot !== 'main'))
        throw new Error('Invalid encounter')
      number(p.startingHp)
      number(p.projectedDamage)
      if (number(p.projectedRemainingHp) > number(p.startingHp))
        throw new Error('Invalid remaining HP')
      if (
        number(
          p.tokensPlanned,
          MAX_GUILD_MEMBERS * SEASON_MAX_SPENDABLE_TOKENS,
          true
        ) !==
        assigned
          .filter((a) => a.encounter === slot)
          .reduce((sum, a) => sum + a.tokens, 0)
      )
        throw new Error('Projection allocation mismatch')
    }
    return row
  })
  const replacement = fields(body.replacement, [
    'asOf',
    'bosses',
    'assignments'
  ])
  if (replacement.asOf !== asOf) throw new Error('Replacement time mismatch')
  const bossLevels = new Map<string, RecordValue>()
  list(replacement.bosses, 10).forEach((value) => {
    const boss = fields(value, ['level', 'boss_name', 'sub_bosses'])
    if (
      typeof boss.level !== 'string' ||
      !/^[ML][1-5]$/.test(boss.level) ||
      bossLevels.has(boss.level) ||
      !text(boss.boss_name, 128)
    )
      throw new Error('Invalid replacement boss')
    const sub = fields(boss.sub_bosses, [
      'sub1',
      'sub2',
      'sub1_skip',
      'sub2_skip'
    ])
    text(sub.sub1, 128)
    text(sub.sub2, 128)
    bool(sub.sub1_skip)
    bool(sub.sub2_skip)
    bossLevels.set(boss.level, sub)
  })
  const assignedIds = new Set<string>()
  let replacementTotal = 0
  list(replacement.assignments, MAX_GUILD_MEMBERS).forEach((value) => {
    const a = fields(value, ['player_id', 'token_allocations'])
    const id = identifier(a.player_id)
    if (!ids.has(id) || assignedIds.has(id))
      throw new Error('Invalid replacement player')
    assignedIds.add(id)
    const allocation = object(a.token_allocations)
    if (Object.keys(allocation).length > 30)
      throw new Error('Invalid replacement allocation')
    let total = 0
    for (const [target, value] of Object.entries(allocation)) {
      const match = /^([ML][1-5])(?:_Sub([12]))?$/.exec(target)
      const sub = match ? bossLevels.get(match[1]!) : undefined
      if (
        !sub ||
        (match?.[2] && (!sub[`sub${match[2]}`] || sub[`sub${match[2]}_skip`]))
      )
        throw new Error('Invalid replacement target')
      total += number(value, SEASON_MAX_SPENDABLE_TOKENS, true)
    }
    if (total !== (stageTotals.get(id) ?? 0))
      throw new Error('Replacement allocation mismatch')
    replacementTotal += total
  })
  for (const player of players)
    if (
      player.tokensPlanned !== (stageTotals.get(player.playerId) ?? 0) ||
      player.tokensPlanned > player.spendableByEnd ||
      (player.tokensPlanned > 0 && !assignedIds.has(player.playerId))
    )
      throw new Error('Player budget mismatch')
  const metrics = fields(body.metrics, [
    'totalTokensPlanned',
    'projectedStages'
  ])
  if (
    number(
      metrics.totalTokensPlanned,
      MAX_GUILD_MEMBERS * SEASON_MAX_SPENDABLE_TOKENS,
      true
    ) !== allTokens ||
    replacementTotal !== allTokens ||
    number(metrics.projectedStages, 50, true) !== stages.length
  )
    throw new Error('Queue total mismatch')
  const feasibility = fields(body.feasibility, [
    'status',
    'stageStarts',
    'horizonEndExclusive',
    'projectedPrefix',
    'unsolvedRemainder',
    'sequenceLimitReached'
  ])
  if (
    feasibility.status !== 'tokens-verified-at-projected-starts' ||
    feasibility.stageStarts !== 'historical-estimate' ||
    feasibility.horizonEndExclusive !== true
  )
    throw new Error('Invalid feasibility')
  const prefix = fields(feasibility.projectedPrefix, [
    'fullyClearedStageCount',
    'firstUnclearedStage'
  ])
  number(prefix.fullyClearedStageCount, stages.length, true)
  if (prefix.firstUnclearedStage !== null)
    stageIdentity(
      fields(prefix.firstUnclearedStage, ['stageCode', 'loopIndex'])
    )
  list(feasibility.unsolvedRemainder, 50).forEach((value) => {
    const row = fields(value, ['stageCode', 'loopIndex', 'reason'])
    stageIdentity(row)
    if (
      ![
        'prior-stage-uncleared',
        'no-allocation',
        'outside-season-horizon'
      ].includes(row.reason as string) ||
      typeof row.reason !== 'string'
    )
      throw new Error('Invalid remainder')
  })
  bool(feasibility.sequenceLimitReached)
  list(body.warnings, 5).forEach((value) => {
    if (
      ![
        'fallback-stage-duration',
        'conditional-stage-progression',
        'no-damage-signal',
        'horizon-truncated',
        'stage-limit-reached'
      ].includes(value as string) ||
      typeof value !== 'string'
    )
      throw new Error('Invalid warning')
  })
  return body as unknown as SavedQueueCalculation
}

/** Bound even error-body consumption; never decode or expose an error body. */
async function responseBody(
  response: Response,
  json: boolean,
  signal: AbortSignal
): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Empty response')
  let canceled = false
  const cancel = () => {
    if (!canceled) {
      canceled = true
      void reader.cancel().catch(() => {})
    }
  }
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (let i = 0; i < 4096; i++) {
      if (signal.aborted) throw new Error('Queue body stopped')
      const next = await reader.read()
      if (signal.aborted) throw new Error('Queue body stopped')
      if (next.done) {
        if (!json) return null
        const bytes = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) {
          bytes.set(chunk, offset)
          offset += chunk.length
        }
        return JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        ) as unknown
      }
      size += next.value.byteLength
      if (size > MAX_RESPONSE_BYTES) throw new Error('Response too large')
      if (json) chunks.push(next.value)
    }
    throw new Error('Response too fragmented')
  } catch (error) {
    cancel()
    throw error
  } finally {
    signal.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
}
class QueueResponseError extends Error {
  constructor(readonly status: number) {
    super('Queue response refused')
  }
}
function refusedAuthority(error: unknown) {
  return (
    error instanceof QueueResponseError &&
    (error.status === 401 || error.status === 403)
  )
}
function displayLabel(
  name: string,
  id: string,
  ordinal: number,
  labels: string[] = []
) {
  if (!name.trim() || name.trim() === id.trim()) return `Member ${ordinal + 1}`
  return labels.filter((label) => label.trim() === name.trim()).length > 1
    ? `${name} (member ${ordinal + 1})`
    : name
}

type Draft = {
  model: SavedQueueCalculation
  edited: boolean
  rows: { id: string; name: string; allocations: [string, string][] }[]
}
type View = {
  season: string
  data: SavedAssignments | null
  input: string
  draft: Draft | null
  error: string | null
  status: string | null
  confirmation: 'replace' | 'clear' | null
  busy: boolean
  writing: boolean
  unknown: boolean
}
type Operation = {
  season: string
  controller: AbortController
  write: boolean
  uncertain: boolean
  timedOut: boolean
  stopped: Promise<never>
  timer: ReturnType<typeof setTimeout>
}
function emptyView(season: string, unknown = false): View {
  return {
    season,
    data: null,
    input: '',
    draft: null,
    error: unknown ? UNKNOWN_WRITE : null,
    status: null,
    confirmation: null,
    busy: false,
    writing: false,
    unknown
  }
}

export default function SavedCurrentQueueClient(
  props: SavedCurrentQueueClientProps
) {
  return <QueueForm key={props.contextKey} {...props} />
}
function QueueForm({
  season: providedSeason,
  seasons,
  canCalculate
}: SavedCurrentQueueClientProps) {
  const [selection, setSelection] = useState({
    provided: providedSeason,
    value: providedSeason
  })
  const season =
    selection.provided === providedSeason ? selection.value : providedSeason
  useEffect(() => {
    setSelection({ provided: providedSeason, value: providedSeason })
  }, [providedSeason])
  const barriers = useRef(new Set<string>())
  const authority = useRef(canCalculate)
  const currentSeason = useRef(season)
  currentSeason.current = season
  const active = useRef<Operation | null>(null)
  const [view, setView] = useState<View>(() => emptyView(season))
  const visible =
    view.season === season
      ? view
      : emptyView(season, barriers.current.has(season))
  const current = (operation: Operation) =>
    active.current === operation &&
    currentSeason.current === operation.season &&
    !operation.controller.signal.aborted
  function update(operation: Operation, change: Partial<View>) {
    if (current(operation))
      setView((old) =>
        old.season === operation.season ? { ...old, ...change } : old
      )
  }
  function markUnknown(op: Operation) {
    if (!op.uncertain) {
      op.uncertain = true
      barriers.current.add(op.season)
    }
  }
  function stop() {
    const op = active.current
    if (!op) return
    if (op.write) markUnknown(op)
    op.controller.abort()
    clearTimeout(op.timer)
    active.current = null
  }
  function failure(op: Operation, change: Partial<View>) {
    if (active.current === op && currentSeason.current === op.season)
      setView((old) => (old.season === op.season ? { ...old, ...change } : old))
  }
  function begin(write = false) {
    stop()
    const controller = new AbortController()
    const stopped = new Promise<never>((_, reject) =>
      controller.signal.addEventListener(
        'abort',
        () => reject(new Error('Queue request stopped')),
        { once: true }
      )
    )
    const op: Operation = {
      season,
      controller,
      write,
      uncertain: false,
      timedOut: false,
      stopped,
      timer: setTimeout(() => {
        op.timedOut = true
        controller.abort()
      }, 10000)
    }
    active.current = op
    setView((old) => ({
      ...old,
      busy: true,
      writing: write,
      error: null,
      status: null,
      confirmation: null
    }))
    return op
  }
  async function request(
    operation: Operation,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    body?: unknown
  ) {
    const url =
      method === 'POST'
        ? '/api/guild-raid/unified-assignments'
        : `/api/guild-raid/saved-assignments?season_number=${operation.season}`
    const response = await Promise.race([
      fetch(url, {
        method,
        cache: 'no-store',
        signal: operation.controller.signal,
        ...(body !== undefined
          ? {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            }
          : {})
      }),
      operation.stopped
    ])
    let result: unknown
    try {
      result = await Promise.race([
        responseBody(response, response.ok, operation.controller.signal),
        operation.stopped
      ])
    } catch (error) {
      if (!response.ok) throw new QueueResponseError(response.status)
      throw error
    }
    if (!response.ok) throw new QueueResponseError(response.status)
    return result
  }
  function finish(operation: Operation) {
    clearTimeout(operation.timer)
    if (active.current === operation) {
      active.current = null
      setView((old) =>
        old.season === operation.season
          ? { ...old, busy: false, writing: false }
          : old
      )
    }
  }
  async function reload() {
    const op = begin()
    try {
      const data = readSaved(await request(op, 'GET'), season)
      if (current(op)) {
        barriers.current.delete(season)
        update(op, { data, draft: null, unknown: false, error: null })
      }
    } catch (error) {
      failure(op, {
        error: barriers.current.has(season) ? UNKNOWN_WRITE : READ_ERROR,
        ...(refusedAuthority(error) ? { data: null, draft: null } : {})
      })
    } finally {
      finish(op)
    }
  }
  useEffect(() => {
    stop()
    setView(emptyView(season, barriers.current.has(season)))
    if (!barriers.current.has(season)) void reload()
    return stop
    // Scope transitions retain barriers but reset every visible private value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season])
  useEffect(() => {
    if (authority.current === canCalculate) return
    authority.current = canCalculate
    if (!canCalculate) {
      stop()
      setView((old) => ({
        ...old,
        input: '',
        draft: null,
        confirmation: null,
        busy: false,
        writing: false,
        status: null,
        unknown: barriers.current.has(season),
        error: barriers.current.has(season) ? UNKNOWN_WRITE : old.error
      }))
    }
    // Revocation also fences work if a caller retains the same opaque key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCalculate])
  function changeTime(value: string) {
    if (active.current?.write) return
    stop()
    setView((old) => ({
      ...old,
      input: value,
      draft: null,
      error: old.unknown ? UNKNOWN_WRITE : null,
      status: null,
      confirmation: null,
      busy: false
    }))
  }
  async function calculate() {
    if (
      !canCalculate ||
      !visible.data?.canReplace ||
      visible.busy ||
      visible.unknown ||
      !visible.input
    )
      return
    const op = begin()
    update(op, { draft: null })
    try {
      const asOf = new Date(`${visible.input}Z`).toISOString()
      const model = readCalculation(
        await request(op, 'POST', { season_number: season, asOf }),
        season,
        asOf
      )
      const allocations = new Map(
        model.replacement.assignments.map((row) => [
          row.player_id,
          row.token_allocations
        ])
      )
      const targets = model.replacement.bosses.flatMap((boss) => [
        boss.level,
        ...(boss.sub_bosses.sub1 && !boss.sub_bosses.sub1_skip
          ? [`${boss.level}_Sub1`]
          : []),
        ...(boss.sub_bosses.sub2 && !boss.sub_bosses.sub2_skip
          ? [`${boss.level}_Sub2`]
          : [])
      ])
      update(op, {
        draft: {
          model,
          edited: false,
          rows: model.players.map((player) => ({
            id: player.playerId,
            name: player.displayName,
            allocations: targets.map((target) => [
              target,
              String(allocations.get(player.playerId)?.[target] ?? 0)
            ])
          }))
        }
      })
    } catch (error) {
      failure(op, {
        error: MODEL_ERROR,
        draft: null,
        ...(refusedAuthority(error) ? { data: null } : {})
      })
    } finally {
      finish(op)
    }
  }
  function edit(row: number, target: number, value: string) {
    if (visible.busy || visible.unknown) return
    setView((old) =>
      old.draft
        ? {
            ...old,
            confirmation: null,
            status: null,
            draft: {
              ...old.draft,
              edited: true,
              rows: old.draft.rows.map((item, index) =>
                index === row
                  ? {
                      ...item,
                      allocations: item.allocations.map((pair, column) =>
                        column === target ? [pair[0], value] : pair
                      )
                    }
                  : item
              )
            }
          }
        : old
    )
  }
  const draft = canCalculate ? visible.draft : null
  const validDraft =
    !!draft &&
    draft.rows.every((row) =>
      row.allocations.every(
        ([, value]) =>
          /^(0|[1-9]\d*)$/.test(value) &&
          Number.isSafeInteger(Number(value)) &&
          Number(value) <= SEASON_MAX_SPENDABLE_TOKENS
      )
    )
  const canWrite = canCalculate && !visible.busy && !visible.unknown
  async function mutate(action: 'replace' | 'clear') {
    if (
      !canWrite ||
      !visible.data ||
      (action === 'replace' &&
        (!visible.data.canReplace || !draft || !validDraft)) ||
      (action === 'clear' && !visible.data.canClear)
    )
      return
    const op = begin(true)
    try {
      const body =
        action === 'replace' && draft
          ? {
              ...draft.model.replacement,
              assignments: !draft.edited
                ? draft.model.replacement.assignments
                : draft.rows.map((row) => ({
                    player_id: row.id,
                    token_allocations: Object.fromEntries(
                      row.allocations.map(([key, value]) => [
                        key,
                        Number(value)
                      ])
                    )
                  }))
            }
          : undefined
      const data = readSaved(
        await request(op, action === 'replace' ? 'PUT' : 'DELETE', body),
        season,
        action
      )
      if (current(op)) {
        barriers.current.delete(season)
        update(op, {
          data,
          draft: null,
          unknown: false,
          status:
            action === 'replace'
              ? 'Saved intent reloaded after replacement.'
              : 'Saved intent reloaded after clearing.'
        })
      }
    } catch (error) {
      markUnknown(op)
      failure(op, {
        unknown: true,
        error: UNKNOWN_WRITE,
        draft: null,
        ...(refusedAuthority(error) ? { data: null } : {})
      })
    } finally {
      finish(op)
    }
  }
  return (
    <div className="space-y-5">
      <nav aria-label="Saved assignment season">
        {seasons.map((value) => (
          <button
            className="btn-wh40k mr-2"
            key={value}
            type="button"
            aria-pressed={value === season}
            onClick={() => setSelection({ provided: providedSeason, value })}
          >
            Saved season {value}
          </button>
        ))}
      </nav>
      <section
        aria-label="Saved assignment intent"
        className="card-wh40k p-4 space-y-3"
      >
        <h2 className="text-xl font-semibold">Saved assignment intent</h2>
        <p>Selected season {season}</p>
        <p>
          Persisted player allocations and boss choices. Saving intent does not
          prove attacks occurred or that every allocation is feasible at every
          instant.
        </p>
        {visible.data && (
          <>
            {!visible.data.assignments.length && <p>No saved assignments.</p>}
            <table>
              <caption>Persisted token allocations</caption>
              <tbody>
                {visible.data.assignments.map((row, index) => (
                  <tr key={row.player_id}>
                    <th scope="row">
                      {displayLabel(
                        row.display_name,
                        row.player_id,
                        index,
                        visible.data!.assignments.map(
                          (item) => item.display_name
                        )
                      )}
                    </th>
                    <td>
                      {Object.entries(row.token_allocations ?? {})
                        .map(([target, count]) => `${target}: ${count}`)
                        .join(', ') || 'No token allocations saved'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visible.data.bosses.length && <p>No saved boss choices.</p>}
            <ul>
              {visible.data.bosses.map((boss) => (
                <li key={boss.level}>
                  {boss.level}: {boss.boss_name}
                </li>
              ))}
            </ul>
          </>
        )}
        <button
          className="btn-wh40k"
          type="button"
          disabled={visible.busy}
          onClick={() => void reload()}
        >
          Reload current saved season
        </button>
        {canCalculate && visible.data?.canClear && (
          <button
            className="btn-wh40k"
            type="button"
            disabled={!canWrite}
            onClick={() =>
              setView((old) => ({ ...old, confirmation: 'clear' }))
            }
          >
            Clear saved assignments and boss choices for this season
          </button>
        )}
      </section>
      {canCalculate && (
        <section
          className="card-wh40k p-4 space-y-3"
          aria-label="Saved queue calculation"
        >
          <label className="block">
            As-of time (UTC)
            <input
              className="input-wh40k mt-1 block"
              type="datetime-local"
              step="1"
              value={visible.input}
              disabled={visible.writing}
              onChange={(event) => changeTime(event.target.value)}
            />
          </label>
          <button
            className="btn-wh40k"
            type="button"
            disabled={!canWrite || !visible.data?.canReplace || !visible.input}
            onClick={() => void calculate()}
          >
            Calculate saved queue
          </button>
          <p>
            Saved raid history and captured season configuration. No live API
            request. Uses the current saved roster.
          </p>
        </section>
      )}
      {draft && (
        <section
          aria-label="Assignment intent draft"
          className="card-wh40k p-4 space-y-3"
        >
          <h2>
            {draft.edited
              ? 'Uncalculated intent'
              : 'Calculated intent — not saved'}
          </h2>
          <p>
            Intent validation as of {draft.model.asOf}. This instant is not
            retained in persisted assignments.
          </p>
          <p>
            Repeated-loop allocations are combined as saved intent, not a
            retained attack schedule.
          </p>
          {draft.rows.map((row, index) => (
            <fieldset key={row.id}>
              <legend>
                {displayLabel(
                  row.name,
                  row.id,
                  index,
                  draft.rows.map((item) => item.name)
                )}
              </legend>
              <p>
                Spendable by season end:{' '}
                {
                  draft.model.players.find(
                    (player) => player.playerId === row.id
                  )!.spendableByEnd
                }
                . Budget modeled at the explicit as-of time.
              </p>
              {row.allocations.map(([target, value], column) => (
                <label className="mr-3 inline-block" key={target}>
                  {target} tokens
                  <input
                    className="input-wh40k block"
                    type="number"
                    min="0"
                    max={SEASON_MAX_SPENDABLE_TOKENS}
                    step="1"
                    value={value}
                    aria-label={`${displayLabel(
                      row.name,
                      row.id,
                      index,
                      draft.rows.map((item) => item.name)
                    )} ${target} tokens`}
                    disabled={!canWrite}
                    onChange={(event) =>
                      edit(index, column, event.target.value)
                    }
                  />
                </label>
              ))}
            </fieldset>
          ))}
          {!validDraft && (
            <p role="alert">
              Enter whole token counts from 0 to {SEASON_MAX_SPENDABLE_TOKENS}.
              The server checks each saved season budget.
            </p>
          )}
          {visible.data?.canReplace && (
            <button
              className="btn-wh40k"
              type="button"
              disabled={!canWrite || !validDraft}
              onClick={() =>
                setView((old) => ({ ...old, confirmation: 'replace' }))
              }
            >
              Replace saved assignments and boss choices for this season
            </button>
          )}
        </section>
      )}
      {draft && !draft.edited && (
        <section
          className="card-wh40k p-4 space-y-3"
          aria-label="Calculated queue preview"
        >
          <h2 className="text-xl font-semibold">
            Calculated queue preview — not saved
          </h2>
          <p>
            Season {season} · Captured configuration {draft.model.configId} · As
            of {draft.model.asOf} · Guild time zone {draft.model.timeZone}
          </p>
          <p>
            Token availability verified at projected starts. Stage times are
            historical estimates, conditional on prior clears and player
            attendance.
          </p>
          <p>
            {draft.model.metrics.totalTokensPlanned} planned tokens ·{' '}
            {draft.model.metrics.projectedStages} projected stages ·{' '}
            {draft.model.feasibility.projectedPrefix.fullyClearedStageCount}{' '}
            consecutive projected cleared stages
          </p>
          {draft.model.warnings.map((warning) => (
            <p key={warning}>
              {
                {
                  'fallback-stage-duration':
                    'Uses a fallback stage duration where historical timing is unavailable.',
                  'conditional-stage-progression':
                    'Later progression is conditional on clearing earlier stages.',
                  'no-damage-signal':
                    'No saved damage signal is available for part of this projection.',
                  'horizon-truncated':
                    'Later stages are outside the selected season horizon.',
                  'stage-limit-reached':
                    'The bounded stage sequence limit was reached.'
                }[warning]
              }
            </p>
          ))}
          {draft.model.stages.map((stage) => (
            <div key={`${stage.stageCode}:${stage.loopIndex}`}>
              <h3>
                {stage.stageCode} · Loop {stage.loopIndex} ·{' '}
                {stage.projectedStartAt}
              </h3>
              <p>
                {stage.projections.main.bossName}:{' '}
                {stage.projections.main.projectedDamage} projected damage;{' '}
                {stage.projections.main.projectedRemainingHp} projected HP
                remaining
              </p>
              {(
                [
                  ['prime1', stage.projections.prime1],
                  ['prime2', stage.projections.prime2]
                ] as const
              ).map(
                ([slot, prime]) =>
                  prime && (
                    <p key={slot}>
                      {prime.bossName}: {prime.projectedDamage} projected
                      damage; {prime.projectedRemainingHp} projected HP
                      remaining
                    </p>
                  )
              )}
              <ul>
                {stage.assignments.map((assignment) => {
                  const ordinal = draft.model.players.findIndex(
                    (player) => player.playerId === assignment.playerId
                  )
                  const player = draft.model.players[ordinal]!
                  return (
                    <li key={`${assignment.playerId}:${assignment.encounter}`}>
                      {displayLabel(
                        player.displayName,
                        player.playerId,
                        ordinal,
                        draft.model.players.map((item) => item.displayName)
                      )}{' '}
                      · {assignment.encounter} · {assignment.tokens} tokens
                    </li>
                  )
                })}
              </ul>
              {stage.conditionalOnPriorClear && (
                <p>Conditional on prior stage clear.</p>
              )}
            </div>
          ))}
          {draft.model.feasibility.unsolvedRemainder.length > 0 && (
            <p>
              {draft.model.feasibility.unsolvedRemainder.length} stages remain
              unsolved or outside the season horizon.
            </p>
          )}
          {draft.model.feasibility.sequenceLimitReached && (
            <p>Sequence limit reached.</p>
          )}
        </section>
      )}
      {visible.confirmation && (
        <section
          role="dialog"
          aria-modal="true"
          aria-label={
            visible.confirmation === 'replace'
              ? 'Confirm season replacement'
              : 'Confirm season clearing'
          }
          className="card-wh40k p-4 space-y-3"
        >
          <p>
            {visible.confirmation === 'replace'
              ? `Omitted assignments and boss choices will be removed from season ${season}.`
              : `Clear saved assignments and boss choices for season ${season}?`}
          </p>
          <p>
            Other seasons, plans, targets, raid history and player preferences
            are preserved.
          </p>
          <button
            className="btn-wh40k"
            type="button"
            onClick={() => void mutate(visible.confirmation!)}
          >
            Confirm{' '}
            {visible.confirmation === 'replace' ? 'replacement' : 'clearing'}
          </button>
          <button
            className="btn-wh40k"
            type="button"
            onClick={() => setView((old) => ({ ...old, confirmation: null }))}
          >
            Cancel
          </button>
        </section>
      )}
      {visible.busy && <p role="status">Loading saved queue…</p>}
      {visible.status && <p role="status">{visible.status}</p>}
      {visible.error && <p role="alert">{visible.error}</p>}
    </div>
  )
}
