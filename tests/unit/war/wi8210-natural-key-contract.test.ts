import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import ts from 'typescript'

/** Both guilds' payloads carry the same log ids, so upserts conflict on (war_id, guild_code, event_id). */

const TABLES = ['guild_war_battles', 'guild_war_player_attempts'] as const
type Table = (typeof TABLES)[number]

interface CallSite {
  file: string
  table: Table
  payloadProps: string[]
  onConflict: string | undefined
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (entry.endsWith('.ts') && !entry.includes('.test.')) out.push(full)
  }
  return out
}

function objectLiteralPropNames(obj: ts.ObjectLiteralExpression): string[] {
  const names: string[] = []
  for (const prop of obj.properties) {
    if (
      ts.isPropertyAssignment(prop) ||
      ts.isShorthandPropertyAssignment(prop)
    ) {
      const name = prop.name
      if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
        names.push(name.text)
      } else if (ts.isComputedPropertyName(name)) {
        // Surface computed keys so a `['id']:` dodge stays visible.
        names.push(`[computed:${name.expression.getText()}]`)
      }
    }
  }
  return names
}

function onConflictValue(obj: ts.ObjectLiteralExpression): string | undefined {
  for (const prop of obj.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === 'onConflict' &&
      ts.isStringLiteral(prop.initializer)
    ) {
      return prop.initializer.text
    }
  }
  return undefined
}

function resolveRowObject(
  sourceFile: ts.SourceFile,
  arg: ts.Expression
): ts.ObjectLiteralExpression | undefined {
  if (ts.isObjectLiteralExpression(arg)) return arg

  if (ts.isIdentifier(arg)) {
    const targetName = arg.text
    let found: ts.ObjectLiteralExpression | undefined
    const visit = (node: ts.Node): void => {
      if (found) return
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'push' &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === targetName &&
        node.arguments.length > 0 &&
        ts.isObjectLiteralExpression(node.arguments[0])
      ) {
        found = node.arguments[0] as ts.ObjectLiteralExpression
        return
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    return found
  }

  return undefined
}

function upsertCallSites(): CallSite[] {
  const sites: CallSite[] = []
  const root = resolve(process.cwd(), 'app')

  for (const file of sourceFiles(root)) {
    const text = readFileSync(file, 'utf8')
    const sourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    )
    const relFile = file.slice(resolve(process.cwd()).length + 1)

    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'upsert'
      ) {
        const receiver = node.expression.expression
        if (
          ts.isCallExpression(receiver) &&
          ts.isPropertyAccessExpression(receiver.expression) &&
          receiver.expression.name.text === 'from' &&
          receiver.arguments.length > 0 &&
          ts.isStringLiteral(receiver.arguments[0])
        ) {
          const table = receiver.arguments[0].text
          if ((TABLES as readonly string[]).includes(table)) {
            const [rowArg, optionsArg] = node.arguments
            const rowObj = rowArg
              ? resolveRowObject(sourceFile, rowArg)
              : undefined
            const optionsObj =
              optionsArg && ts.isObjectLiteralExpression(optionsArg)
                ? optionsArg
                : undefined
            sites.push({
              file: relFile,
              table: table as Table,
              payloadProps: rowObj ? objectLiteralPropNames(rowObj) : [],
              onConflict: optionsObj ? onConflictValue(optionsObj) : undefined
            })
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }

  return sites
}

describe('WI-8210 natural-key writer contract', () => {
  const sites = upsertCallSites()

  it('finds every app-tier upsert of the two war fact tables', () => {
    expect(sites.length).toBe(3)
    expect(sites.filter((s) => s.table === 'guild_war_battles')).toHaveLength(1)
    expect(
      sites.filter((s) => s.table === 'guild_war_player_attempts')
    ).toHaveLength(2)
  })

  it('every call site conflicts on the per-guild natural key', () => {
    for (const site of sites) {
      expect(
        site.onConflict,
        `${site.file} -> ${site.table}: must use the natural key`
      ).toBe('war_id,guild_code,event_id')
    }
  })

  it('every call site supplies event_id in its own payload', () => {
    // Bound to this call's row object, so a sibling upsert cannot cover for it.
    for (const site of sites) {
      expect(
        site.payloadProps,
        `${site.file} -> ${site.table}: no event_id in this payload; it would write NULL, and NULL never collides in the unique index`
      ).toContain('event_id')
    }
  })

  it('no call site writes the primary key', () => {
    // A payload id would UPDATE the PK on conflict and break the replay-link FK.
    for (const site of sites) {
      expect(
        site.payloadProps,
        `${site.file} -> ${site.table}: must not send an explicit id`
      ).not.toContain('id')
    }
  })
})
