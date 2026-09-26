import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

describe('next standalone runtime tracing', () => {
  it('keeps runtime-traced roots out of the global tracing excludes', () => {
    // Runtime data is copied explicitly; only application support roots stay traceable.
    const config = require(path.join(process.cwd(), 'next.config.js')) as {
      outputFileTracingExcludes?: Record<string, string[]>
    }
    const globalExcludes = config.outputFileTracingExcludes?.['*'] ?? []

    for (const runtimeTracedRoot of ['docker/**', 'supabase/**']) {
      expect(globalExcludes).not.toContain(runtimeTracedRoot)
    }
  })

  it('ships the Next app and retained runtime game data', () => {
    const dockerfile = readFileSync(
      path.join(process.cwd(), 'docker', 'Dockerfile.prod'),
      'utf8'
    )

    expect(dockerfile).toContain('./node_modules/.bin/next build')
    expect(
      [...dockerfile.matchAll(/^ENV NODE_OPTIONS="([^"]+)"$/gmu)].map(
        (match) => match[1]
      )
    ).toEqual(['--max-old-space-size=12288', '--max-http-header-size=65536'])
    expect(dockerfile.indexOf('--max-old-space-size=12288')).toBeLessThan(
      dockerfile.indexOf('./node_modules/.bin/next build')
    )
    const builderStage = dockerfile
      .split('FROM base AS builder')[1]
      ?.split('FROM base AS runner')[0]
    expect(builderStage).toBeDefined()
    const builderIdentityArgIndex = builderStage!.search(
      /^ARG GITHUB_REPOSITORY$/mu
    )
    const builderIdentityEnvIndex = builderStage!.search(
      /^ENV GITHUB_REPOSITORY=\$GITHUB_REPOSITORY$/mu
    )
    const buildIdentityCheckIndex = builderStage!.search(
      /^RUN node scripts\/dev\/verify-app-identity\.mjs \\/mu
    )
    expect(builderIdentityArgIndex).toBeGreaterThan(-1)
    expect(builderIdentityEnvIndex).toBeGreaterThan(builderIdentityArgIndex)
    expect(buildIdentityCheckIndex).toBeGreaterThan(builderIdentityEnvIndex)
    expect(builderStage).not.toContain('ENV TACTICUS_APP_ID=tacticus-analytics')
    const buildWorkflow = readFileSync(
      path.join(process.cwd(), '.github', 'workflows', 'build-clean-image.yml'),
      'utf8'
    )
    expect(buildWorkflow).toMatch(
      /^\s+GITHUB_REPOSITORY=\$\{\{ github\.repository \}\}$/mu
    )
    expect(dockerfile).toContain('/app/.next ./.next')
    expect(dockerfile).toContain('/app/data/game-data ./data/game-data')
    expect(dockerfile).not.toContain(
      '/tmp/quarantined-runtime/modules/battle-sim-engine'
    )
    expect(dockerfile).not.toContain(
      '/tmp/quarantined-runtime/tools/replay-converter'
    )
    expect(dockerfile).not.toContain('BATTLE_SIM_WEB_SOURCE_COMMIT')
    for (const forbiddenCopy of [
      '/app/.dockerignore ./.dockerignore',
      '/app/.github ./.github',
      '/app/.planning/',
      '/app/app ./app',
      '/app/docker/Dockerfile.prod',
      '/tmp/quarantined-runtime/docs ./docs',
      '/tmp/quarantined-runtime/modules/battle-sim-engine',
      '/app/oracle ./oracle',
      '/tmp/quarantined-runtime/tests ./tests'
    ]) {
      expect(dockerfile).not.toContain(forbiddenCopy)
    }
    expect(dockerfile).toContain(
      'CMD ["sh", "-c", "APP_IDENTITY_RUNTIME=1 node scripts/dev/verify-app-identity.mjs && exec ./node_modules/.bin/next start"]'
    )
    expect(dockerfile).not.toContain('/app/.next/standalone')
  })

  it('keeps internal planning and removed feature evidence out of the Docker context', () => {
    const dockerignore = readFileSync(
      path.join(process.cwd(), '.dockerignore'),
      'utf8'
    )

    expect(dockerignore).not.toContain('!.planning/')
    expect(dockerignore).not.toContain('!docs/battle-sim/')
    expect(dockerignore).not.toContain('modules/battle-sim-engine')
    expect(dockerignore).not.toContain('data/battle-sim/')
    expect(dockerignore).not.toContain('battle-simulator')
    expect(dockerignore).not.toContain('replay-converter')
  })
})
