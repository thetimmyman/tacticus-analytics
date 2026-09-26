/**
 * Reports an internal identifier (opaque key or secret) reaching user-visible
 * copy, checks (a)-(f) below. Matches the terminal name only, no dataflow: a backstop, not proof.
 */

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

/** From this module's location, not cwd, or the repo-relative allowlist breaks. */
const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url))).replace(
  /\\/g,
  '/'
)

/* Defaults: options can only add, never remove. */

/** Tier 1 "opaque key". No escape hatch: any call already hides one. */
const DEFAULT_OPAQUE_IDENTIFIERS = [
  'guild_code',
  'guild_id',
  'player_id',
  'player_mapping_id',
  'user_id',
  'profile_id',
  'account_id',
  'cluster_id',
  'member_id'
]

/** Tier 2 "secret": no formatter escape; mask it or do not render it. */
const DEFAULT_SECRET_IDENTIFIERS = [
  'api_key',
  'encrypted_api_key',
  'tacticus_api_key',
  'client_secret',
  'access_token',
  'refresh_token',
  'session_token',
  'service_role_key',
  'webhook_secret',
  'bearer_token'
]

const DEFAULT_TEXT_ATTRIBUTES = [
  'title',
  'label',
  'aria-label',
  'placeholder',
  'description',
  'message',
  'subtitle',
  'heading',
  'tooltip',
  'emptyMessage',
  'emptyText',
  'alt',
  'caption',
  'helperText',
  'errorMessage',
  'children'
]

const DEFAULT_SINKS = [
  'setNotice',
  'setError',
  'setErrorMessage',
  'setMessage',
  'setStatus',
  'setStatusMessage',
  'setWarning',
  'setFeedback',
  'setBanner',
  'setToast',
  'toast',
  'toast.success',
  'toast.error',
  'toast.warning',
  'toast.warn',
  'toast.info',
  'toast.loading',
  'toast.custom',
  'toast.message',
  'alert',
  'window.alert'
]

/** The only calls a tier-2 secret may pass through (check (f)). Never add display formatters. */
const DEFAULT_MASKERS = ['maskApiKey', 'maskSecret', 'maskEmail']

/** Methods that pass their receiver through: `.slice(0, 8)` is still a leak. */
const STRING_PASSTHROUGH_METHODS = new Set([
  'slice',
  'substring',
  'substr',
  'trim',
  'trimStart',
  'trimEnd',
  'toUpperCase',
  'toLowerCase',
  'padStart',
  'padEnd',
  'replace',
  'replaceAll',
  'at',
  'charAt',
  'toString',
  'normalize',
  'repeat',
  'concat',
  'join'
])

const RENDERS_ALL_ARGUMENTS_METHODS = new Set(['concat', 'join'])

const RENDERS_SECOND_ARGUMENT_METHODS = new Set(['replace', 'replaceAll'])

const STRING_COERCION_CALLS = new Set(['String', 'JSON.stringify'])

const LABEL_MAP_TOKEN = /(label|name)/

/**
 * Domains whose keys are opaque, so `guildLabels[code] ?? code` re-leaks (`zone_type` is an internal
 * content id; display layer: war-naming.ts). Add a domain when a leak shows up, not on a hunch.
 */
const OPAQUE_LABEL_MAP_DOMAINS = [
  'guild',
  'player',
  'user',
  'profile',
  'account',
  'cluster',
  'member',
  'zone'
]

/** The key's last word decides a re-leak (the domain is necessary, not sufficient); word-split, so `raid` is no id. */
const OPAQUE_KEY_WORDS = new Set([
  'id',
  'ids',
  'code',
  'key',
  'uuid',
  'guid',
  'hash',
  'sha',
  'sha256'
])

const DOMAIN_EXTRA_OPAQUE_KEY_WORDS = {
  zone: new Set(['type'])
}

function lastWord(name) {
  const words = String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
  return words.length > 0 ? words[words.length - 1].toLowerCase() : ''
}

const keyNameLooksOpaque = (name, domains = []) => {
  if (name == null) return false
  const word = lastWord(name)
  if (OPAQUE_KEY_WORDS.has(word)) return true
  return domains.some((domain) =>
    DOMAIN_EXTRA_OPAQUE_KEY_WORDS[domain]?.has(word)
  )
}

const FORM_STATE_BAG = /(errors|touched|dirtyfields)$/

const DEFAULT_TEST_FILE_PATTERNS = [
  /\.(?:test|spec)\.[cm]?[jt]sx?$/,
  /(?:^|\/)__tests__\//,
  /(?:^|\/)__mocks__\//,
  /\.stories\.[cm]?[jt]sx?$/,
  /(?:^|\/)e2e\//,
  /(?:^|\/)tests?\//,
  /(?:^|\/)fixtures?\//,
  /\.fixture\.[cm]?[jt]sx?$/
]

function normalizeName(name) {
  return String(name).replace(/[_-]/g, '').toLowerCase()
}

function toNormalizedSet(list) {
  return new Set(list.map(normalizeName))
}

function unwrapChain(node) {
  let current = node
  while (
    current &&
    (current.type === 'ChainExpression' ||
      current.type === 'TSNonNullExpression' ||
      current.type === 'TSAsExpression' ||
      current.type === 'TSSatisfiesExpression' ||
      current.type === 'TSTypeAssertion' ||
      current.type === 'TSInstantiationExpression')
  ) {
    current = current.expression
  }
  return current
}

function terminalName(node) {
  const target = unwrapChain(node)
  if (!target) return null
  if (target.type === 'Identifier') return target.name
  if (target.type === 'MemberExpression') {
    if (!target.computed) {
      return target.property.type === 'Identifier' ? target.property.name : null
    }
    if (
      target.property.type === 'Literal' &&
      typeof target.property.value === 'string'
    ) {
      return target.property.value
    }
  }
  return null
}

function calleeName(node) {
  const callee = unwrapChain(node)
  if (!callee) return null
  if (callee.type === 'Identifier') return callee.name
  if (callee.type === 'MemberExpression' && !callee.computed) {
    const object = calleeName(callee.object)
    if (!object) return null
    if (callee.property.type !== 'Identifier') return null
    return `${object}.${callee.property.name}`
  }
  return null
}

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression'
])

/** Returned expressions; nested functions are not descended into. */
function returnExpressions(fn) {
  if (!fn || !FUNCTION_TYPES.has(fn.type)) return null
  if (fn.body && fn.body.type !== 'BlockStatement') return [fn.body]

  const out = []
  const walk = (node) => {
    if (!node || typeof node.type !== 'string') return
    if (FUNCTION_TYPES.has(node.type)) return
    if (node.type === 'ReturnStatement') {
      out.push(node.argument ?? null)
      return
    }
    for (const key of Object.keys(node)) {
      if (key === 'parent') continue
      const value = node[key]
      if (Array.isArray(value)) value.forEach(walk)
      else walk(value)
    }
  }
  walk(fn.body)
  return out
}

function asFunction(node) {
  const target = unwrapChain(node)
  if (!target) return null
  if (FUNCTION_TYPES.has(target.type)) return target
  if (target.type === 'CallExpression') {
    for (const argument of target.arguments) {
      const inner = unwrapChain(argument)
      if (inner && FUNCTION_TYPES.has(inner.type)) return inner
    }
  }
  return null
}

/** Local wrappers whose every return is an approved masker (check (f)); also records whether the file has JSX. */
function scanProgram(programNode, approvedMaskers) {
  const localMaskers = new Set()
  let hasJsx = false

  const isMaskerCall = (node) => {
    const target = unwrapChain(node)
    if (target?.type !== 'CallExpression') return false
    const name = calleeName(target.callee)
    if (!name) return false
    const last = normalizeName(name.split('.').pop())
    return approvedMaskers.has(last) || localMaskers.has(last)
  }

  const returnsOnlyMaskerCalls = (fn) => {
    const returns = returnExpressions(fn)
    if (!returns || returns.length === 0) return false
    return returns.every((expression) => expression && isMaskerCall(expression))
  }

  function visit(node) {
    if (node.type.startsWith('JSX')) hasJsx = true

    if (node.type === 'FunctionDeclaration' && node.id?.type === 'Identifier') {
      if (returnsOnlyMaskerCalls(node))
        localMaskers.add(normalizeName(node.id.name))
    } else if (
      node.type === 'VariableDeclarator' &&
      node.id?.type === 'Identifier' &&
      node.init
    ) {
      const fn = asFunction(node.init)
      if (fn && returnsOnlyMaskerCalls(fn))
        localMaskers.add(normalizeName(node.id.name))
    }

    for (const key of Object.keys(node)) {
      if (key === 'parent') continue
      const value = node[key]
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child.type === 'string') visit(child)
        }
      } else if (value && typeof value.type === 'string') {
        visit(value)
      }
    }
  }

  visit(programNode)
  return { localMaskers, hasJsx }
}

const allowedFileSchema = {
  type: 'object',
  properties: {
    path: { type: 'string', minLength: 1 },
    reason: { type: 'string', minLength: 1 },
    identifiers: { type: 'array', items: { type: 'string' }, minItems: 1 }
  },
  required: ['path', 'reason'],
  additionalProperties: false
}

/** @type {import('eslint').Rule.RuleModule} */
export const noInternalIdentifierInUi = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow rendering internal identifiers (guild_code, player_id, api_key, ...) in user-visible positions (WI-825).',
      recommended: true,
      url: 'https://github.com/thetimmyman/tacticus-analytics/blob/main/eslint-rules/no-internal-identifier-in-ui.mjs'
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowedFiles: { type: 'array', items: allowedFileSchema },
          additionalOpaqueIdentifiers: {
            type: 'array',
            items: { type: 'string' }
          },
          additionalSecretIdentifiers: {
            type: 'array',
            items: { type: 'string' }
          },
          additionalTextAttributes: {
            type: 'array',
            items: { type: 'string' }
          },
          additionalResolvers: { type: 'array', items: { type: 'string' } },
          additionalSinks: { type: 'array', items: { type: 'string' } }
        },
        additionalProperties: false
      }
    ],
    messages: {
      opaqueGuildIdentifier:
        '{{name}} is an internal identifier — render it through formatGuildDisplayLabel() from @/app/lib/format/guild instead of raw (WI-825).',
      opaqueIdentifier:
        '{{name}} is an internal identifier — render a resolved display label (a *_name column, or a label map with a fallback that cannot yield the key) instead of the raw value (WI-825).',
      secretIdentifier:
        '{{name}} is a secret and must never be rendered — mask it (maskSecret()/maskApiKey()) or drop it. A display formatter is not an escape hatch (WI-825).',
      secretPassedToCall:
        '{{name}} is a secret and is being passed into a call whose result is rendered. Only an approved masker (maskSecret()/maskApiKey()) may touch a secret on its way to the UI (WI-825).',
      labelMapFallbackLeaksKey:
        '{{map}}[{{key}}] falls back to {{key}} — when the label map misses, the raw internal key is rendered. Fall back to formatGuildDisplayLabel()/formatGuildCodeFallback() from @/app/lib/format/guild, never to the key itself (WI-825).',
      // Separate message because the fix differs; unfollowable advice gets the rule disabled.
      labelMapFallbackLeaksZoneKey:
        '{{map}}[{{key}}] falls back to {{key}} — on a miss this renders the raw zone id (ComsStation, Bunker2, AntiAirBattery1), which is what shipped to users before app/lib/war/war-naming.ts existed. Call zoneDisplayName()/zoneShortName() from @/app/lib/war/war-naming instead; do not build another zone-name table, and never render guild_war_zones.zone_name.'
    }
  },

  create(context) {
    const options = context.options[0] ?? {}
    const sourceCode = context.sourceCode ?? context.getSourceCode()

    const opaque = toNormalizedSet([
      ...DEFAULT_OPAQUE_IDENTIFIERS,
      ...(options.additionalOpaqueIdentifiers ?? [])
    ])
    const secret = toNormalizedSet([
      ...DEFAULT_SECRET_IDENTIFIERS,
      ...(options.additionalSecretIdentifiers ?? [])
    ])
    const textAttributes = toNormalizedSet([
      ...DEFAULT_TEXT_ATTRIBUTES,
      ...(options.additionalTextAttributes ?? [])
    ])
    const approvedMaskers = toNormalizedSet([
      ...DEFAULT_MASKERS,
      ...(options.additionalResolvers ?? [])
    ])
    const sinks = new Set([
      ...DEFAULT_SINKS,
      ...(options.additionalSinks ?? [])
    ])
    const allowedFiles = options.allowedFiles ?? []

    const cwd = (context.cwd ?? process.cwd()).replace(/\\/g, '/')
    const reportedPath = (
      context.filename ??
      context.getFilename() ??
      ''
    ).replace(/\\/g, '/')
    const absolutePath = reportedPath.startsWith('/')
      ? reportedPath
      : resolve(cwd, reportedPath.replace(/^\.\//, '')).replace(/\\/g, '/')
    const underRepoRoot = absolutePath.startsWith(`${REPO_ROOT}/`)

    const relativePath = (() => {
      if (underRepoRoot) return absolutePath.slice(REPO_ROOT.length + 1)
      if (absolutePath.startsWith(`${cwd}/`))
        return absolutePath.slice(cwd.length + 1)
      return absolutePath.replace(/^\.\//, '')
    })()

    if (
      DEFAULT_TEST_FILE_PATTERNS.some((pattern) => pattern.test(relativePath))
    )
      return {}

    /** Segment-aware file/directory match (no prefix carve-outs). */
    const isUnder = (candidate, entry) =>
      candidate === entry || candidate.startsWith(`${entry}/`)

    function pathMatches(entryPath) {
      const entry = entryPath
        .replace(/\\/g, '/')
        .replace(/^\.\//, '')
        .replace(/\/+$/, '')
      if (!entry) return false
      if (isUnder(relativePath, entry)) return true

      if (underRepoRoot) return false
      const index = absolutePath.indexOf(`/${entry}`)
      if (index < 0) return false
      const nextChar = absolutePath[index + entry.length + 1]
      return nextChar === undefined || nextChar === '/'
    }

    /** Tier 2 is never blanket-allowlistable: a secret must be named explicitly. */
    function isAllowlisted(normalizedIdentifier, tier) {
      return allowedFiles.some((entry) => {
        if (!pathMatches(entry.path)) return false
        if (!entry.identifiers) return tier !== 'secret'
        if (normalizedIdentifier == null) return tier !== 'secret'
        return entry.identifiers
          .map(normalizeName)
          .includes(normalizedIdentifier)
      })
    }

    let localMaskers = new Set()
    let hasJsx = false
    const isMaskerCall = (node) => {
      const name = calleeName(node.callee)
      if (!name) return false
      const last = normalizeName(name.split('.').pop())
      return approvedMaskers.has(last) || localMaskers.has(last)
    }

    /**
     * Sub-expressions that reach output. `secretsOnly` marks a position reached
     * through an unknown call: tier-1 keys stop there, secrets keep being followed.
     */
    function collectRendered(node, out, secretsOnly = false) {
      const target = unwrapChain(node)
      if (!target) return

      switch (target.type) {
        case 'ConditionalExpression':
          collectRendered(target.consequent, out, secretsOnly)
          collectRendered(target.alternate, out, secretsOnly)
          return

        case 'LogicalExpression':
          if (target.operator !== '&&')
            collectRendered(target.left, out, secretsOnly)
          collectRendered(target.right, out, secretsOnly)
          return

        case 'BinaryExpression':
          if (target.operator === '+') {
            collectRendered(target.left, out, secretsOnly)
            collectRendered(target.right, out, secretsOnly)
          }
          return

        case 'TemplateLiteral':
          for (const expression of target.expressions)
            collectRendered(expression, out, secretsOnly)
          return

        case 'TaggedTemplateExpression':
          collectRendered(target.quasi, out, secretsOnly)
          return

        case 'ArrayExpression':
          for (const element of target.elements) {
            if (!element || element.type === 'SpreadElement') continue
            collectRendered(element, out, secretsOnly)
          }
          return

        case 'SequenceExpression':
          collectRendered(
            target.expressions[target.expressions.length - 1],
            out,
            secretsOnly
          )
          return

        case 'AwaitExpression':
          collectRendered(target.argument, out, secretsOnly)
          return

        case 'CallExpression':
        case 'NewExpression': {
          if (target.type === 'CallExpression' && isMaskerCall(target)) return

          const callee = unwrapChain(target.callee)

          const dotted = calleeName(target.callee)
          if (dotted && STRING_COERCION_CALLS.has(dotted)) {
            for (const argument of target.arguments) {
              if (argument.type === 'SpreadElement') continue
              collectRendered(argument, out, secretsOnly)
            }
            return
          }

          if (
            callee?.type === 'MemberExpression' &&
            !callee.computed &&
            callee.property.type === 'Identifier' &&
            STRING_PASSTHROUGH_METHODS.has(callee.property.name)
          ) {
            const method = callee.property.name
            collectRendered(callee.object, out, secretsOnly)
            if (RENDERS_ALL_ARGUMENTS_METHODS.has(method)) {
              for (const argument of target.arguments) {
                if (argument.type === 'SpreadElement') continue
                collectRendered(argument, out, secretsOnly)
              }
            } else if (RENDERS_SECOND_ARGUMENT_METHODS.has(method)) {
              const replacement = target.arguments[1]
              if (replacement && replacement.type !== 'SpreadElement')
                collectRendered(replacement, out, secretsOnly)
            }
            return
          }

          for (const argument of target.arguments) {
            if (argument.type === 'SpreadElement') continue
            collectRendered(argument, out, true)
          }
          return
        }

        case 'Identifier':
          out.push({ node: target, secretsOnly })
          return

        case 'MemberExpression': {
          if (target.computed) {
            if (
              target.property.type === 'Literal' &&
              typeof target.property.value === 'string'
            ) {
              out.push({ node: target, secretsOnly })
              return
            }
            collectRendered(target.object, out, secretsOnly)
            return
          }
          out.push({ node: target, secretsOnly })
          return
        }

        default:
          return
      }
    }

    function isFormStateBagLookup(node) {
      const target = unwrapChain(node)
      if (target?.type !== 'MemberExpression') return false
      const objectName = terminalName(target.object)
      return (
        objectName != null && FORM_STATE_BAG.test(normalizeName(objectName))
      )
    }

    function isInternalIdentifier(normalized) {
      return (
        opaque.has(normalized) ||
        secret.has(normalized) ||
        normalized.endsWith('uuid')
      )
    }

    function report(node, secretsOnly) {
      if (isFormStateBagLookup(node)) return
      const name = terminalName(node)
      if (!name) return
      const normalized = normalizeName(name)

      if (secret.has(normalized)) {
        if (isAllowlisted(normalized, 'secret')) return
        context.report({
          node,
          messageId: secretsOnly ? 'secretPassedToCall' : 'secretIdentifier',
          data: { name }
        })
        return
      }

      if (secretsOnly) return

      if (opaque.has(normalized) || normalized.endsWith('uuid')) {
        if (isAllowlisted(normalized, 'opaque')) return
        context.report({
          node,
          messageId: normalized.startsWith('guild')
            ? 'opaqueGuildIdentifier'
            : 'opaqueIdentifier',
          data: { name }
        })
      }
    }

    function check(expression) {
      if (!expression || expression.type === 'JSXEmptyExpression') return
      const rendered = []
      collectRendered(expression, rendered)
      for (const entry of rendered) report(entry.node, entry.secretsOnly)
    }

    function isTextBearingAttribute(node) {
      if (node.name.type !== 'JSXIdentifier') return false
      const raw = node.name.name
      if (raw.startsWith('data-')) return false
      if (/^on[A-Z]/.test(raw)) return false
      return textAttributes.has(normalizeName(raw))
    }

    function isSinkCall(node) {
      const name = calleeName(node.callee)
      return name != null && sinks.has(name)
    }

    /** Follows a single-assignment const to its initializer: the only dataflow, since check (e) invites that hoist. */
    function resolveConstInit(node, depth = 0) {
      const target = unwrapChain(node)
      if (!target || depth > 3) return target
      if (target.type !== 'Identifier') return target

      let scope = null
      try {
        scope = sourceCode.getScope(target)
      } catch {
        return target
      }
      let variable = null
      for (let s = scope; s && !variable; s = s.upper) {
        variable = s.variables.find((v) => v.name === target.name) ?? null
      }
      if (!variable || variable.defs.length !== 1) return target
      const def = variable.defs[0]
      if (def.type !== 'Variable' || def.parent?.kind !== 'const') return target
      const init = def.node.init
      if (!init) return target
      return resolveConstInit(init, depth + 1)
    }

    function labelMapLookupParts(node) {
      const target = resolveConstInit(node)
      if (!target) return null
      if (target.type === 'MemberExpression' && target.computed) {
        const mapName = terminalName(target.object)
        return mapName ? { mapName, keyNode: target.property } : null
      }
      if (target.type === 'CallExpression') {
        const callee = unwrapChain(target.callee)
        if (
          callee?.type === 'MemberExpression' &&
          !callee.computed &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'get' &&
          target.arguments.length === 1 &&
          target.arguments[0].type !== 'SpreadElement'
        ) {
          const mapName = terminalName(callee.object)
          return mapName ? { mapName, keyNode: target.arguments[0] } : null
        }
      }
      return null
    }

    const flatten = (node) => sourceCode.getText(node).replace(/[\s?!]/g, '')

    function sameExpression(a, b) {
      if (!a || !b) return false
      if (flatten(a) === flatten(b)) return true
      const ra = resolveConstInit(a)
      const rb = resolveConstInit(b)
      return Boolean(ra && rb && flatten(ra) === flatten(rb))
    }

    function reportLabelMapLeak(reportNode, lookup, fallback) {
      const parts = labelMapLookupParts(lookup)
      if (!parts) return
      const normalizedMap = normalizeName(parts.mapName)
      if (!LABEL_MAP_TOKEN.test(normalizedMap)) return
      if (!sameExpression(parts.keyNode, fallback)) return

      const keyName = terminalName(parts.keyNode)
      const normalizedKey = keyName ? normalizeName(keyName) : null

      // A known internal identifier fires in any map; otherwise its last word must be opaque, in an opaque domain.
      const domains = OPAQUE_LABEL_MAP_DOMAINS.filter((d) =>
        normalizedMap.includes(d)
      )
      const keyIsOpaque =
        (normalizedKey != null && isInternalIdentifier(normalizedKey)) ||
        (domains.length > 0 && keyNameLooksOpaque(keyName, domains))
      if (!keyIsOpaque) return

      if (isAllowlisted(normalizedKey, 'opaque')) return

      // `zoneLabels[row.guild_id] ?? row.guild_id` is still a guild leak.
      const isZoneLeak =
        domains.includes('zone') &&
        !(normalizedKey != null && isInternalIdentifier(normalizedKey))

      context.report({
        node: reportNode,
        messageId: isZoneLeak
          ? 'labelMapFallbackLeaksZoneKey'
          : 'labelMapFallbackLeaksKey',
        data: {
          map: parts.mapName,
          key: sourceCode.getText(parts.keyNode)
        }
      })
    }

    function checkLabelMapLogical(node) {
      if (node.operator !== '||' && node.operator !== '??') return
      reportLabelMapLeak(node, node.left, node.right)
    }

    const isNullish = (node) => {
      const target = unwrapChain(node)
      return (
        (target?.type === 'Identifier' && target.name === 'undefined') ||
        (target?.type === 'Literal' && target.value === null)
      )
    }

    function checkLabelMapConditional(node) {
      const test = unwrapChain(node.test)
      if (!test) return

      if (labelMapLookupParts(test)) {
        reportLabelMapLeak(node, test, node.alternate)
        return
      }

      if (
        test.type === 'UnaryExpression' &&
        test.operator === '!' &&
        labelMapLookupParts(test.argument)
      ) {
        reportLabelMapLeak(node, test.argument, node.consequent)
        return
      }

      if (test.type === 'BinaryExpression') {
        let lookup = null
        if (isNullish(test.right)) lookup = test.left
        else if (isNullish(test.left)) lookup = test.right
        if (!lookup || !labelMapLookupParts(lookup)) return
        if (test.operator === '===' || test.operator === '==')
          reportLabelMapLeak(node, lookup, node.consequent)
        else if (test.operator === '!==' || test.operator === '!=')
          reportLabelMapLeak(node, lookup, node.alternate)
      }
    }

    return {
      Program(node) {
        const scan = scanProgram(node, approvedMaskers)
        localMaskers = scan.localMaskers
        hasJsx = scan.hasJsx
      },

      JSXExpressionContainer(node) {
        const parent = node.parent
        if (!parent) return
        if (parent.type !== 'JSXElement' && parent.type !== 'JSXFragment')
          return
        check(node.expression)
      },

      JSXAttribute(node) {
        if (!isTextBearingAttribute(node)) return
        if (node.value?.type !== 'JSXExpressionContainer') return
        check(node.value.expression)
      },

      CallExpression(node) {
        if (!hasJsx) return
        if (!isSinkCall(node)) return
        for (const argument of node.arguments) {
          if (argument.type === 'SpreadElement') continue
          check(argument)
        }
      },

      LogicalExpression: checkLabelMapLogical,
      ConditionalExpression: checkLabelMapConditional
    }
  }
}

const WI825_RULE_ID = 'tacticus/no-internal-identifier-in-ui'

/** Separate rule id, so a directive disabling the main rule cannot suppress this report. */
export const noBlanketIdentifierDisable = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require WI-825 lint suppressions to be line-scoped and to carry a written reason.',
      recommended: true,
      url: 'https://github.com/thetimmyman/tacticus-analytics/blob/main/eslint-rules/no-internal-identifier-in-ui.mjs'
    },
    schema: [],
    messages: {
      fileWideDisable:
        'A file-wide `eslint-disable` of {{rule}} switches the WI-825 guardrail off for the entire file, secrets included. Use `eslint-disable-next-line ... -- <reason>` at the exact site, or an entry in eslint-rules/wi825-allowed-files.mjs (the one allowlist — do not start a second copy) where the reason is discoverable.',
      missingReason:
        'A suppression of {{rule}} must carry a written reason: `// eslint-disable-next-line {{rule}} -- why this identifier is legitimate here`.',
      unscopedDisable:
        'A file-wide `eslint-disable` with no rule list also switches off {{rule}}. List the rules being disabled explicitly.'
    }
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode()
    const DIRECTIVE = /^\s*eslint-disable(-next-line|-line)?(?=\s|$)/

    return {
      Program() {
        for (const comment of sourceCode.getAllComments()) {
          const match = DIRECTIVE.exec(comment.value)
          if (!match) continue
          const fileWide = !match[1]
          const body = comment.value.slice(match[0].length)
          const [ruleList] = body.split('--')
          const rules = ruleList
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean)

          if (fileWide && rules.length === 0) {
            context.report({
              loc: comment.loc,
              messageId: 'unscopedDisable',
              data: { rule: WI825_RULE_ID }
            })
            continue
          }
          if (!rules.includes(WI825_RULE_ID)) continue

          if (fileWide) {
            context.report({
              loc: comment.loc,
              messageId: 'fileWideDisable',
              data: { rule: WI825_RULE_ID }
            })
            continue
          }
          if (!/--\s*\S/.test(body)) {
            context.report({
              loc: comment.loc,
              messageId: 'missingReason',
              data: { rule: WI825_RULE_ID }
            })
          }
        }
      }
    }
  }
}

export const plugin = {
  meta: { name: 'eslint-plugin-tacticus', version: '2.0.0' },
  rules: {
    'no-internal-identifier-in-ui': noInternalIdentifierInUi,
    'no-blanket-identifier-disable': noBlanketIdentifierDisable
  }
}

export default noInternalIdentifierInUi
