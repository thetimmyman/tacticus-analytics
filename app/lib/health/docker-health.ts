import { addInfrastructureAlert } from '@tacticus/app-core/daily-alert-summary'
import * as fs from 'fs'
import * as http from 'http'

interface ContainerStats {
  id: string
  name: string
  status: string
  state: string
  restartCount: number
  oomKilled: boolean
  health?: {
    status: string
    failingStreak: number
  }
}

interface DockerHealthResult {
  available: boolean
  containers: ContainerStats[]
  unhealthyCount: number
  recentRestarts: number
  error?: string
}

const DOCKER_SOCKET = '/var/run/docker.sock'

function isDockerAvailable(): boolean {
  try {
    return fs.existsSync(DOCKER_SOCKET)
  } catch {
    return false
  }
}

function dockerRequest(path: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const options = {
      socketPath: DOCKER_SOCKET,
      path,
      method: 'GET'
    }

    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch {
          reject(new Error('Failed to parse Docker response'))
        }
      })
    })

    req.on('error', reject)
    req.setTimeout(5000, () => {
      req.destroy()
      reject(new Error('Docker request timeout'))
    })
    req.end()
  })
}

export async function checkDockerHealth(
  emitAlerts = true
): Promise<DockerHealthResult> {
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return {
      available: false,
      containers: [],
      unhealthyCount: 0,
      recentRestarts: 0,
      error: 'Serverless environment - Docker not applicable'
    }
  }

  if (!isDockerAvailable()) {
    return {
      available: false,
      containers: [],
      unhealthyCount: 0,
      recentRestarts: 0,
      error: 'Docker socket not available'
    }
  }

  try {
    const containersData = (await dockerRequest(
      '/containers/json?all=true'
    )) as Array<{
      Id: string
      Names: string[]
      State: string
      Status: string
    }>

    const containers: ContainerStats[] = []
    let unhealthyCount = 0
    let recentRestarts = 0

    for (const container of containersData) {
      const inspectData = (await dockerRequest(
        `/containers/${container.Id}/json`
      )) as {
        Id: string
        Name: string
        State: {
          Status: string
          Running: boolean
          OOMKilled: boolean
          Health?: {
            Status: string
            FailingStreak: number
          }
        }
        RestartCount: number
      }

      const stats: ContainerStats = {
        id: container.Id.substring(0, 12),
        name: inspectData.Name.replace(/^\//, ''),
        status: container.Status,
        state: inspectData.State.Status,
        restartCount: inspectData.RestartCount,
        oomKilled: inspectData.State.OOMKilled,
        health: inspectData.State.Health
          ? {
              status: inspectData.State.Health.Status,
              failingStreak: inspectData.State.Health.FailingStreak
            }
          : undefined
      }

      containers.push(stats)

      if (stats.health?.status === 'unhealthy') {
        unhealthyCount++
      }

      if (stats.restartCount > 0) {
        recentRestarts += stats.restartCount
      }

      if (emitAlerts && stats.oomKilled) {
        addInfrastructureAlert(
          'Container OOM Killed',
          `Container ${stats.name} was killed due to out of memory`,
          'critical',
          {
            container: stats.name,
            containerId: stats.id
          }
        )
      }
    }

    if (emitAlerts && unhealthyCount > 0) {
      const unhealthyNames = containers
        .filter((c) => c.health?.status === 'unhealthy')
        .map((c) => c.name)

      addInfrastructureAlert(
        'Unhealthy Docker Containers',
        `${unhealthyCount} container(s) are unhealthy: ${unhealthyNames.join(', ')}`,
        'error',
        {
          unhealthyCount,
          containers: unhealthyNames
        }
      )
    }

    if (emitAlerts && recentRestarts >= 5) {
      const highRestartContainers = containers
        .filter((c) => c.restartCount >= 2)
        .map((c) => `${c.name} (${c.restartCount})`)

      addInfrastructureAlert(
        'Container Restart Issues',
        `Containers have restarted ${recentRestarts} times total`,
        recentRestarts >= 10 ? 'error' : 'warning',
        {
          totalRestarts: recentRestarts,
          containers: highRestartContainers
        }
      )
    }

    return {
      available: true,
      containers,
      unhealthyCount,
      recentRestarts
    }
  } catch (error) {
    return {
      available: false,
      containers: [],
      unhealthyCount: 0,
      recentRestarts: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

export async function runDockerHealthChecks(
  options: { emitAlerts?: boolean } = {}
): Promise<DockerHealthResult> {
  return await checkDockerHealth(options.emitAlerts ?? true)
}
