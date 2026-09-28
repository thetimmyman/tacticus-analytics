'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { DataTable, type DataTableColumn } from '@tacticus/ui-kit'
import {
  ArrowLeft,
  RefreshCw,
  RotateCcw,
  Trash,
  Server,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Terminal
} from 'lucide-react'

interface VersionInfo {
  tag: string
  created: string
  size: string
  isCurrent: boolean
}

interface ServiceVersions {
  service: string
  running: string
  versions: VersionInfo[]
}

interface DeploymentData {
  current: {
    version: string
    buildNumber: number
    lastUpdated: string
  }
  services: ServiceVersions[]
  selfHosted: boolean
  timestamp: string
}

interface ActionResult {
  success: boolean
  action: string
  output: string
  stderr?: string
  error?: string
}

export function DeploymentManager() {
  const [data, setData] = useState<DeploymentData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionResult, setActionResult] = useState<ActionResult | null>(null)
  const [selectedService, setSelectedService] = useState<string>('all')

  const fetchVersions = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await fetch('/api/admin/deployments')
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Failed to fetch versions')
      }
      const result = await response.json()
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchVersions()
  }, [fetchVersions])

  const executeAction = async (
    action: string,
    params: Record<string, unknown> = {}
  ) => {
    try {
      setActionLoading(true)
      setActionResult(null)

      const response = await fetch('/api/admin/deployments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...params })
      })

      const result = await response.json()

      if (!response.ok) {
        setActionResult({
          success: false,
          action,
          output: '',
          error: result.error || 'Action failed'
        })
      } else {
        setActionResult(result)
        await fetchVersions()
      }
    } catch (err) {
      setActionResult({
        success: false,
        action,
        output: '',
        error: err instanceof Error ? err.message : 'Unknown error'
      })
    } finally {
      setActionLoading(false)
    }
  }

  const handleRollback = (version?: string) => {
    const confirmMsg = version
      ? `Are you sure you want to rollback to version ${version}?`
      : 'Are you sure you want to rollback to the previous version?'

    if (confirm(confirmMsg)) {
      executeAction('rollback', {
        version,
        service: selectedService
      })
    }
  }

  const handleCleanup = () => {
    if (confirm('This will remove old container versions. Continue?')) {
      executeAction('cleanup', { keepCount: 12 })
    }
  }

  // Images keep API order; cells set text colour because DataTable's `<td>` forces text-secondary.
  const versionColumns = useMemo<DataTableColumn<VersionInfo>[]>(
    () => [
      {
        key: 'version',
        header: 'Version',
        sortable: false,
        render: (version) => (
          <>
            <span className="font-mono text-white">{version.tag}</span>
            {version.isCurrent && (
              <span className="ml-2 px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-sm">
                CURRENT
              </span>
            )}
          </>
        )
      },
      {
        key: 'created',
        header: 'Created',
        sortable: false,
        render: (version) => (
          <span className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            {version.created}
          </span>
        )
      },
      {
        key: 'size',
        header: 'Size',
        sortable: false,
        render: (version) => version.size
      },
      {
        key: 'actions',
        header: 'Actions',
        sortable: false,
        align: 'right',
        render: (version) =>
          version.isCurrent ? null : (
            <button
              onClick={() => handleRollback(version.tag)}
              disabled={actionLoading}
              className="px-3 py-1 bg-yellow-600/20 hover:bg-yellow-600/40 text-yellow-400 rounded-sm text-sm disabled:opacity-50"
            >
              Rollback
            </button>
          )
      }
    ],
    // `handleRollback` closes over `selectedService`, so both belong here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [actionLoading, selectedService]
  )

  if (!data?.selfHosted && !loading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-6 text-center">
          <AlertTriangle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-yellow-400 mb-2">
            Not Available
          </h2>
          <p className="text-secondary-wh40k">
            Deployment management is only available on self-hosted instances.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/admin/feature-releases"
            className="text-secondary-wh40k hover:text-white flex items-center gap-2 mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Admin
          </Link>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Server className="h-6 w-6 text-blue-400" />
            Deployment Manager
          </h1>
          <p className="text-secondary-wh40k mt-1">
            Manage container versions and perform rollbacks
          </p>
        </div>

        <button
          onClick={() => fetchVersions()}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-(--card-bg) hover:bg-zinc-700 rounded-lg text-white disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-center gap-3">
          <XCircle className="h-5 w-5 text-red-500" />
          <span className="text-red-400">{error}</span>
        </div>
      )}

      {/* Current Version Card */}
      {data && (
        <div className="bg-(--card-bg) border border-(--card-border) rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-4">
            Current Deployment
          </h2>
          <div className="grid grid-cols-3 gap-6">
            <div>
              <div className="text-secondary-wh40k text-sm">Version</div>
              <div className="text-2xl font-mono text-green-400">
                v{data.current.version}
              </div>
            </div>
            <div>
              <div className="text-secondary-wh40k text-sm">Build Number</div>
              <div className="text-2xl font-mono text-white">
                #{data.current.buildNumber}
              </div>
            </div>
            <div>
              <div className="text-secondary-wh40k text-sm">Last Updated</div>
              <div className="text-lg text-white">
                {data.current.lastUpdated}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Service Filter */}
      <div className="flex items-center gap-4">
        <span className="text-secondary-wh40k">Service:</span>
        <select
          value={selectedService}
          onChange={(e) => setSelectedService(e.target.value)}
          className="bg-(--card-bg) border border-(--card-border) rounded-lg px-3 py-2 text-white"
        >
          <option value="all">All Services</option>
          <option value="nextjs">NextJS App</option>
        </select>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-4">
        <button
          onClick={() => handleRollback()}
          disabled={actionLoading}
          className="flex items-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-500 rounded-lg text-white disabled:opacity-50"
        >
          <RotateCcw className="h-4 w-4" />
          Rollback to Previous
        </button>

        <button
          onClick={handleCleanup}
          disabled={actionLoading}
          className="flex items-center gap-2 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-white disabled:opacity-50"
        >
          <Trash className="h-4 w-4" />
          Cleanup Old Versions
        </button>
      </div>

      {/* Action Result */}
      {actionResult && (
        <div
          className={`border rounded-lg p-4 ${
            actionResult.success
              ? 'bg-green-500/10 border-green-500/20'
              : 'bg-red-500/10 border-red-500/20'
          }`}
        >
          <div className="flex items-center gap-2 mb-2">
            {actionResult.success ? (
              <CheckCircle className="h-5 w-5 text-green-500" />
            ) : (
              <XCircle className="h-5 w-5 text-red-500" />
            )}
            <span
              className={
                actionResult.success ? 'text-green-400' : 'text-red-400'
              }
            >
              {actionResult.success ? 'Action completed' : 'Action failed'}
            </span>
          </div>
          {actionResult.output && (
            <pre className="bg-black/50 rounded-sm p-3 text-xs text-primary-wh40k overflow-x-auto max-h-64">
              {actionResult.output}
            </pre>
          )}
          {actionResult.error && (
            <p className="text-red-400 text-sm mt-2">{actionResult.error}</p>
          )}
        </div>
      )}

      {/* Version Tables */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-8 w-8 text-secondary-wh40k animate-spin" />
        </div>
      ) : (
        data?.services && (
          <div className="space-y-6">
            {data.services.map((service) => (
              <div
                key={service.service}
                className="bg-(--card-bg) border border-(--card-border) rounded-lg overflow-hidden"
              >
                <div className="bg-(--card-bg) px-6 py-3 flex items-center justify-between">
                  <h3 className="font-semibold text-white flex items-center gap-2">
                    <Terminal className="h-4 w-4 text-blue-400" />
                    {service.service}
                  </h3>
                  <span className="text-sm text-secondary-wh40k">
                    Running:{' '}
                    <span className="text-green-400 font-mono">
                      {service.running}
                    </span>
                  </span>
                </div>

                {service.versions.length === 0 ? (
                  <div className="p-6 text-center text-secondary-wh40k">
                    No versioned images found. Deploy using the versioning
                    script to enable rollbacks.
                  </div>
                ) : (
                  <DataTable
                    rows={service.versions}
                    columns={versionColumns}
                    rowKey={(version) => version.tag}
                    rowClassName={(version) =>
                      // !bg: the current-version tint must survive DataTable's row hover.
                      version.isCurrent ? 'bg-green-500/5!' : undefined
                    }
                    tableClassName="w-full"
                  />
                )}
              </div>
            ))}
          </div>
        )
      )}

      {/* CLI Instructions */}
      <div className="bg-(--card-bg) border border-(--card-border) rounded-lg p-6">
        <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
          <Terminal className="h-4 w-4 text-secondary-wh40k" />
          CLI Commands (SSH Fallback)
        </h3>
        <p className="text-secondary-wh40k text-sm mb-4">
          If the web UI is unavailable, use these commands via SSH:
        </p>
        <div className="bg-black rounded-lg p-4 font-mono text-sm space-y-2">
          <div className="text-secondary-wh40k"># Current k3s deploy path</div>
          <div className="text-green-400">
            ./scripts/deploy/deploy-production-k3s.sh --tag &lt;sha&gt;
            --skip-build
          </div>
          <div className="text-secondary-wh40k mt-3">
            # Roll back k3s Next.js workloads
          </div>
          <div className="text-green-400">
            kubectl -n tacticus rollout undo deployment/nextjs-web
            deployment/workers-sync deployment/workers-hooks
            deployment/workers-batch
          </div>
        </div>
      </div>
    </div>
  )
}
