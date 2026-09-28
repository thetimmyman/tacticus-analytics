'use client'

import { Button } from '@tacticus/ui-kit'
import { Input } from '@tacticus/ui-kit'
import { Label } from '@tacticus/ui-kit'
import { Save, Settings, Sliders } from 'lucide-react'
import type { ClusterConfig } from '../types'

interface ClusterConfigSectionProps {
  clusterConfig: ClusterConfig
  expanded: boolean
  savingClusterConfig: boolean
  errorMessage: string
  successMessage: string
  onConfigChange: (config: ClusterConfig) => void
  onExpandedChange: (expanded: boolean) => void
  onSave: () => void
}

export function ClusterConfigSection({
  clusterConfig,
  expanded,
  savingClusterConfig,
  errorMessage,
  successMessage,
  onConfigChange,
  onExpandedChange,
  onSave
}: ClusterConfigSectionProps) {
  return (
    <div className="mt-8 space-y-6">
      <div className="bg-(--card-bg) border border-(--card-border) rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Sliders className="w-6 h-6 text-(--primary)" />
            <div>
              <h3 className="text-xl font-bold text-primary-wh40k">
                Cluster Requirements
              </h3>
              <p className="text-sm text-secondary-wh40k">
                Configure player level requirements and rejection settings
              </p>
            </div>
          </div>
          <Button
            onClick={() => onExpandedChange(!expanded)}
            variant="ghost"
            size="sm"
            className="text-secondary-wh40k hover:text-primary-wh40k"
          >
            <Settings className="w-4 h-4 mr-2" />
            {expanded ? 'Hide' : 'Configure'}
          </Button>
        </div>

        {expanded && (
          <div className="space-y-6 border-t border-(--card-border) pt-4">
            <div className="space-y-4">
              <div>
                <Label className="text-primary-wh40k font-medium">
                  Minimum Player Level
                </Label>
                <p className="text-sm text-secondary-wh40k mt-1">
                  Players below this level will be automatically rejected with a
                  customizable message
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="1"
                    max="100"
                    value={clusterConfig.minimum_player_level}
                    onChange={(e) =>
                      onConfigChange({
                        ...clusterConfig,
                        minimum_player_level: parseInt(e.target.value)
                      })
                    }
                    className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                    style={{
                      background: `linear-gradient(to right, var(--primary) 0%, var(--primary) ${clusterConfig.minimum_player_level}%, #374151 ${clusterConfig.minimum_player_level}%, #374151 100%)`
                    }}
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold text-(--primary) min-w-12 text-center">
                      {clusterConfig.minimum_player_level}
                    </span>
                    <Input
                      type="number"
                      min="1"
                      max="100"
                      value={clusterConfig.minimum_player_level}
                      onChange={(e) =>
                        onConfigChange({
                          ...clusterConfig,
                          minimum_player_level: Math.max(
                            1,
                            Math.min(100, parseInt(e.target.value) || 1)
                          )
                        })
                      }
                      className="w-16 text-center"
                    />
                  </div>
                </div>

                <div className="flex justify-between text-xs text-secondary-wh40k">
                  <span>Level 1 (No requirement)</span>
                  <span>Level 100 (Maximum)</span>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <Label className="text-primary-wh40k font-medium">
                  Rejection Message Template
                </Label>
                <p className="text-sm text-secondary-wh40k mt-1">
                  Message sent to players who don&apos;t meet the level
                  requirement. Use {'{level}'} as a placeholder for the minimum
                  level.
                </p>
              </div>

              <textarea
                value={clusterConfig.rejection_message}
                onChange={(e) =>
                  onConfigChange({
                    ...clusterConfig,
                    rejection_message: e.target.value
                  })
                }
                className="w-full h-24 px-3 py-2 bg-(--bg-secondary) border border-(--card-border) rounded-lg text-primary-wh40k resize-none focus:outline-hidden focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_50%,transparent)]"
                placeholder="Enter custom rejection message..."
              />

              <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-3">
                <p className="text-xs text-blue-300 font-medium mb-2">
                  Preview:
                </p>
                <p className="text-xs text-blue-200 leading-relaxed">
                  {clusterConfig.rejection_message.replace(
                    '{level}',
                    clusterConfig.minimum_player_level.toString()
                  )}
                </p>
              </div>
            </div>

            <div className="pt-4 border-t border-(--card-border)">
              {errorMessage && (
                <div className="mb-4 p-3 bg-red-900/20 border border-red-600/30 rounded-lg text-red-400 text-sm">
                  {errorMessage}
                </div>
              )}
              {successMessage && (
                <div className="mb-4 p-3 bg-green-900/20 border border-green-600/30 rounded-lg text-green-400 text-sm">
                  {successMessage}
                </div>
              )}

              <div className="flex justify-end">
                <Button
                  onClick={onSave}
                  disabled={savingClusterConfig}
                  className="bg-primary-wh40k hover:bg-[color-mix(in_srgb,var(--primary)_90%,transparent)] text-white flex items-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  {savingClusterConfig ? 'Saving...' : 'Save Configuration'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
