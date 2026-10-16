import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `public.cluster_config` is a view over `clusters`. A client that selects a column the
 * view lacks gets 42703 on every call, and a `.from('cluster_config' as 'clusters')` cast
 * hides that from the type checker, so this test checks the reads against the migrations.
 */

const root = resolve(__dirname, '../../..')
const MIGRATIONS = join(root, 'supabase/migrations')
const SOURCE_DIRS = ['app', 'packages', 'supabase/functions']

/** The view's columns after every migration in order: the last definition wins. */
function clusterConfigViewColumns(): string[] {
  let columns: string[] = []
  for (const file of readdirSync(MIGRATIONS).sort()) {
    if (!file.endsWith('.sql')) continue
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8')
    const statement =
      /(CREATE(?: OR REPLACE)? VIEW (?:public\.)?cluster_config\b[\s\S]*?;)|(DROP VIEW (?:IF EXISTS )?(?:public\.)?cluster_config\b)/gi
    for (const match of sql.matchAll(statement)) {
      columns = match[1] ? selectListColumns(match[1]) : []
    }
  }
  return columns
}

function splitTopLevel(list: string): string[] {
  const items: string[] = []
  let depth = 0
  let current = ''
  for (const ch of list) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      items.push(current)
      current = ''
    } else current += ch
  }
  items.push(current)
  return items.map((item) => item.trim()).filter(Boolean)
}

function selectListColumns(createView: string): string[] {
  const body = createView.slice(createView.search(/\bSELECT\b/i) + 6)
  let depth = 0
  let end = body.length
  for (const m of body.matchAll(/[()]|\bFROM\b/gi)) {
    if (m[0] === '(') depth++
    else if (m[0] === ')') depth--
    else if (depth === 0) {
      end = m.index
      break
    }
  }
  return splitTopLevel(body.slice(0, end)).map((item) => {
    const alias = item.match(/\bAS\s+"?([a-z0-9_]+)"?$/i)
    return (alias ? alias[1] : item.split('.').pop()!).replace(/"/g, '')
  })
}

/** PostgREST select-list columns, skipping `*` and embedded resources. */
function postgrestColumns(select: string): string[] {
  return splitTopLevel(select)
    .filter((item) => item !== '*' && !item.includes('('))
    .map((item) => {
      const aliased = item.match(/^[a-z0-9_]+:(?!:)(.*)$/i)
      return (aliased ? aliased[1] : item).split('::')[0].split('->')[0].trim()
    })
}

interface Read {
  file: string
  columns: string[] | null
}

/** Each `.from('cluster_config')` chain's select list; `null` when it is not a literal. */
function clusterConfigReads(file: string, source: string): Read[] {
  const reads: Read[] = []
  const from = /\.from\(\s*(['"`])cluster_config\1(?:\s+as\s+[^)]*)?\s*\)/g
  for (const match of source.matchAll(from)) {
    const after = source.slice(match.index + match[0].length)
    const nextFrom = after.search(/\.from\(/)
    const chain = nextFrom >= 0 ? after.slice(0, nextFrom) : after
    const select = chain.match(/^\s*(?:\.[a-zA-Z]+\([^)]*\)\s*)*?\.select\(\s*/)
    if (!select) continue
    const argument = chain.slice(select[0].length)
    if (argument.startsWith(')')) continue
    const literal = argument.match(/^(['"])([^'"]*)\1|^`([^`$]*)`/)
    reads.push({
      file,
      columns: literal ? postgrestColumns(literal[2] ?? literal[3]) : null
    })
  }
  return reads
}

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* sourceFiles(path)
    else if (/\.(ts|tsx|js|mjs)$/.test(entry) && !/\.(test|spec)\./.test(entry))
      yield path
  }
}

function clientReads(): Read[] {
  return SOURCE_DIRS.flatMap((dir) =>
    [...sourceFiles(join(root, dir))].flatMap((path) =>
      clusterConfigReads(relative(root, path), readFileSync(path, 'utf8'))
    )
  )
}

describe('public.cluster_config reads', () => {
  it('derives the view columns from the migrations', () => {
    const columns = clusterConfigViewColumns()
    expect(columns).toContain('cluster_code')
    expect(columns).toContain('display_name')
  })

  it('finds the select list behind a cast relation name', () => {
    const source = `const { data } = await supabase
      .from('cluster_config' as 'clusters')
      .select('minimum_player_level, name:display_name, cluster_code::text, guilds(*)')
      .eq('cluster_code', code)`
    expect(clusterConfigReads('fixture.ts', source)).toEqual([
      {
        file: 'fixture.ts',
        columns: ['minimum_player_level', 'display_name', 'cluster_code']
      }
    ])
  })

  it('every client read names only columns the view has', () => {
    const view = new Set(clusterConfigViewColumns())
    const missing = clientReads().flatMap(({ file, columns }) =>
      columns === null
        ? [`${file}: select list is not a string literal`]
        : columns.filter((c) => !view.has(c)).map((c) => `${file}: ${c}`)
    )
    expect(missing).toEqual([])
  })
})
