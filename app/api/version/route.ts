import { NextResponse } from 'next/server'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import versionData from '@/version.json'

interface AppVersionData {
  version?: string
  refreshRequiredToken?: string | null
}

// BUILD_ID is stable across restarts and changes only on rebuild.
function getNextBuildId(): string {
  try {
    const buildIdPath = join(process.cwd(), '.next', 'BUILD_ID')
    if (existsSync(buildIdPath)) {
      return readFileSync(buildIdPath, 'utf-8').trim()
    }
  } catch {
    // Fall through to fallbacks.
  }
  return process.env.NEXT_BUILD_ID || 'unknown'
}

function getRefreshRequiredToken(): string | null {
  const token = (versionData as AppVersionData).refreshRequiredToken
  if (typeof token !== 'string') {
    return null
  }

  const normalizedToken = token.trim()
  return normalizedToken.length > 0 ? normalizedToken : null
}

const BUILD_ID = getNextBuildId()
const BUILD_TIME = process.env.BUILD_TIME || new Date().toISOString()
const APP_VERSION =
  (versionData as AppVersionData).version ||
  process.env.npm_package_version ||
  '1.0.0'
const REFRESH_REQUIRED_TOKEN = getRefreshRequiredToken()

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Polled for deploys; clients prompt a refresh only when refreshRequiredToken advances. */
export async function GET() {
  return NextResponse.json(
    {
      buildId: BUILD_ID,
      buildTime: BUILD_TIME,
      version: APP_VERSION,
      refreshRequiredToken: REFRESH_REQUIRED_TOKEN
    },
    {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0'
      }
    }
  )
}
