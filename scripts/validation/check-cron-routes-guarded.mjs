#!/usr/bin/env node
// Gate: every cron route handler calls `requireCronSecret` first. The edge WAF
// rule for /api/cron/* is bypassed by any Authorization header, so this guard
// is the only control. Usage: check-cron-routes-guarded.mjs [--selftest|--scan]

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(SCRIPT_DIR, '..', '..')

const GUARD_EXPORT = 'requireCronSecret'
const GUARD_MODULE = 'app/lib/scheduler/require-cron-secret'

// Re-exports of the guard under another name (e.g. a deprecated alias).
const GUARD_REEXPORTS = new Map([
  ['app/lib/sync/worker-utils', 'requireCronAuthorization']
])

const MANIFEST_PATH = 'scripts/validation/cron-guarded-handlers.json'

const HTTP_METHODS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS'
])

const ROUTE_FILE = /^route\.(ts|tsx|js)$/

// An initializer containing any of these writes, so it is not a pure declaration.
const ASSIGNMENT_OPERATORS = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken
])

// Transparent wrappers (error translation, headers) that do not authenticate,
// so the guard must be inside the wrapped function. Never list an auth-adding one here.
const TRANSPARENT_WRAPPERS = new Set([
  'withErrorHandler',
  'withMetaAnalysisPrivateHeaders'
])

/** A route-group segment `(admin)` is not part of the URL; unwrap it. */
function normalizeSegment(segment) {
  return segment.startsWith('(') && segment.endsWith(')')
    ? segment.slice(1, -1)
    : segment
}

function isRouteFile(relPath) {
  return ROUTE_FILE.test(path.posix.basename(relPath))
}

function hasCronSegment(relPath) {
  const segments = relPath.split('/').slice(0, -1).map(normalizeSegment)
  return segments.includes('cron')
}

function selectCronPathFiles(files) {
  return files.filter(
    (file) =>
      file.startsWith('app/api/') && isRouteFile(file) && hasCronSegment(file)
  )
}

/** Resolve an import specifier to a repo-relative, extensionless module id. */
function resolveModuleId(specifier, fromRelPath) {
  let rel
  if (specifier.startsWith('.')) {
    rel = path.posix.normalize(
      path.posix.join(path.posix.dirname(fromRelPath), specifier)
    )
  } else if (specifier.startsWith('@/app/')) {
    rel = `app/${specifier.slice('@/app/'.length)}`
  } else if (specifier.startsWith('@/lib/')) {
    rel = `app/lib/${specifier.slice('@/lib/'.length)}`
  } else if (specifier.startsWith('@/components/')) {
    rel = `app/components/${specifier.slice('@/components/'.length)}`
  } else if (specifier.startsWith('@/types/')) {
    rel = `app/types/${specifier.slice('@/types/'.length)}`
  } else if (specifier.startsWith('@/')) {
    rel = `app/${specifier.slice(2)}`
  } else {
    return null
  }
  return rel.replace(/\.(ts|tsx|js|jsx|mjs)$/, '')
}

/** Local names and namespace imports of the cron guard. @returns {{ names: Set<string>, namespaces: Set<string> }} */
function collectGuardBindings(sourceFile, relPath) {
  const names = new Set()
  // name -> the export name the guard carries in that module.
  const namespaces = new Map()

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue
    const moduleId = resolveModuleId(statement.moduleSpecifier.text, relPath)
    if (moduleId === null) continue

    let exportedName = null
    if (moduleId === GUARD_MODULE) exportedName = GUARD_EXPORT
    else if (GUARD_REEXPORTS.has(moduleId))
      exportedName = GUARD_REEXPORTS.get(moduleId)
    if (exportedName === null) continue

    const clause = statement.importClause
    if (!clause || clause.isTypeOnly) continue
    const bindings = clause.namedBindings
    if (bindings && ts.isNamespaceImport(bindings)) {
      namespaces.set(bindings.name.text, exportedName)
      continue
    }
    if (!bindings || !ts.isNamedImports(bindings)) continue
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue
      const imported = (element.propertyName ?? element.name).text
      if (imported === exportedName) names.add(element.name.text)
    }
  }

  return { names, namespaces }
}

function selectGuardImportingFiles(files, readFile) {
  const selected = []
  for (const file of files) {
    if (!file.startsWith('app/api/') || !isRouteFile(file)) continue
    const text = readFile(file)
    if (!text.includes(GUARD_EXPORT) && !text.includes('require-cron-secret')) {
      let mentionsReexport = false
      for (const alias of GUARD_REEXPORTS.values()) {
        if (text.includes(alias)) mentionsReexport = true
      }
      if (!mentionsReexport) continue
    }
    const sourceFile = parse(file, text)
    const { names, namespaces } = collectGuardBindings(sourceFile, file)
    if (names.size > 0 || namespaces.size > 0) selected.push(file)
  }
  return selected
}

function parse(relPath, text) {
  const kind = relPath.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : relPath.endsWith('.js')
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS
  return ts.createSourceFile(
    relPath,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    kind
  )
}

function isFunctionLike(node) {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node)
  )
}

function collectLiteralBooleans(sourceFile) {
  const values = new Map()
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0
    if (!isConst) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue
      const init = declaration.initializer
      if (!init) continue
      if (init.kind === ts.SyntaxKind.TrueKeyword)
        values.set(declaration.name.text, true)
      else if (init.kind === ts.SyntaxKind.FalseKeyword)
        values.set(declaration.name.text, false)
    }
  }
  return values
}

function staticCondition(expression, literalBooleans) {
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return true
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return false
  if (ts.isIdentifier(expression) && literalBooleans.has(expression.text))
    return literalBooleans.get(expression.text)
  if (
    ts.isPrefixUnaryExpression(expression) &&
    expression.operator === ts.SyntaxKind.ExclamationToken
  ) {
    const inner = staticCondition(expression.operand, literalBooleans)
    return inner === null ? null : !inner
  }
  if (ts.isParenthesizedExpression(expression))
    return staticCondition(expression.expression, literalBooleans)
  return null
}

function inDeadBranch(node, handlerBody, literalBooleans) {
  let current = node
  while (current && current !== handlerBody) {
    const parent = current.parent
    if (!parent) break
    if (ts.isIfStatement(parent)) {
      const known = staticCondition(parent.expression, literalBooleans)
      if (known === false && parent.thenStatement === current) return true
      if (known === true && parent.elseStatement === current) return true
    }
    current = parent
  }
  return false
}

/** The guard throws and returns void, so only a bare call or `return`/`throw` operand honours it. */
function resultHonoursContract(call) {
  let node = call
  let parent = node.parent
  while (
    parent &&
    (ts.isAwaitExpression(parent) || ts.isParenthesizedExpression(parent))
  ) {
    node = parent
    parent = node.parent
  }
  if (!parent) return false
  return (
    (ts.isExpressionStatement(parent) && parent.expression === node) ||
    (ts.isReturnStatement(parent) && parent.expression === node) ||
    (ts.isThrowStatement(parent) && parent.expression === node)
  )
}

/**
 * No call/await/new and no assignment, update, delete or yield. Assignments count:
 * `const x = (globalThis.last = request)` writes attacker data before the guard.
 */
function isPureDeclarationStatement(statement) {
  if (
    ts.isTypeAliasDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isFunctionDeclaration(statement)
  ) {
    return true
  }
  if (!ts.isVariableStatement(statement)) return false
  let impure = false
  const visit = (node) => {
    if (
      ts.isCallExpression(node) ||
      ts.isNewExpression(node) ||
      ts.isAwaitExpression(node) ||
      ts.isTaggedTemplateExpression(node) ||
      ts.isDeleteExpression(node) ||
      ts.isYieldExpression(node) ||
      (ts.isBinaryExpression(node) &&
        ASSIGNMENT_OPERATORS.has(node.operatorToken.kind)) ||
      ((ts.isPrefixUnaryExpression(node) ||
        ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken ||
          node.operator === ts.SyntaxKind.MinusMinusToken))
    ) {
      impure = true
    }
    if (!impure) ts.forEachChild(node, visit)
  }
  visit(statement)
  return !impure
}

/** A catch is transparent only with no `return` at any depth and a final `throw`, so it cannot swallow. */
function catchCannotSwallow(tryStatement) {
  const clause = tryStatement.catchClause
  if (!clause) return true
  const statements = clause.block.statements
  if (statements.length === 0) return false
  let returns = false
  const visit = (node) => {
    if (isFunctionLike(node)) return
    if (ts.isReturnStatement(node)) returns = true
    if (!returns) ts.forEachChild(node, visit)
  }
  for (const statement of statements) visit(statement)
  if (returns) return false
  return ts.isThrowStatement(statements[statements.length - 1])
}

/** A leading `try` is transparent only when its catch cannot swallow the rejection. */
function leadingStatements(body) {
  if (!body || !ts.isBlock(body)) return null
  const statements = [...body.statements]
  if (statements.length === 1 && ts.isTryStatement(statements[0])) {
    if (!catchCannotSwallow(statements[0])) return statements
    return [...statements[0].tryBlock.statements]
  }
  return statements
}

/** A call inside a nested function may never run, so it cannot authorize. */
function insideNestedFunction(call, body) {
  let current = call.parent
  while (current && current !== body) {
    if (isFunctionLike(current)) return true
    current = current.parent
  }
  return false
}

/** A shadowed guard name (e.g. a local `const requireCronSecret`) is rejected, not resolved. */
function isShadowed(call, body, name) {
  const declaresName = (node) => {
    let found = false
    const visit = (child) => {
      if (found) return
      if (
        (ts.isVariableDeclaration(child) ||
          ts.isFunctionDeclaration(child) ||
          ts.isClassDeclaration(child) ||
          ts.isParameter(child)) &&
        child.name &&
        ts.isIdentifier(child.name) &&
        child.name.text === name
      ) {
        found = true
        return
      }
      if (isFunctionLike(child) && child !== node) return
      ts.forEachChild(child, visit)
    }
    ts.forEachChild(node, visit)
    return found
  }

  let current = call.parent
  while (current) {
    if (ts.isBlock(current) || isFunctionLike(current)) {
      if (declaresName(current)) return true
    }
    if (current === body) break
    current = current.parent
  }
  return false
}

function enclosingStatement(node) {
  let current = node.parent
  while (current) {
    if (ts.isStatement(current)) return current
    current = current.parent
  }
  return null
}

function statementIndexOf(node, statements) {
  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index]
    let found = false
    const visit = (candidate) => {
      if (candidate === node) found = true
      if (!found) ts.forEachChild(candidate, visit)
    }
    visit(statement)
    if (found) return index
  }
  return -1
}

function unwrapHandler(expression, sourceFile, seen = new Set()) {
  if (isFunctionLike(expression)) return { fn: expression }

  if (ts.isParenthesizedExpression(expression))
    return unwrapHandler(expression.expression, sourceFile, seen)

  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression))
    return unwrapHandler(expression.expression, sourceFile, seen)

  if (ts.isCallExpression(expression)) {
    const callee = expression.expression
    const name = ts.isIdentifier(callee) ? callee.text : null
    if (name === null || !TRANSPARENT_WRAPPERS.has(name)) {
      return {
        error: `unrecognized handler wrapper ${name ?? '<expression>'}(): review`
      }
    }
    for (const argument of expression.arguments) {
      const inner = unwrapHandler(argument, sourceFile, seen)
      if (inner.fn) return inner
    }
    return { error: `wrapper ${name}() has no inline handler function: review` }
  }

  if (ts.isIdentifier(expression)) {
    if (seen.has(expression.text))
      return { error: 'handler reference is circular: review' }
    seen.add(expression.text)
    const declaration = findLocalDeclaration(sourceFile, expression.text)
    if (!declaration)
      return {
        error: `handler ${expression.text} is not declared in this file: review`
      }
    return unwrapHandler(declaration, sourceFile, seen)
  }

  return { error: 'handler is not a recognizable function: review' }
}

function findLocalDeclaration(sourceFile, name) {
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name)
      return statement
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === name &&
          declaration.initializer
        ) {
          return declaration.initializer
        }
      }
    }
  }
  return null
}

function collectExportedHandlers(sourceFile) {
  const handlers = []
  const isExported = (node) =>
    node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false

  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name &&
      HTTP_METHODS.has(statement.name.text) &&
      isExported(statement)
    ) {
      handlers.push({ method: statement.name.text, node: statement })
      continue
    }
    if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          HTTP_METHODS.has(declaration.name.text) &&
          declaration.initializer
        ) {
          handlers.push({
            method: declaration.name.text,
            node: declaration.initializer
          })
        }
      }
      continue
    }
    if (
      ts.isExportDeclaration(statement) &&
      !statement.moduleSpecifier &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        if (!HTTP_METHODS.has(element.name.text)) continue
        const local = (element.propertyName ?? element.name).text
        const declaration = findLocalDeclaration(sourceFile, local)
        handlers.push({
          method: element.name.text,
          node: declaration ?? element
        })
      }
    }
  }
  return handlers
}

/** @returns {Array<{ file: string, method: string, ok: boolean, reason?: string }>} */
function analyzeRouteFile(relPath, text) {
  const sourceFile = parse(relPath, text)
  const { names, namespaces } = collectGuardBindings(sourceFile, relPath)
  const literalBooleans = collectLiteralBooleans(sourceFile)
  const handlers = collectExportedHandlers(sourceFile)

  if (handlers.length === 0) {
    return [
      {
        file: relPath,
        method: '<file>',
        ok: false,
        reason: 'no exported HTTP handler found: review'
      }
    ]
  }

  const isGuardCall = (node) => {
    if (!ts.isCallExpression(node)) return false
    const callee = node.expression
    if (ts.isIdentifier(callee)) return names.has(callee.text)
    if (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      namespaces.has(callee.expression.text)
    ) {
      return callee.name.text === namespaces.get(callee.expression.text)
    }
    return false
  }

  const results = []
  for (const handler of handlers) {
    const record = { file: relPath, method: handler.method }
    const unwrapped = isFunctionLike(handler.node)
      ? { fn: handler.node }
      : unwrapHandler(handler.node, sourceFile)
    if (unwrapped.error) {
      results.push({ ...record, ok: false, reason: unwrapped.error })
      continue
    }

    const body = unwrapped.fn.body
    const calls = []
    const visit = (node) => {
      if (isGuardCall(node)) calls.push(node)
      ts.forEachChild(node, visit)
    }
    if (body) visit(body)

    if (calls.length === 0) {
      results.push({
        ...record,
        ok: false,
        reason:
          names.size === 0 && namespaces.size === 0
            ? `no ${GUARD_EXPORT} import and no call`
            : `no ${GUARD_EXPORT} call in handler body`
      })
      continue
    }

    const statements = leadingStatements(body)
    let accepted = null
    const rejections = []
    for (const call of calls) {
      if (inDeadBranch(call, body, literalBooleans)) {
        rejections.push('guard call sits in a dead literal-false branch')
        continue
      }
      if (insideNestedFunction(call, body)) {
        rejections.push(
          'guard call is inside a function declared in the handler, so it may never run: review'
        )
        continue
      }
      if (
        ts.isIdentifier(call.expression) &&
        isShadowed(call, body, call.expression.text)
      ) {
        rejections.push(
          'guard name is shadowed by a local declaration, so the imported guard is not what runs: review'
        )
        continue
      }
      if (!resultHonoursContract(call)) {
        rejections.push(
          'guard result is discarded rather than allowed to throw: review'
        )
        continue
      }
      if (statements === null) {
        rejections.push('handler body is not a block: review')
        continue
      }
      const index = statementIndexOf(call, statements)
      if (index < 0) {
        rejections.push('guard call is nested below the handler body: review')
        continue
      }
      // Top-level only: `if (cond) requireCronSecret(request)` at index 0 leaves other requests unguarded.
      if (enclosingStatement(call) !== statements[index]) {
        rejections.push(
          ts.isTryStatement(statements[index]) &&
            !catchCannotSwallow(statements[index])
            ? 'guard call sits inside a try whose catch can return a success, so an invalid credential is swallowed: put the guard outside the try, or make the catch rethrow: review'
            : 'guard call does not run unconditionally: it sits inside a conditional, loop or nested block rather than being a top-level statement of the handler: review'
        )
        continue
      }
      const impure = statements
        .slice(0, index)
        .some((statement) => !isPureDeclarationStatement(statement))
      if (impure) {
        rejections.push('guard not first: review')
        continue
      }
      accepted = call
      break
    }

    if (accepted) results.push({ ...record, ok: true })
    else results.push({ ...record, ok: false, reason: rejections[0] })
  }

  return results
}

function checkManifest(manifestFiles, discovered, pathDiscovered) {
  const missing = []
  for (const file of manifestFiles) {
    if (!discovered.has(file)) {
      missing.push(
        `${file}: expected protected handler missing guard (listed in ${MANIFEST_PATH} but not discovered by path or by guard import)`
      )
    }
  }
  // Reverse check: otherwise a guarded non-cron route drops out once its guard import is deleted.
  if (pathDiscovered) {
    const listed = new Set(manifestFiles)
    for (const file of [...discovered].sort()) {
      if (pathDiscovered.has(file) || listed.has(file)) continue
      missing.push(
        `${file}: guard-importing route is not listed in ${MANIFEST_PATH}; add it, so removing the import later fails instead of silently dropping the file from the scan`
      )
    }
  }
  return missing
}

function trackedFiles() {
  return execFileSync('git', ['ls-files', 'app/api'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  })
    .split('\n')
    .filter(Boolean)
}

function readRepoFile(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8')
}

function readManifest() {
  const raw = JSON.parse(readRepoFile(MANIFEST_PATH))
  if (!Array.isArray(raw.protectedFiles) || raw.protectedFiles.length === 0) {
    throw new Error(
      `${MANIFEST_PATH}: protectedFiles must be a non-empty array`
    )
  }
  return raw.protectedFiles
}

function scan() {
  const files = trackedFiles()
  const byPath = selectCronPathFiles(files)
  const byImport = selectGuardImportingFiles(files, readRepoFile)
  const discovered = new Set([...byPath, ...byImport])

  if (discovered.size === 0) {
    console.error(
      'FAIL: discovered zero protected route handlers -- the census is broken, not clean'
    )
    process.exit(1)
  }

  const manifestFiles = readManifest()
  const problems = checkManifest(manifestFiles, discovered, new Set(byPath))
  for (const problem of problems) console.error(`MISSING ${problem}`)

  let handlerCount = 0
  for (const file of [...discovered].sort()) {
    for (const result of analyzeRouteFile(file, readRepoFile(file))) {
      handlerCount += 1
      if (result.ok) {
        console.log(`OK      ${result.file}#${result.method}`)
      } else {
        console.log(
          `MISSING ${result.file}#${result.method} -- ${result.reason}`
        )
        problems.push(`${result.file}#${result.method}: ${result.reason}`)
      }
    }
  }

  if (problems.length > 0) {
    console.error(
      `FAIL: ${problems.length} protected handler(s) are not guarded by ${GUARD_EXPORT}`
    )
    process.exit(1)
  }

  console.log(
    `OK: ${handlerCount} handler(s) across ${discovered.size} protected route file(s) call ${GUARD_EXPORT} first`
  )
}

const IMPORT_LINE = `import { ${GUARD_EXPORT} } from '@/app/lib/scheduler/require-cron-secret'`

const FIXTURES = [
  {
    name: 'fn-1 block-commented call',
    file: 'app/api/cron/fn1/route.ts',
    text: `${IMPORT_LINE}
export const POST = withErrorHandler(async (request) => {
  /* ${GUARD_EXPORT}(request) */
  return Response.json({ ok: true })
})
`,
    expect: [{ method: 'POST', ok: false }]
  },
  {
    name: 'fn-2 dead literal-false branch',
    file: 'app/api/cron/fn2/route.ts',
    text: `${IMPORT_LINE}
const ENFORCE = false
export const POST = withErrorHandler(async (request) => {
  if (ENFORCE) {
    ${GUARD_EXPORT}(request)
  }
  return Response.json({ ok: true })
})
`,
    expect: [{ method: 'POST', ok: false, reason: /dead literal-false branch/ }]
  },
  {
    name: 'fn-3 call inside a string literal',
    file: 'app/api/cron/fn3/route.ts',
    text: `${IMPORT_LINE}
export const POST = withErrorHandler(async (request) => {
  const doc = '${GUARD_EXPORT}(request)'
  return Response.json({ doc })
})
`,
    expect: [{ method: 'POST', ok: false }]
  },
  {
    name: 'fn-4 trailing line comment',
    file: 'app/api/cron/fn4/route.ts',
    text: `${IMPORT_LINE}
export const POST = withErrorHandler(async (request) => {
  return Response.json({ ok: true }) // ${GUARD_EXPORT}(request) removed
})
`,
    expect: [{ method: 'POST', ok: false }]
  },
  {
    name: 'fn-5 guard after a side effect',
    file: 'app/api/cron/fn5/route.ts',
    text: `${IMPORT_LINE}
export const POST = withErrorHandler(async (request) => {
  await purgeEverything()
  ${GUARD_EXPORT}(request)
  return Response.json({ ok: true })
})
`,
    expect: [{ method: 'POST', ok: false, reason: /guard not first/ }]
  },
  {
    name: 'fp-1 prettier-wrapped multi-line import',
    file: 'app/api/cron/fp1/route.ts',
    text: `import {
  ${GUARD_EXPORT}
} from '@/app/lib/scheduler/require-cron-secret'
export const POST = withErrorHandler(async (request) => {
  ${GUARD_EXPORT}(request)
  return Response.json({ ok: true })
})
`,
    expect: [{ method: 'POST', ok: true }]
  },
  {
    name: 'fp-2 aliased import',
    file: 'app/api/cron/fp2/route.ts',
    text: `import { ${GUARD_EXPORT} as assertCron } from '@/app/lib/scheduler/require-cron-secret'
export const POST = withErrorHandler(async (request) => {
  const started = Date.now
  assertCron(request)
  return Response.json({ ok: true, started })
})
`,
    expect: [{ method: 'POST', ok: true }]
  },
  {
    name: 'two handlers, one unguarded',
    file: 'app/api/cron/two/route.ts',
    text: `${IMPORT_LINE}
export const POST = withErrorHandler(async (request) => {
  ${GUARD_EXPORT}(request)
  return Response.json({ ok: true })
})
export const GET = withErrorHandler(async () => {
  return Response.json({ ok: true })
})
`,
    expect: [
      { method: 'POST', ok: true },
      { method: 'GET', ok: false, reason: /no requireCronSecret call/ }
    ]
  },
  {
    name: 'guarded inside a leading try block (repo shape)',
    file: 'app/api/cron/try/route.ts',
    text: `${IMPORT_LINE}
export const POST = withErrorHandler(async (request) => {
  try {
    ${GUARD_EXPORT}(request)
    return Response.json({ ok: true })
  } catch (error) {
    throw error
  }
})
`,
    expect: [{ method: 'POST', ok: true }]
  },
  {
    name: 'route.tsx under a route group, guarded',
    file: 'app/api/(admin)/cron/purge/route.tsx',
    text: `${IMPORT_LINE}
export async function DELETE(request) {
  ${GUARD_EXPORT}(request)
  return Response.json({ ok: true })
}
`,
    expect: [{ method: 'DELETE', ok: true }]
  },
  {
    name: 'guard result captured instead of thrown',
    file: 'app/api/cron/captured/route.ts',
    text: `${IMPORT_LINE}
export const POST = withErrorHandler(async (request) => {
  const ignored = ${GUARD_EXPORT}(request)
  return Response.json({ ignored })
})
`,
    expect: [{ method: 'POST', ok: false, reason: /discarded/ }]
  },
  {
    name: 'unknown wrapper is flagged, not assumed safe',
    file: 'app/api/cron/wrapped/route.ts',
    text: `${IMPORT_LINE}
export const POST = withMysteryAuth(handler)
`,
    expect: [
      { method: 'POST', ok: false, reason: /unrecognized handler wrapper/ }
    ]
  },
  {
    name: 'fn-6 guard in a runtime-dependent branch does not dominate',
    file: 'app/api/cron/fn6/route.ts',
    text: `${IMPORT_LINE}
export const POST = withErrorHandler(async (request) => {
  if (request.headers.has('x-probe')) ${GUARD_EXPORT}(request)
  return Response.json({ ok: true })
})
`,
    expect: [
      { method: 'POST', ok: false, reason: /does not run unconditionally/ }
    ]
  },
  {
    name: 'fn-7 guard inside a local function that is never called',
    file: 'app/api/cron/fn7/route.ts',
    text: `${IMPORT_LINE}
export const POST = withErrorHandler(async (request) => {
  const check = () => {
    ${GUARD_EXPORT}(request)
  }
  return Response.json({ ok: true, check: typeof check })
})
`,
    expect: [
      {
        method: 'POST',
        ok: false,
        reason: /inside a function declared in the handler/
      }
    ]
  },
  {
    name: 'fn-8 locally shadowed guard name',
    file: 'app/api/cron/fn8/route.ts',
    text: `${IMPORT_LINE}
export const POST = withErrorHandler(async (request) => {
  const ${GUARD_EXPORT} = () => {}
  ${GUARD_EXPORT}(request)
  return Response.json({ ok: true })
})
`,
    expect: [
      { method: 'POST', ok: false, reason: /shadowed by a local declaration/ }
    ]
  },
  {
    name: 'fn-9 catch turns the guard rejection into a success',
    file: 'app/api/cron/fn9/route.ts',
    text: `${IMPORT_LINE}
export const POST = withErrorHandler(async (request) => {
  try {
    ${GUARD_EXPORT}(request)
    return Response.json({ ok: true })
  } catch {
    return Response.json({ ok: true, degraded: true })
  }
})
`,
    expect: [{ method: 'POST', ok: false, reason: /swallowed/ }]
  },
  {
    name: 'fn-10 side-effecting assignment before the guard',
    file: 'app/api/cron/fn10/route.ts',
    text: `${IMPORT_LINE}
export const POST = withErrorHandler(async (request) => {
  const leaked = (globalThis.lastRequest = request)
  ${GUARD_EXPORT}(request)
  return Response.json({ ok: true, leaked: typeof leaked })
})
`,
    expect: [{ method: 'POST', ok: false, reason: /guard not first/ }]
  },
  {
    name: 'fp-3 NEGATIVE CONTROL: a catch that always rethrows keeps the try transparent',
    file: 'app/api/cron/fp3/route.ts',
    text: `${IMPORT_LINE}
export const POST = withErrorHandler(async (request) => {
  try {
    ${GUARD_EXPORT}(request)
    return Response.json({ ok: true })
  } catch (error) {
    throw error
  }
})
`,
    expect: [{ method: 'POST', ok: true }]
  },
  {
    name: 'fp-4 NEGATIVE CONTROL: namespace import of the worker-utils re-export',
    file: 'app/api/cron/ns/route.ts',
    text: `import * as workerAuth from '@/app/lib/sync/worker-utils'
export const POST = withErrorHandler(async (request) => {
  workerAuth.requireCronAuthorization(request)
  return Response.json({ ok: true })
})
`,
    expect: [{ method: 'POST', ok: true }]
  },
  {
    name: 'fp-5 NEGATIVE CONTROL: a namespace member that is not the guard is still rejected',
    file: 'app/api/cron/ns2/route.ts',
    text: `import * as workerAuth from '@/app/lib/sync/worker-utils'
export const POST = withErrorHandler(async (request) => {
  workerAuth.somethingElse(request)
  return Response.json({ ok: true })
})
`,
    expect: [{ method: 'POST', ok: false }]
  }
]

function selfTest() {
  // A temp tree inside the repo would make the self-test scan real source.
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'cron-guard-selftest-')
  )
  const realFixtureRoot = fs.realpathSync(fixtureRoot)
  const realRoot = fs.realpathSync(ROOT)
  if (
    realFixtureRoot === realRoot ||
    realFixtureRoot.startsWith(`${realRoot}${path.sep}`)
  ) {
    throw new Error(
      `self-test refused: fixture root ${realFixtureRoot} is inside the repository`
    )
  }

  let checks = 0
  try {
    for (const fixture of FIXTURES) {
      const absolute = path.join(fixtureRoot, fixture.file)
      fs.mkdirSync(path.dirname(absolute), { recursive: true })
      fs.writeFileSync(absolute, fixture.text)
    }

    const readFixture = (relPath) => {
      const absolute = path.join(fixtureRoot, relPath)
      if (!fs.existsSync(absolute)) {
        throw new Error(`self-test fixture missing: ${relPath}`)
      }
      return fs.readFileSync(absolute, 'utf8')
    }

    const fixtureFiles = FIXTURES.map((fixture) => fixture.file)

    const byPath = selectCronPathFiles(fixtureFiles)
    assert.ok(
      byPath.includes('app/api/(admin)/cron/purge/route.tsx'),
      'route-group + route.tsx must be discovered by path'
    )
    checks += 1
    assert.equal(
      byPath.length,
      fixtureFiles.length,
      'every fixture route must be discovered by path'
    )
    checks += 1
    assert.ok(
      selectCronPathFiles(['app/api/cron/route.ts']).length === 1,
      'app/api/cron/route.ts (no sub-segment) must be discovered'
    )
    checks += 1
    assert.equal(
      selectCronPathFiles(['app/api/worker/batch/route.ts']).length,
      0,
      'non-cron paths must not be discovered by path'
    )
    checks += 1

    const byImport = selectGuardImportingFiles(fixtureFiles, readFixture)
    assert.ok(
      byImport.includes('app/api/cron/fp2/route.ts'),
      'aliased import must be discovered by import'
    )
    checks += 1
    assert.ok(
      byImport.includes('app/api/cron/fp1/route.ts'),
      'multi-line import must be discovered by import'
    )
    checks += 1

    const workerLike = 'app/api/worker/batch/route.ts'
    const workerText = `${IMPORT_LINE}
export const POST = withErrorHandler(async (req) => {
  ${GUARD_EXPORT}(req)
  return Response.json({ ok: true })
})
`
    assert.deepEqual(
      selectGuardImportingFiles([workerLike], () => workerText),
      [workerLike],
      'a non-cron route importing the guard must be discovered'
    )
    checks += 1

    for (const fixture of FIXTURES) {
      const results = analyzeRouteFile(fixture.file, readFixture(fixture.file))
      assert.equal(
        results.length,
        fixture.expect.length,
        `${fixture.name}: expected ${fixture.expect.length} handler verdict(s), got ${results.length}`
      )
      checks += 1
      for (const expected of fixture.expect) {
        const actual = results.find((r) => r.method === expected.method)
        assert.ok(actual, `${fixture.name}: no verdict for ${expected.method}`)
        assert.equal(
          actual.ok,
          expected.ok,
          `${fixture.name}#${expected.method}: expected ok=${expected.ok}, got ok=${actual.ok} (${actual.reason ?? 'no reason'})`
        )
        checks += 1
        if (expected.reason) {
          assert.match(
            actual.reason ?? '',
            expected.reason,
            `${fixture.name}#${expected.method}: reason mismatch`
          )
          checks += 1
        }
      }
    }

    const manifestFiles = readManifest()
    assert.equal(
      checkManifest(manifestFiles, new Set(manifestFiles)).length,
      0,
      'manifest control: fully discovered manifest must not complain'
    )
    checks += 1
    const dropped = manifestFiles[0]
    const withoutOne = new Set(manifestFiles.filter((f) => f !== dropped))
    const complaints = checkManifest(manifestFiles, withoutOne)
    assert.equal(complaints.length, 1, 'manifest positive control must fire')
    assert.match(complaints[0], /expected protected handler missing guard/)
    checks += 2

    // A guard-importing non-cron route missing from the manifest must fail.
    const unlisted = 'app/api/newthing/route.ts'
    const reverse = checkManifest(
      manifestFiles,
      new Set([...manifestFiles, unlisted]),
      new Set()
    )
    assert.equal(reverse.length, 1, 'manifest reverse control must fire')
    assert.match(reverse[0], /is not listed in/)
    checks += 2
    assert.equal(
      checkManifest(
        manifestFiles,
        new Set([...manifestFiles, 'app/api/cron/new/route.ts']),
        new Set(['app/api/cron/new/route.ts'])
      ).length,
      0,
      'manifest reverse control: a path-discovered cron route needs no manifest entry'
    )
    checks += 1
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  }

  if (checks < 55) {
    throw new Error(
      `self-test ran only ${checks} assertions -- it is no longer exercising the detector`
    )
  }
  console.log(`cron-guard per-handler self-test passed (${checks} assertions)`)
}

/** Write the self-test fixtures for use as a negative control elsewhere (never inside the repo). */
function dumpFixtures(target) {
  if (!target) throw new Error('--dump-fixtures requires a target directory')
  const absolute = path.resolve(target)
  const realRoot = fs.realpathSync(ROOT)
  if (absolute === realRoot || absolute.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error(`refused: ${absolute} is inside the repository`)
  }
  for (const fixture of FIXTURES) {
    const file = path.join(absolute, fixture.file)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, fixture.text)
    console.log(file)
  }
}

/** Per-handler verdicts for every route under `dir`, without the repo census. */
function report(target) {
  if (!target) throw new Error('--report requires a directory')
  const base = path.resolve(target)
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const absolute = path.join(dir, entry.name)
      if (entry.isDirectory()) return walk(absolute)
      return isRouteFile(entry.name) ? [absolute] : []
    })
  let failed = 0
  for (const absolute of walk(base).sort()) {
    const relPath = path.relative(base, absolute).split(path.sep).join('/')
    for (const result of analyzeRouteFile(
      relPath,
      fs.readFileSync(absolute, 'utf8')
    )) {
      if (result.ok) console.log(`OK      ${relPath}#${result.method}`)
      else {
        failed += 1
        console.log(`MISSING ${relPath}#${result.method} -- ${result.reason}`)
      }
    }
  }
  if (failed > 0) process.exit(1)
}

const command = process.argv[2] ?? '--scan'
if (command === '--selftest') selfTest()
else if (command === '--scan') scan()
else if (command === '--dump-fixtures') dumpFixtures(process.argv[3])
else if (command === '--report') report(process.argv[3])
else {
  console.error(
    'usage: check-cron-routes-guarded.mjs [--selftest|--scan|--dump-fixtures <dir>|--report <dir>]'
  )
  process.exit(2)
}
