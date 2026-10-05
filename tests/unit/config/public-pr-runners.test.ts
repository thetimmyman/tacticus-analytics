/**
 * No pull_request job may reach a self-hosted runner: anyone can open a PR (RCE).
 * Checks where each job RUNS regardless of `if:`; an unevaluable `runs-on` fails closed.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const WORKFLOWS_DIR = path.join(process.cwd(), '.github', 'workflows')

// Explicit standard hosted labels from GitHub's public runner reference.
// Larger/custom runner selections remain disallowed.
const HOSTED_LABELS = new Set([
  'ubuntu-latest',
  'ubuntu-24.04',
  'ubuntu-22.04',
  'ubuntu-24.04-arm',
  'ubuntu-22.04-arm',
  'windows-latest',
  'windows-2022',
  'windows-2025',
  'macos-latest',
  'macos-14',
  'macos-15',
  'macos-26',
  'macos-15-intel',
  'macos-26-intel'
])

const REPO = 'thetimmyman/tacticus-analytics'

type Ctx = Record<string, unknown>

// Every PR situation a public repo can produce, plus a fork PR while still private.
const PR_SCENARIOS: Record<string, Ctx> = {
  'public, same-repo PR': prContext({ isPrivate: false, fork: false }),
  'public, fork PR': prContext({ isPrivate: false, fork: true }),
  'private, fork PR': prContext({ isPrivate: true, fork: true })
}

function prContext({
  isPrivate,
  fork
}: {
  isPrivate: boolean
  fork: boolean
}): Ctx {
  return {
    github: {
      event_name: 'pull_request',
      repository: REPO,
      sha: 'feedface00000000000000000000000000000001',
      run_id: '1',
      event: {
        repository: { private: isPrivate, full_name: REPO },
        pull_request: {
          head: {
            sha: 'feedface00000000000000000000000000000001',
            repo: { full_name: fork ? 'someone/tacticus-analytics' : REPO }
          }
        }
      }
    },
    // Inputs and variables must never decide a PR's runner; model them as self-hosted.
    inputs: { runner: '["self-hosted","amd64-builder"]' },
    vars: { DB_LANE_RUNNER: '["self-hosted","amd64-builder"]' }
  }
}

type Tok = { t: 'op' | 'str' | 'num' | 'id'; v: string }

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/u.test(c)) {
      i += 1
      continue
    }
    const two = src.slice(i, i + 2)
    if (['&&', '||', '==', '!='].includes(two)) {
      out.push({ t: 'op', v: two })
      i += 2
      continue
    }
    if ('()!,'.includes(c)) {
      out.push({ t: 'op', v: c })
      i += 1
      continue
    }
    if (c === "'") {
      let s = ''
      i += 1
      for (;;) {
        if (i >= src.length) throw new Error(`unterminated string in ${src}`)
        if (src[i] === "'") {
          if (src[i + 1] === "'") {
            s += "'"
            i += 2
            continue
          }
          i += 1
          break
        }
        s += src[i]
        i += 1
      }
      out.push({ t: 'str', v: s })
      continue
    }
    const num = /^-?\d+(\.\d+)?/u.exec(src.slice(i))
    if (num) {
      out.push({ t: 'num', v: num[0] })
      i += num[0].length
      continue
    }
    const id = /^[A-Za-z_][A-Za-z0-9_-]*(\.[A-Za-z_][A-Za-z0-9_-]*)*/u.exec(
      src.slice(i)
    )
    if (id) {
      out.push({ t: 'id', v: id[0] })
      i += id[0].length
      continue
    }
    throw new Error(`unsupported expression syntax at "${src.slice(i)}"`)
  }
  return out
}

function coerceNumber(v: unknown): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number') return v
  if (typeof v === 'string') return v.trim() === '' ? 0 : Number(v)
  return Number.NaN
}

function looseEquals(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string') {
    return a.toLowerCase() === b.toLowerCase()
  }
  if (typeof a === typeof b && typeof a !== 'object') return a === b
  if (
    a === null ||
    b === null ||
    typeof a !== 'object' ||
    typeof b !== 'object'
  )
    return coerceNumber(a) === coerceNumber(b)
  return a === b
}

const FUNCTIONS: Record<string, (...args: unknown[]) => unknown> = {
  fromJSON: (s) => JSON.parse(String(s)),
  format: (f, ...args) =>
    String(f).replace(/\{(\d+)\}/gu, (_, n) => String(args[Number(n)])),
  endsWith: (a, b) => String(a).toLowerCase().endsWith(String(b).toLowerCase()),
  startsWith: (a, b) =>
    String(a).toLowerCase().startsWith(String(b).toLowerCase()),
  contains: (a, b) =>
    Array.isArray(a)
      ? a.some((x) => looseEquals(x, b))
      : String(a).toLowerCase().includes(String(b).toLowerCase())
}

function evaluate(src: string, ctx: Ctx): unknown {
  const toks = tokenize(src)
  let p = 0
  const peek = () => toks[p]
  const eat = (v?: string) => {
    const tok = toks[p]
    if (!tok || (v !== undefined && tok.v !== v)) {
      throw new Error(`expected ${v ?? 'token'} in ${src}`)
    }
    p += 1
    return tok
  }
  // Thunks let && and || short-circuit like GitHub: an unevaluated branch may reference anything.
  type Thunk = () => unknown
  const parseOr = (): Thunk => {
    let left = parseAnd()
    while (peek()?.v === '||') {
      eat('||')
      const l = left
      const r = parseAnd()
      left = () => {
        const lv = l()
        return lv ? lv : r()
      }
    }
    return left
  }
  const parseAnd = (): Thunk => {
    let left = parseEq()
    while (peek()?.v === '&&') {
      eat('&&')
      const l = left
      const r = parseEq()
      left = () => {
        const lv = l()
        return lv ? r() : lv
      }
    }
    return left
  }
  const parseEq = (): Thunk => {
    const left = parseNot()
    const op = peek()?.v
    if (op === '==' || op === '!=') {
      eat(op)
      const right = parseNot()
      return () => looseEquals(left(), right()) === (op === '==')
    }
    return left
  }
  const parseNot = (): Thunk => {
    if (peek()?.v === '!') {
      eat('!')
      const inner = parseNot()
      return () => !inner()
    }
    return parsePrimary()
  }
  const parsePrimary = (): Thunk => {
    const tok = eat()
    if (tok.t === 'op' && tok.v === '(') {
      const inner = parseOr()
      eat(')')
      return inner
    }
    if (tok.t === 'str') return () => tok.v
    if (tok.t === 'num') return () => Number(tok.v)
    if (tok.t === 'id') {
      if (tok.v === 'true' || tok.v === 'false') return () => tok.v === 'true'
      if (tok.v === 'null') return () => null
      if (peek()?.v === '(') {
        const fn = FUNCTIONS[tok.v]
        if (!fn) throw new Error(`unsupported function ${tok.v}()`)
        eat('(')
        const args: Thunk[] = []
        if (peek()?.v !== ')') {
          args.push(parseOr())
          while (peek()?.v === ',') {
            eat(',')
            args.push(parseOr())
          }
        }
        eat(')')
        return () => fn(...args.map((a) => a()))
      }
      const segments = tok.v.split('.')
      return () => {
        let cur: unknown = ctx
        for (const seg of segments) {
          if (cur === null || typeof cur !== 'object') return null
          cur = (cur as Record<string, unknown>)[seg]
          if (cur === undefined) throw new Error(`unknown context ${tok.v}`)
        }
        return cur
      }
    }
    throw new Error(`unexpected token ${tok.v} in ${src}`)
  }
  const thunk = parseOr()
  if (p !== toks.length) throw new Error(`trailing tokens in ${src}`)
  return thunk()
}

function resolveRunsOn(runsOn: unknown, ctx: Ctx): string[] {
  if (Array.isArray(runsOn)) return runsOn.map((l) => resolveLabel(l, ctx))
  if (typeof runsOn === 'string') {
    const whole = /^\s*\$\{\{([\s\S]*)\}\}\s*$/u.exec(runsOn)
    if (whole) {
      const v = evaluate(whole[1], ctx)
      if (typeof v === 'string') return [v]
      if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v
      throw new Error(`runs-on evaluated to ${JSON.stringify(v)}`)
    }
    return [resolveLabel(runsOn, ctx)]
  }
  throw new Error(`unsupported runs-on shape: ${JSON.stringify(runsOn)}`)
}

function resolveLabel(label: unknown, ctx: Ctx): string {
  if (typeof label !== 'string') throw new Error('non-string runs-on label')
  if (label.includes('${{')) return resolveRunsOn(label, ctx).join(',')
  return label
}

type Workflow = {
  file: string
  raw: string
  doc: {
    on?: unknown
    permissions?: unknown
    jobs: Record<
      string,
      { 'runs-on'?: unknown; uses?: string; strategy?: { matrix?: unknown } }
    >
  }
}

function matrixContexts(matrix: unknown): Ctx[] {
  if (matrix === undefined) return [{}]
  if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix))
    throw new Error('matrix must be a fixed literal object')
  const axes = Object.entries(matrix)
  if (axes.length < 1 || axes.length > 8)
    throw new Error('matrix must have 1 to 8 literal axes')
  let contexts: Ctx[] = [{}]
  for (const [axis, values] of axes) {
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(axis) ||
      ['include', 'exclude', '__proto__', 'constructor', 'prototype'].includes(
        axis
      )
    )
      throw new Error('unsupported matrix axis')
    if (
      !Array.isArray(values) ||
      values.length < 1 ||
      values.length > 16 ||
      values.some(
        (value: unknown) =>
          (typeof value !== 'string' &&
            typeof value !== 'boolean' &&
            typeof value !== 'number') ||
          (typeof value === 'string' && (!value || value.includes('${{'))) ||
          (typeof value === 'number' && !Number.isFinite(value))
      )
    )
      throw new Error(
        'matrix axis must contain bounded nonempty literal values'
      )
    if (contexts.length * values.length > 64)
      throw new Error('matrix exceeds 64 combinations')
    contexts = contexts.flatMap((ctx) =>
      values.map((value: unknown) => ({ ...ctx, [axis]: value }))
    )
  }
  return contexts
}

function triggersOf(doc: Workflow['doc']): string[] {
  // YAML 1.1 reads a bare `on:` as true; `yaml` (1.2) keeps "on". Accept both.
  const on = doc.on ?? (doc as Record<string, unknown>)['true']
  if (typeof on === 'string') return [on]
  if (Array.isArray(on)) return on.map(String)
  if (on && typeof on === 'object') return Object.keys(on)
  return []
}

function loadWorkflows(): Workflow[] {
  return readdirSync(WORKFLOWS_DIR)
    .filter((f) => /\.ya?ml$/u.test(f))
    .sort()
    .map((file) => {
      const raw = readFileSync(path.join(WORKFLOWS_DIR, file), 'utf8')
      return { file, raw, doc: parse(raw) as Workflow['doc'] }
    })
}

/** Token-level scan for `secrets` uses other than GITHUB_TOKEN; YAML comment lines are ignored. */
function secretViolations(raw: string): string[] {
  const code = raw
    .split(/\r?\n/u)
    .filter((line) => !/^\s*#/u.test(line))
    .join('\n')
  const out: string[] = []
  for (const m of code.matchAll(/(?<![\w.-])secrets(?![\w-])/gu)) {
    const rest = code.slice((m.index ?? 0) + m[0].length)
    if (/^\.GITHUB_TOKEN(?![\w-])/u.test(rest)) continue
    out.push(`secrets${rest.slice(0, 24).split('\n')[0]}`)
  }
  return out
}

function prRunnerViolations(workflows: Workflow[]): string[] {
  const violations: string[] = []
  for (const wf of workflows) {
    if (!triggersOf(wf.doc).includes('pull_request')) continue
    for (const [jobId, job] of Object.entries(wf.doc.jobs ?? {})) {
      if (job.uses) {
        violations.push(
          `${wf.file}:${jobId} calls a reusable workflow; its runners cannot be checked here`
        )
        continue
      }
      let matrices: Ctx[]
      try {
        matrices = matrixContexts(job.strategy?.matrix)
      } catch (err) {
        violations.push(
          `${wf.file}:${jobId} matrix could not be evaluated (${(err as Error).message}) — fails closed`
        )
        continue
      }
      for (const [scenario, ctx] of Object.entries(PR_SCENARIOS)) {
        for (const matrix of matrices) {
          let labels: string[]
          try {
            labels = resolveRunsOn(job['runs-on'], { ...ctx, matrix })
          } catch (err) {
            violations.push(
              `${wf.file}:${jobId} runs-on could not be evaluated (${(err as Error).message}) — fails closed`
            )
            break
          }
          const bad = labels.filter((l) => !HOSTED_LABELS.has(l))
          if (bad.length > 0 || labels.length === 0) {
            violations.push(
              `${wf.file}:${jobId} [${scenario}] requests non-hosted runner labels ${JSON.stringify(labels)}`
            )
          }
        }
      }
    }
  }
  return violations
}

describe('public-release workflow contract', () => {
  const workflows = loadWorkflows()

  it('finds the workflows it is supposed to police', () => {
    const prWorkflows = workflows
      .filter((wf) => triggersOf(wf.doc).includes('pull_request'))
      .map((wf) => wf.file)
    expect(prWorkflows).toEqual(
      expect.arrayContaining([
        'codeql.yml',
        'governance-baseline.yml',
        'pgtap-gate.yml'
      ])
    )
  })

  it('never schedules a pull_request job onto a self-hosted runner once public', () => {
    expect(prRunnerViolations(workflows)).toEqual([])
  })

  it('uses no privileged pull-request triggers', () => {
    for (const wf of workflows) {
      const triggers = triggersOf(wf.doc)
      expect(triggers, wf.file).not.toContain('pull_request_target')
      expect(triggers, wf.file).not.toContain('workflow_run')
    }
  })

  it('declares an explicit top-level permissions block in every workflow', () => {
    for (const wf of workflows) {
      expect(wf.doc.permissions, wf.file).toBeDefined()
      expect(wf.doc.permissions, wf.file).not.toBe('write-all')
    }
  })

  it('pins every third-party action to a full commit SHA', () => {
    for (const wf of workflows) {
      for (const m of wf.raw.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gmu)) {
        const ref = m[1].replace(/^['"]|['"]$/gu, '')
        if (ref.startsWith('./') || ref.startsWith('docker://')) continue
        expect(ref, `${wf.file}: ${ref}`).toMatch(/@[0-9a-f]{40}$/u)
      }
    }
  })

  it('uses no secret besides GITHUB_TOKEN in a workflow a PR can trigger', () => {
    for (const wf of workflows) {
      if (!triggersOf(wf.doc).includes('pull_request')) continue
      expect(secretViolations(wf.raw), wf.file).toEqual([])
    }
  })

  // Negative controls: prove the check bites on the shapes it exists to stop.
  describe('negative controls', () => {
    it.each([
      ['dot access', 'KEY: ${{ secrets.DEPLOY_KEY }}'],
      ['index access', "KEY: ${{ secrets['DEPLOY_KEY'] }}"],
      ['whole-context dump', 'ALL: ${{ toJSON(secrets) }}'],
      ['reusable-workflow inherit', '    secrets: inherit'],
      ['implicit if: expression', "    if: secrets.DEPLOY_KEY != ''"]
    ])('flags secret access by %s', (_, line) => {
      expect(
        secretViolations(`jobs:\n  j:\n    env:\n      ${line}\n`)
      ).toHaveLength(1)
    })

    it('allows GITHUB_TOKEN and ignores comment lines', () => {
      expect(
        secretViolations(
          '# secrets.DEPLOY_KEY is not used here\nT: ${{ secrets.GITHUB_TOKEN }}\n'
        )
      ).toEqual([])
    })

    const synthetic = (runsOn: unknown, matrix?: unknown): Workflow => ({
      file: 'synthetic.yml',
      raw: '',
      doc: {
        on: { pull_request: {} },
        permissions: {},
        jobs: {
          j: {
            'runs-on': runsOn,
            ...(matrix === undefined ? {} : { strategy: { matrix } })
          }
        }
      }
    })

    it('accepts fixed standard hosted Windows/macOS/Linux matrices', () => {
      expect(
        prRunnerViolations([
          synthetic('${{ matrix.os }}', {
            os: [...HOSTED_LABELS],
            configuration: ['debug', 'release']
          })
        ])
      ).toEqual([])
    })

    it.each(['self-hosted', 'macos-unknown', 'macos-latest-large', ''])(
      'rejects unsafe matrix runner %s',
      (runner) => {
        expect(
          prRunnerViolations([
            synthetic('${{ matrix.os }}', { os: ['ubuntu-latest', runner] })
          ]).length
        ).toBeGreaterThan(0)
      }
    )

    it.each([
      '${{ fromJSON(needs.generate.outputs.matrix) }}',
      { os: '${{ fromJSON(vars.RUNNERS) }}' },
      { os: ['${{ inputs.runner }}'] },
      { os: [] },
      {},
      { os: ['ubuntu-latest'], include: [{ os: 'self-hosted' }] },
      { os: Array.from({ length: 17 }, () => 'ubuntu-latest') },
      { os: ['ubuntu-latest'], a: Array(16).fill('x'), b: Array(16).fill('x') }
    ])('fails closed on an unbounded or dynamic matrix %j', (matrix) => {
      expect(
        prRunnerViolations([synthetic('${{ matrix.os }}', matrix)])[0]
      ).toContain('fails closed')
    })

    it('rejects a runner expression referencing an unknown matrix axis', () => {
      expect(
        prRunnerViolations([
          synthetic("${{ matrix.unknown || 'ubuntu-latest' }}", {
            os: ['ubuntu-latest']
          })
        ])[0]
      ).toContain('fails closed')
    })

    it('flags a literal self-hosted label list', () => {
      expect(
        prRunnerViolations([synthetic(['self-hosted', 'amd64-builder'])])
      ).toHaveLength(3)
    })

    it('flags the pre-release fork-only split for same-repo PRs on a public repo', () => {
      const forkOnly =
        "${{ (github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name != github.repository) && 'ubuntu-latest' || fromJSON('[\"self-hosted\",\"amd64-builder\"]') }}"
      const v = prRunnerViolations([synthetic(forkOnly)])
      expect(v).toHaveLength(1)
      expect(v[0]).toContain('public, same-repo PR')
    })

    it('flags a PR runner taken from a repository variable', () => {
      const fromVar =
        '${{ fromJSON(vars.DB_LANE_RUNNER || \'["ubuntu-latest"]\') }}'
      expect(prRunnerViolations([synthetic(fromVar)])).toHaveLength(3)
    })

    it('fails closed on an expression it cannot evaluate', () => {
      const v = prRunnerViolations([
        synthetic("${{ hashFiles('x') && 'ubuntu-latest' }}")
      ])
      expect(v[0]).toContain('fails closed')
    })

    it('accepts the visibility-aware expression the workflows use', () => {
      const canonical =
        "${{ (github.event_name == 'pull_request' && (!github.event.repository.private || github.event.pull_request.head.repo.full_name != github.repository)) && 'ubuntu-latest' || fromJSON('[\"self-hosted\",\"amd64-builder\"]') }}"
      expect(prRunnerViolations([synthetic(canonical)])).toEqual([])
      expect(
        resolveRunsOn(canonical, prContext({ isPrivate: true, fork: false }))
      ).toEqual(['self-hosted', 'amd64-builder'])
    })
  })
})
