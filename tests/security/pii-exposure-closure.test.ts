import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import pino from 'pino'
import ts from 'typescript'
import { legacyConsoleLogger as appCoreLogger } from '@tacticus/app-core/logger'
import { createComponentLogger as createClientLogger } from '@/app/lib/logging/client'
import {
  createLoggerOptions,
  resolveRequestId,
  sanitizeLogValue
} from '@/app/lib/logging/logger'
import { sanitizeSentryEvent } from '@/app/lib/monitoring/sentry-privacy'
import { Errors } from '@/app/lib/errors/AppError'

const read = (path: string) => readFileSync(path, 'utf8')

const migrationPath =
  'supabase/migrations/20260817000000_close_pii_exposure_boundaries.sql'

describe('PII exposure closure', () => {
  it('removes public execution from identity-bearing helper RPCs', () => {
    const migration = read(migrationPath)
    const privateFunctions = [
      'find_orphaned_player_mappings()',
      'get_guild_members_debug(text)',
      'get_guild_members_simple()',
      'get_player_mapping_debug(uuid)',
      'get_user_cluster_code(uuid)',
      'get_user_guild_code(uuid)',
      'get_user_profile(uuid)',
      'get_user_support_unread_count(uuid)',
      'get_users_needing_guild_update()',
      'resolve_verified_players(uuid[])',
      'resolve_verified_discord_identities(text[])'
    ]

    for (const signature of privateFunctions) {
      expect(migration).toContain(
        `REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated;`
      )
      expect(migration).toContain(
        `GRANT EXECUTE ON FUNCTION public.${signature} TO service_role;`
      )
    }
  })

  it('removes broad player_mapping reads while preserving safe reads and writes', () => {
    const migration = read(migrationPath)

    expect(migration).toContain(
      'REVOKE ALL ON TABLE public.player_mapping FROM anon, authenticated;'
    )
    expect(migration).toContain(
      'GRANT SELECT (id, player_id, display_name, created_at, updated_at,'
    )
    expect(migration).toMatch(
      /has_table_privilege\('authenticated', 'public\.player_mapping', 'UPDATE'\)/
    )
    expect(migration).toMatch(
      /has_column_privilege\(\s*'authenticated',\s*'public\.player_mapping',\s*'display_name',\s*'SELECT'\s*\)/s
    )
    expect(migration).toMatch(
      /'tacticus_api_key_encrypted'[\s\S]*has_column_privilege\([\s\S]*sensitive_column,[\s\S]*'SELECT'/
    )
    expect(migration).toContain(
      'CREATE OR REPLACE VIEW public.current_user_player_mapping'
    )
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.get_scoped_player_profile(p_user_id uuid)'
    )
    const peerProfile = read('app/(dashboard)/profile/[id]/page.tsx')
    expect(peerProfile).toContain(".rpc('get_scoped_player_profile'")
    expect(peerProfile).not.toContain(".from('player_with_cluster')")
    expect(migration).toContain('WHERE mapping.user_id = (SELECT auth.uid())')
  })

  it('keeps identity-bearing creator assets out of the published runtime', () => {
    const inventory = JSON.parse(read('public/asset-provenance.json')) as {
      groups: Array<{
        containsPersonalIdentity?: boolean
        exactPaths: string[]
      }>
    }
    const creators = read('app/components/homepage/ContentCreators.tsx')
    const identityAssets = inventory.groups
      .filter((group) => group.containsPersonalIdentity === true)
      .flatMap((group) => group.exactPaths)

    expect(identityAssets.length).toBeGreaterThan(0)
    for (const asset of identityAssets) {
      expect(existsSync(asset)).toBe(false)
      expect(creators).not.toContain(asset.replace(/^public/, ''))
    }

    expect(read('package.json')).toContain(
      '"security:runtime-pii-assets": "node scripts/security/check-asset-inventory.mjs --runtime-pii"'
    )
    expect(read('.github/workflows/build-clean-image.yml')).toContain(
      'npm run security:runtime-pii-assets'
    )
    expect(() =>
      execFileSync(
        process.execPath,
        ['scripts/security/check-asset-inventory.mjs', '--runtime-pii'],
        { stdio: 'pipe' }
      )
    ).not.toThrow()
  })

  it('rejects a later .dockerignore negation that re-includes PII', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pii-asset-gate-'))
    const dockerignore = join(directory, '.dockerignore')
    try {
      writeFileSync(
        dockerignore,
        `${read('.dockerignore')}\n!public/images/nandi-profile.jpg\n`
      )
      expect(() =>
        execFileSync(
          process.execPath,
          ['scripts/security/check-asset-inventory.mjs', '--runtime-pii'],
          {
            env: {
              ...process.env,
              ASSET_GATE_DOCKERIGNORE_PATH: dockerignore
            },
            stdio: 'pipe'
          }
        )
      ).toThrow()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects Docker character-class negations after protected exclusions', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pii-asset-gate-class-'))
    const dockerignore = join(directory, '.dockerignore')
    try {
      writeFileSync(
        dockerignore,
        `${read('.dockerignore')}\n!public/images/nandi-profile.jp[g]\n`
      )
      expect(() =>
        execFileSync(
          process.execPath,
          ['scripts/security/check-asset-inventory.mjs', '--runtime-pii'],
          {
            env: {
              ...process.env,
              ASSET_GATE_DOCKERIGNORE_PATH: dockerignore
            },
            stdio: 'pipe'
          }
        )
      ).toThrow()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects Dockerfile-specific ignore files that override the audited root rules', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pii-dockerfile-ignore-'))
    const dockerfile = join(directory, 'Dockerfile.prod')
    try {
      writeFileSync(`${dockerfile}.dockerignore`, read('.dockerignore'))
      expect(() =>
        execFileSync(
          process.execPath,
          ['scripts/security/check-asset-inventory.mjs', '--runtime-pii'],
          {
            env: {
              ...process.env,
              ASSET_GATE_DOCKERFILE_PATH: dockerfile
            },
            stdio: 'pipe'
          }
        )
      ).toThrow()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('redacts deeply nested PII, arrays, errors, and message text in real Pino output', () => {
    const records: string[] = []
    const options = {
      ...createLoggerOptions(),
      level: 'info',
      transport: undefined
    }
    const captured = pino(options, {
      write(chunk: string) {
        records.push(chunk)
      }
    })
    const email = 'person@example.com'
    const userId = '123e4567-e89b-42d3-a456-426614174000'
    const requestId = 'req_223e4567-e89b-42d3-a456-426614174000'
    const discordUserId = '123456789012345678'
    const privateQueryUrl =
      'https://example.test/player-stats/search/Alice?guild_code=PRIVATE#secret'
    const error = new Error(`Account ${email} (${userId}) failed`)
    error.cause = { context: { discord_user_id: discordUserId } }

    captured.info(
      {
        requestId,
        request: {
          body: { email },
          users: [{ userId }, { nested: { discord_user_id: discordUserId } }]
        },
        err: error,
        url: privateQueryUrl,
        referer: privateQueryUrl,
        userAgent: 'Alice PRIVATE custom client',
        stack: `Error: Player Alice in PRIVATE failed\n    at handler.ts:1:1`
      },
      `Login failed for ${email} (${userId}) at ${privateQueryUrl}`
    )
    const privateGuild = 'PRIVATEGUILD'
    captured.warn(
      {
        err: Errors.invalidGuildCode(privateGuild),
        profileId: 9182,
        mappingId: 2718
      },
      'Application request rejected'
    )

    const output = records.join('')
    expect(output).toContain('[Redacted]')
    expect(output).not.toContain(email)
    expect(output).not.toContain(userId)
    expect(output).not.toContain(discordUserId)
    expect(output).not.toContain(privateGuild)
    expect(output).not.toContain('Alice')
    expect(output).not.toContain('guild_code=PRIVATE')
    expect(output).not.toContain('Player Alice in PRIVATE failed')
    expect(output).toContain('/player-stats/search/[Redacted]')
    expect(records.at(-1)).not.toContain('9182')
    expect(records.at(-1)).not.toContain('2718')
    expect(output).toContain(`"requestId":"${requestId}"`)
    expect(sanitizeLogValue({ request: { body: { email } } })).toEqual({
      request: { body: { email: '[Redacted]' } }
    })
    expect(
      sanitizeLogValue({
        guild_ids: ['SHORT-GUILD'],
        source_guild_id: 'SOURCE',
        targetGuildIds: ['TARGET'],
        requestId: email
      })
    ).toEqual({
      guild_ids: '[Redacted]',
      source_guild_id: '[Redacted]',
      targetGuildIds: '[Redacted]',
      requestId: '[Redacted]'
    })
    expect(resolveRequestId(email)).not.toBe(email)
    const victimUuid = '123e4567-e89b-42d3-a456-426614174000'
    expect(resolveRequestId(victimUuid)).not.toBe(victimUuid)
    expect(sanitizeLogValue({ requestId: victimUuid })).toEqual({
      requestId: '[Redacted]'
    })
    const repeatedScheme = `http://${'http://'.repeat(
      5_000
    )}private?player=Alice&guild_code=PRIVATE`
    const repeatedSchemeOutput = sanitizeLogValue(repeatedScheme)
    expect(repeatedSchemeOutput).not.toContain('?player=Alice')
    expect(repeatedSchemeOutput).not.toContain('guild_code=PRIVATE')
  })

  it('scrubs complete Sentry events while preserving correlation tokens', () => {
    const requestId = 'req_123e4567-e89b-42d3-a456-426614174000'
    const event = sanitizeSentryEvent({
      user: { email: 'person@example.com' },
      request: {
        method: 'POST',
        url: 'https://example.test/profile/Alice?guild=SECRET'
      },
      tags: { guild_code: 'SECRET', requestId },
      message: 'Private Player failed',
      extra: {
        playerName: 'Alice',
        nested: [{ discord_user_id: '123456789012345678' }]
      },
      contexts: {
        auth: {
          redirectTo: '/player-stats/search/PrivatePlayer',
          reason: 'DiscordHandle'
        }
      },
      breadcrumbs: [
        {
          category: 'auth',
          message: 'PrivatePlayer opened PRIVATE-GUILD',
          data: { arbitrary: 'DiscordHandle' }
        }
      ],
      exception: { values: [{ type: 'Error', value: 'Alice failed' }] }
    })

    const serialized = JSON.stringify(event)
    expect(serialized).not.toContain('person@example.com')
    expect(serialized).not.toContain('SECRET')
    expect(serialized).not.toContain('Alice')
    expect(serialized).not.toContain('123456789012345678')
    expect(serialized).not.toContain('PrivatePlayer')
    expect(serialized).not.toContain('DiscordHandle')
    expect(serialized).not.toContain('PRIVATE-GUILD')
    expect(event.request).toEqual({ method: 'POST' })
    expect(event.tags.requestId).toBe(requestId)
    expect(event.contexts).toBeUndefined()
    expect(event.breadcrumbs).toEqual([{ category: 'auth' }])

    expect(
      sanitizeSentryEvent({
        fingerprint: ['supabase-auth-processlock-timeout']
      }).fingerprint
    ).toEqual(['supabase-auth-processlock-timeout'])
    expect(
      sanitizeSentryEvent({ fingerprint: ['Alice-private-guild'] }).fingerprint
    ).toBeUndefined()
    expect(
      sanitizeSentryEvent({ message: 'Boss calculation failed' }).message
    ).toBe('Boss calculation failed')
    expect(
      sanitizeSentryEvent({ message: 'Private player failed' }).message
    ).toBe('Application message')
  })

  it('keeps the chunk_reload outcome tag, and only its fixed vocabulary', () => {
    // A tag missing from SAFE_TAG_NAMES is dropped silently.
    expect(
      sanitizeSentryEvent({ tags: { chunk_reload: 'attempted' } }).tags
    ).toEqual({ chunk_reload: 'attempted' })
    expect(
      sanitizeSentryEvent({ tags: { chunk_reload: 'suppressed' } }).tags
    ).toEqual({ chunk_reload: 'suppressed' })
    expect(
      sanitizeSentryEvent({
        tags: { chunk_reload: 'victim@example.com' }
      }).tags
    ).toEqual({})
  })

  it('preserves safe route tags and drops tag values containing a slash', () => {
    expect(
      sanitizeSentryEvent({
        tags: {
          operation: 'GET:api.wars.analytics.cores',
          status_code: '500',
          error_code: 'INTERNAL_ERROR',
          private_path: 'GET:/api/players/Alice'
        }
      }).tags
    ).toEqual({
      operation: 'GET:api.wars.analytics.cores',
      status_code: '500',
      error_code: 'INTERNAL_ERROR'
    })

    expect(
      sanitizeSentryEvent({
        tags: {
          operation: 'GET:api.players._',
          unsafe: 'GET:/api/players/Alice'
        }
      }).tags
    ).toEqual({ operation: 'GET:api.players._' })
  })

  it('never trusts an attacker-controlled value merely because it is a correlation field', () => {
    const email = 'victim@example.com'
    const event = sanitizeSentryEvent({
      tags: { request_id: email },
      contexts: { trace: { trace_id: email, span_id: email } }
    })

    expect(JSON.stringify(event)).not.toContain(email)
    expect(event.tags).toEqual({})
    expect(event.contexts).toEqual({ trace: {} })
  })

  it('sanitizes the production-enabled app-core error logger', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const userId = '123e4567-e89b-42d3-a456-426614174000'
    const email = 'person@example.com'
    try {
      appCoreLogger.error(`Failed for ${userId}`, {
        request: { body: { email } },
        userId,
        requestUrl:
          'https://example.test/private?player=Alice&guild_code=PRIVATE#secret',
        referer:
          'https://example.test/reset?player=Alice&guild_code=PRIVATE#secret',
        userAgent: 'Alice PRIVATE custom client',
        stack: 'Error: Player Alice in PRIVATE failed\n    at handler.ts:1:1'
      })
      const output = JSON.stringify(errorSpy.mock.calls)
      expect(output).toContain('[Redacted]')
      expect(output).not.toContain(userId)
      expect(output).not.toContain(email)
      expect(output).not.toContain('Alice')
      expect(output).not.toContain('guild_code=PRIVATE')
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('sanitizes client error logs that remain enabled in production', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const playerName = 'Private Player'
    const guildCode = 'PRIVATE-GUILD'
    try {
      createClientLogger('privacy-test').error(
        { playerName, nested: { Guild_Code: guildCode } },
        'Client request failed'
      )
      const output = JSON.stringify(errorSpy.mock.calls)
      expect(output).toContain('[Redacted]')
      expect(output).not.toContain(playerName)
      expect(output).not.toContain(guildCode)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('does not interpolate or directly console-log private player identity at known sinks', () => {
    const files = [
      'app/lib/auth/index.ts',
      'app/api/player-stats/historical-performance/route.ts',
      'app/lib/player-stats/fetchHistoricalPerformance.ts',
      'app/lib/player-stats/build-historical-queries.ts',
      'app/lib/player-stats/resolve-player-identity.ts',
      'app/api/members/request-api-key/route.ts',
      'app/api/members/roster/route.ts',
      'app/api/guild-tokens/sync/route.ts'
    ]
      .map(read)
      .join('\n')

    expect(files).not.toMatch(/console\.log\([^)]*(player|guild)/is)
    expect(files).not.toMatch(/`[^`]*\$\{member\.display_name\}[^`]*`/)
    expect(files).not.toContain('email: payload.email')
    expect(files).not.toContain('targetPlayerName: targetPlayer.display_name')
    expect(files).not.toContain('targetPlayerId: playerId')

    const authCallback = read('app/(auth)/auth/callback/route.ts')
    expect(authCallback).not.toContain('errorDescription: errorDescription')
    expect(authCallback).not.toContain(
      "{ provider }, '[Auth Callback] No code provided in callback'"
    )
    expect(authCallback).not.toMatch(
      /\bevent:\s*'[^']+'[\s\S]{0,120}\n\s*provider\s*[,}]/u
    )
    expect(authCallback).toContain('provider: safeProvider')

    const authErrorPage = read('app/(auth)/auth/error/ClientPage.tsx')
    expect(authErrorPage).not.toContain(
      "logger.error({ error, description }, '[Auth Error Page] Error')"
    )
    expect(authErrorPage).toContain('hasDescription: Boolean(description)')
    expect(authErrorPage).toContain('SAFE_AUTH_ERROR_CODES.has(error)')

    const sourcePaths: string[] = []
    const collectSources = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const sourcePath = join(directory, entry.name)
        if (entry.isDirectory()) collectSources(sourcePath)
        else if (/\.(?:ts|tsx)$/u.test(entry.name)) sourcePaths.push(sourcePath)
      }
    }
    collectSources('app')
    collectSources('packages')

    const privateNames = new Set([
      'userid',
      'playerid',
      'profileid',
      'mappingid',
      'mappingids',
      'memberid',
      'accountid',
      'playername',
      'displayname',
      'searchname',
      'guild',
      'guildcode',
      'guildid',
      'guildname',
      'guildtag',
      'discorduserid',
      'normalizedguildcode',
      'normalizedclustercode',
      'previouscluster',
      'apiname'
    ])
    const privateSuffix =
      /(?:user|player|guild|cluster|discord|patreon)(?:id|ids|code|codes|name|names|username|usernames|tag|tags)$/u
    const isPrivateIdentifier = (identifier: string) => {
      const normalized = identifier.replace(/[_-]/gu, '').toLowerCase()
      return privateNames.has(normalized) || privateSuffix.test(normalized)
    }

    const findViolations = (sourcePath: string, sourceText: string) => {
      const source = ts.createSourceFile(
        sourcePath,
        sourceText,
        ts.ScriptTarget.Latest,
        true,
        sourcePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      )
      const declarations = new Map<string, ts.Expression>()
      const collectDeclarations = (node: ts.Node) => {
        if (
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          node.initializer
        ) {
          declarations.set(node.name.text, node.initializer)
        }
        ts.forEachChild(node, collectDeclarations)
      }
      collectDeclarations(source)

      const taintedText = new Set<string>()
      const expressionContainsIdentity = (node: ts.Node): boolean => {
        let found = false
        const inspect = (candidate: ts.Node) => {
          if (found) return
          if (
            ts.isIdentifier(candidate) &&
            (isPrivateIdentifier(candidate.text) ||
              taintedText.has(candidate.text))
          ) {
            found = true
            return
          }
          ts.forEachChild(candidate, inspect)
        }
        inspect(node)
        return found
      }
      const textLike = (node: ts.Expression): boolean =>
        ts.isTemplateExpression(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isStringLiteral(node) ||
        ts.isBinaryExpression(node) ||
        ts.isConditionalExpression(node) ||
        ts.isCallExpression(node)

      let changed = true
      while (changed) {
        changed = false
        for (const [name, initializer] of declarations) {
          if (
            !taintedText.has(name) &&
            /(?:context|message|text|label|description|upper.*(?:guild|player|user))/iu.test(
              name
            ) &&
            textLike(initializer) &&
            expressionContainsIdentity(initializer)
          ) {
            taintedText.add(name)
            changed = true
          }
        }
      }

      const sourceViolations: string[] = []
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
          const callee = node.expression.getText(source)
          const isLogger =
            /^(?:console|.*(?:logger|log))\.(?:log|info|warn|error|debug|fatal)$/iu.test(
              callee
            )
          if (isLogger) {
            const hasPrivateInterpolation = node.arguments.some((argument) => {
              if (ts.isTemplateExpression(argument)) {
                return argument.templateSpans.some((span) =>
                  expressionContainsIdentity(span.expression)
                )
              }
              if (ts.isBinaryExpression(argument)) {
                return expressionContainsIdentity(argument)
              }
              return ts.isIdentifier(argument) && taintedText.has(argument.text)
            })
            const hasDirectConsoleIdentity =
              callee.startsWith('console.') &&
              node.arguments.some(expressionContainsIdentity)
            if (hasPrivateInterpolation || hasDirectConsoleIdentity) {
              const { line } = source.getLineAndCharacterOfPosition(
                node.getStart(source)
              )
              sourceViolations.push(`${sourcePath}:${line + 1}`)
            }
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
      return sourceViolations
    }

    const fixtureViolations = findViolations(
      'pii-source-gate-fixture.ts',
      [
        'const logContext = guild_code ? `[${guild_code}]` : "[API]"',
        'auditLogger.error(logContext)',
        'const upperGuildCode = guild_code.toUpperCase()',
        'logger.warn(`Failed for ${upperGuildCode}`)',
        'console.error("Guild " + source_guild_id)'
      ].join('\n')
    )
    expect(fixtureViolations).toEqual([
      'pii-source-gate-fixture.ts:2',
      'pii-source-gate-fixture.ts:4',
      'pii-source-gate-fixture.ts:5'
    ])

    const violations = sourcePaths.flatMap((sourcePath) => {
      if (/\.(?:test|spec)\.(?:ts|tsx)$/u.test(sourcePath)) return []
      return findViolations(sourcePath, read(sourcePath))
    })
    expect(read('app/components/auth/LoginForm.tsx')).not.toContain(
      "scope.setContext('auth', payload)"
    )
    expect(read('app/lib/middleware/errorHandler.ts')).not.toMatch(
      /`(?:AppError|AuthError|Expected condition|Normalized error):? \$\{(?:error|appError)\.message\}`/u
    )
    expect(violations).toEqual([])
  })
})
