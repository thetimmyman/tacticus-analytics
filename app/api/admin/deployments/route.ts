import { NextRequest, NextResponse } from 'next/server'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { withAdminGuards } from '@/app/api/admin/_lib/with-admin-guards'
import path from 'path'
import fs from 'fs/promises'

/** Allowlist for values passed to deploy/rollback scripts. */
const VALID_SERVICES = new Set(['nextjs', 'nextjs-app', 'all'])

const VERSION_PATTERN = /^v?\d+\.\d+\.\d+(-[\w.]+)?$|^sha-[a-f0-9]{7,40}$/

function validateVersion(version: string): string {
  if (!VERSION_PATTERN.test(version)) {
    throw Errors.validation(
      `Invalid version format: "${version}". Expected semver (e.g. v1.2.3) or sha (e.g. sha-abc1234).`
    )
  }
  return version
}

function validateService(service: string): string {
  if (!VALID_SERVICES.has(service)) {
    throw Errors.validation(
      `Invalid service: "${service}". Must be one of: ${[...VALID_SERVICES].join(', ')}`
    )
  }
  return service
}

function validateKeepCount(value: unknown): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > 100) {
    throw Errors.validation(
      `Invalid keepCount: "${value}". Must be an integer between 1 and 100.`
    )
  }
  return n
}

const isSelfHosted =
  process.env.DEPLOYMENT_MODE === 'self-hosted' ||
  process.env.NEXT_PUBLIC_DEPLOYMENT === 'self-hosted'

// Guard first so non-admins get 401/403, not a 400 that leaks whether this is self-hosted.
const DEPLOYMENT_ADMIN_GUARD = {
  guard: 'app-admin-session',
  unauthorizedMessage: 'Unauthorized',
  deniedMessage: 'Admin access required'
} as const

export const GET = withAdminGuards(DEPLOYMENT_ADMIN_GUARD, async () => {
  if (!isSelfHosted) {
    throw Errors.validation(
      'Version management only available on self-hosted deployment'
    )
  }

  try {
    const versionFile = path.join(process.cwd(), 'version.json')
    let currentVersion = { version: 'unknown', buildNumber: 0, lastUpdated: '' }

    try {
      const versionContent = await fs.readFile(versionFile, 'utf-8')
      currentVersion = JSON.parse(versionContent)
    } catch {
      // No version.json.
    }

    return NextResponse.json({
      current: currentVersion,
      services: [],
      selfHosted: true,
      managementAvailable: false,
      guidance:
        'Deployment management moved to the k3s/GHCR runbook. Use scripts/deploy/deploy-production-k3s.sh with an immutable image tag.',
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    rethrowIfAppError(error)
    console.error('Error getting versions:', error)
    throw Errors.internal('Failed to get version information', {
      details: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

export const POST = withAdminGuards(
  DEPLOYMENT_ADMIN_GUARD,
  async (request: NextRequest) => {
    if (!isSelfHosted) {
      throw Errors.validation(
        'Version management only available on self-hosted deployment'
      )
    }

    try {
      const body = await request.json()
      const { action, version, service } = body

      switch (action) {
        case 'rollback':
          if (version) {
            validateVersion(version)
          } else {
            // Native rollback uses deployment history.
          }
          if (service && service !== 'all') {
            validateService(service)
          }
          break

        case 'list':
          break

        case 'cleanup': {
          validateKeepCount(body.keepCount ?? 12)
          break
        }

        default:
          throw Errors.validation(`Unknown action: ${action}`)
      }

      return NextResponse.json(
        {
          success: false,
          action,
          message:
            'Admin deployment actions are disabled. Use the k3s/GHCR deployment runbook and validate all Next.js worker deployments after rollback.',
          timestamp: new Date().toISOString()
        },
        { status: 501 }
      )
    } catch (error) {
      rethrowIfAppError(error)
      console.error('Deployment action failed:', error)
      throw Errors.internal('Deployment action failed', {
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }
)
