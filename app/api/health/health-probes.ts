import { exec, execFile } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

export type CheckResult = {
  status: 'pass' | 'fail'
  responseTime?: number
  details: Record<string, unknown>
}

type RpcArrayProbeResult = {
  probe: string
  status: 'pass' | 'fail'
  responseTime: number
  statusCode: number | null
  rowCount: number | null
  validBody: boolean
  error?: string
}

function execResultOutput(result: unknown): { stdout: string; stderr: string } {
  if (typeof result === 'string') return { stdout: result, stderr: '' }
  if (result && typeof result === 'object') {
    const output = result as { stdout?: unknown; stderr?: unknown }
    return {
      stdout:
        typeof output.stdout === 'string'
          ? output.stdout
          : String(output.stdout ?? ''),
      stderr:
        typeof output.stderr === 'string'
          ? output.stderr
          : String(output.stderr ?? '')
    }
  }
  return { stdout: '', stderr: '' }
}

export async function execFileResultOutput(
  file: string,
  args: string[],
  timeout: number
): Promise<{ stdout: string; stderr: string }> {
  try {
    return execResultOutput(await execFileAsync(file, args, { timeout }))
  } catch (error) {
    const output = execResultOutput(error)
    if (!output.stdout && !output.stderr) throw error
    return output
  }
}

// Accepts `HTTP/1.1 200 OK` (GNU/BusyBox wget) and wget2's h2 forms.
export function latestHttpStatus(output: unknown): number | null {
  const text = typeof output === 'string' ? output : String(output ?? '')
  // No line anchors: stdout + stderr concatenation can glue a JSON body onto a header line.
  const matches = [
    ...text.matchAll(
      /(?:HTTP\/[0-9.]+\s+|:status:\s+|HTTP(?: ERROR)? response\s+)(\d{3})/g
    )
  ]
  const last = matches[matches.length - 1]
  if (!last?.[1]) return null
  const parsed = Number(last[1])
  return Number.isFinite(parsed) ? parsed : null
}

export function jsonArrayLength(value: unknown): number | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  const arrayStart = trimmed.indexOf('[')
  if (arrayStart === -1) return null
  try {
    const parsed = JSON.parse(trimmed.slice(arrayStart))
    return Array.isArray(parsed) ? parsed.length : null
  } catch {
    return null
  }
}

export function getSupabaseKongUrl(): string {
  return (
    process.env.SUPABASE_INTERNAL_URL ||
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    'http://supabase-kong:8000'
  )
}

export async function getDockerContainerStatus(): Promise<
  Record<string, string>
> {
  try {
    const { stdout } = await execAsync(
      'docker ps --format "{{.Names}}:{{.Status}}" 2>/dev/null || echo ""',
      { timeout: 5000 }
    )
    const containers: Record<string, string> = {}
    stdout
      .split('\n')
      .filter(Boolean)
      .forEach((line) => {
        const [name, status] = line.split(':')
        if (name && status) {
          containers[name] = status.includes('Up') ? 'running' : 'stopped'
        }
      })
    return containers
  } catch {
    return {}
  }
}

export async function getDiskSpace(): Promise<{
  used: string
  available: string
  percent: string
} | null> {
  try {
    const { stdout } = await execAsync(
      'df -h / 2>/dev/null | tail -1 | awk \'{print $3","$4","$5}\' || echo ""',
      { timeout: 5000 }
    )
    const [used, available, percent] = stdout.trim().split(',')
    if (used && available && percent) {
      return { used, available, percent }
    }
    return null
  } catch {
    return null
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout
  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(fallback), timeoutMs)
  })
  try {
    const result = await Promise.race([promise, timeoutPromise])
    clearTimeout(timeoutHandle!)
    return result
  } catch {
    clearTimeout(timeoutHandle!)
    return fallback
  }
}

async function runPostgrestArrayRpcProbe({
  kongUrl,
  anonKey,
  rpcName,
  probe,
  body
}: {
  kongUrl: string
  anonKey: string
  rpcName: string
  probe: string
  body: Record<string, unknown>
}): Promise<RpcArrayProbeResult> {
  const start = Date.now()
  const endpoint = `${kongUrl}/rest/v1/rpc/${rpcName}`
  try {
    const { stdout, stderr } = await execFileResultOutput(
      'wget',
      [
        '-S',
        '-O',
        '-',
        '--timeout=3',
        `--header=apikey: ${anonKey}`,
        `--header=Authorization: Bearer ${anonKey}`,
        '--header=Content-Type: application/json',
        `--post-data=${JSON.stringify(body)}`,
        endpoint
      ],
      4000
    )
    const output = stdout + stderr
    const statusCode = latestHttpStatus(output)
    const rowCount = jsonArrayLength(stdout)
    const validBody = rowCount !== null
    const passed =
      statusCode !== null && statusCode >= 200 && statusCode < 300 && validBody

    return {
      status: passed ? 'pass' : 'fail',
      responseTime: Date.now() - start,
      probe,
      statusCode,
      rowCount,
      validBody
    }
  } catch (error: unknown) {
    const withOutput = error as {
      stdout?: string
      stderr?: string
      message?: string
    }
    const output = `${withOutput.stdout ?? ''}${withOutput.stderr ?? ''}`
    const statusCode = latestHttpStatus(output)
    const rowCount = jsonArrayLength(withOutput.stdout)

    return {
      status: 'fail',
      responseTime: Date.now() - start,
      probe,
      statusCode,
      rowCount,
      validBody: rowCount !== null,
      error: withOutput.message ?? `${probe} failed`
    }
  }
}

export async function checkMetricsDataLayer(
  kongUrl: string
): Promise<CheckResult> {
  const start = Date.now()
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY

  if (!anonKey) {
    return {
      status: 'fail',
      responseTime: Date.now() - start,
      details: {
        provider: 'rpc-dashboard-calculations',
        probes: [],
        error: 'Missing NEXT_PUBLIC_SUPABASE_ANON_KEY'
      }
    }
  }

  // Data-free RPC so the anon path is checked independently of data grants; a data-reading RPC would
  // make revoked anon EXECUTE a permanent false 'degraded'.
  const probes = await Promise.all([
    runPostgrestArrayRpcProbe({
      kongUrl,
      anonKey,
      rpcName: 'postgrest_anon_probe',
      probe: 'postgrest-rpc:postgrest_anon_probe',
      body: {}
    })
  ])
  const failedProbe = probes.find((probe) => probe.status === 'fail')

  return {
    status: failedProbe ? 'fail' : 'pass',
    responseTime: Date.now() - start,
    details: {
      provider: 'rpc-dashboard-calculations',
      probes,
      failedProbe: failedProbe?.probe ?? null,
      exercised: 'rpc-execution'
    }
  }
}

export async function checkAuthDependency(
  kongUrl: string
): Promise<CheckResult> {
  const start = Date.now()
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY

  if (!anonKey) {
    return {
      status: 'fail',
      responseTime: Date.now() - start,
      details: {
        provider: 'supabase-auth',
        probe: 'kong-auth-health',
        error: 'Missing NEXT_PUBLIC_SUPABASE_ANON_KEY'
      }
    }
  }

  const endpoint = `${kongUrl}/auth/v1/health`
  try {
    const { stdout, stderr } = await execFileResultOutput(
      'wget',
      [
        '-S',
        '-O',
        '-',
        '--timeout=3',
        `--header=apikey: ${anonKey}`,
        `--header=Authorization: Bearer ${anonKey}`,
        endpoint
      ],
      4000
    )
    const output = stdout + stderr
    const statusCode = latestHttpStatus(output)
    const passed = statusCode !== null && statusCode >= 200 && statusCode < 300

    return {
      status: passed ? 'pass' : 'fail',
      responseTime: Date.now() - start,
      details: {
        provider: 'supabase-auth',
        probe: 'kong-auth-health',
        statusCode
      }
    }
  } catch (error: unknown) {
    const withOutput = error as {
      stdout?: string
      stderr?: string
      message?: string
    }
    const output = `${withOutput.stdout ?? ''}${withOutput.stderr ?? ''}`
    const statusCode = latestHttpStatus(output)

    return {
      status: 'fail',
      responseTime: Date.now() - start,
      details: {
        provider: 'supabase-auth',
        probe: 'kong-auth-health',
        statusCode,
        error: withOutput.message ?? 'Auth health probe failed'
      }
    }
  }
}
