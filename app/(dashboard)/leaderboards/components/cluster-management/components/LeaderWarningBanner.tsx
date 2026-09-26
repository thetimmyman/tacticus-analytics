'use client'

import { Shield, AlertCircle } from 'lucide-react'

export function LeaderWarningBanner() {
  return (
    <div className="bg-red-900/30 border-2 border-[var(--accent)] rounded-lg p-4">
      <div className="flex items-start gap-3">
        <Shield className="w-6 h-6 text-[var(--accent)] mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-bold text-[var(--accent)] mb-2 text-lg">
            Cluster Leader Management
          </p>
          <p className="text-red-200 text-sm mb-2">
            These full cluster-management controls are restricted to cluster
            leaders.
          </p>
          <div className="bg-yellow-900/30 border border-yellow-600/50 rounded p-3 mt-2">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-[var(--primary)] mt-0.5 flex-shrink-0" />
              <div className="text-sm text-yellow-200">
                <p className="font-semibold mb-1">
                  Critical Administrative Area
                </p>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>Changes affect the ENTIRE cluster</li>
                  <li>
                    Modifying guild configurations impacts all users immediately
                  </li>
                  <li>
                    Disabling a guild removes their access to the dashboard
                  </li>
                  <li>API key changes affect data synchronization</li>
                  <li>All actions are logged for security purposes</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
