'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@tacticus/ui-kit'
import { Input } from '@tacticus/ui-kit'
import { Label } from '@tacticus/ui-kit'
import { useToast } from '@/app/hooks/useToast'
import { extractErrorMessage } from '@/app/lib/utils/error-message'
import {
  Hash,
  Users,
  Key,
  Mail,
  Building,
  ArrowRight,
  CheckCircle,
  AlertCircle,
  Loader2,
  Star,
  Globe
} from 'lucide-react'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('components.clusters.GuildJoinFlow')

interface ClusterInfo {
  cluster_code: string
  display_name: string
  max_guilds: number
}

interface ValidateInviteResponse {
  valid: boolean
  cluster?: ClusterInfo
  /** A bad code returns a string; a rejected request (401, 429) returns `{ error: { code, message } }`. */
  error?: unknown
}

interface JoinClusterResult {
  success: boolean
  action?: string
  cluster?: ClusterInfo
  error?: string
  [key: string]: unknown
}

interface GuildJoinFlowProps {
  initialInviteCode?: string
  onJoinSuccess?: (result: JoinClusterResult) => void
  onCancel?: () => void
}

export default function GuildJoinFlow({
  initialInviteCode,
  onJoinSuccess,
  onCancel
}: GuildJoinFlowProps) {
  const [step, setStep] = useState<'validate' | 'guild_info' | 'success'>(
    'validate'
  )
  const [loading, setLoading] = useState(false)
  const [inviteCode, setInviteCode] = useState(initialInviteCode || '')
  const [clusterInfo, setClusterInfo] = useState<ClusterInfo | null>(null)
  const [guildData, setGuildData] = useState({
    guildCode: '',
    displayName: '',
    leaderEmail: '',
    apiKey: '',
    tagline: '',
    description: '',
    logoUrl: ''
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const { toast } = useToast()

  const handleValidateCode = useCallback(async () => {
    if (!inviteCode.trim()) {
      setErrors({ inviteCode: 'Invite code is required' })
      return
    }

    setLoading(true)
    setErrors({})

    try {
      const response = await fetch(
        `/api/clusters/join?invite_code=${encodeURIComponent(inviteCode)}`
      )
      const result: ValidateInviteResponse = await response.json()

      // Only a rejected code has a string error; a rejected request's error object must
      // not reach state (React throws rendering it).
      if (!response.ok) {
        setErrors({
          inviteCode: extractErrorMessage(
            result,
            'Unable to validate the invite code. Please try again.'
          )
        })
        return
      }

      if (result.valid && result.cluster) {
        setClusterInfo(result.cluster)
        setStep('guild_info')
        logger.info(
          {
            inviteCode: inviteCode.substring(0, 3) + '***',
            clusterCode: result.cluster.cluster_code
          },
          'Invite code validated'
        )
      } else {
        setErrors({
          inviteCode: extractErrorMessage(result, 'Invalid invite code')
        })
      }
    } catch (error) {
      logger.error({ error }, 'Error validating invite code')
      setErrors({ inviteCode: 'Failed to validate invite code' })
    } finally {
      setLoading(false)
    }
  }, [inviteCode])

  useEffect(() => {
    if (initialInviteCode) {
      handleValidateCode()
    }
  }, [initialInviteCode, handleValidateCode])

  const handleJoinCluster = async () => {
    const newErrors: Record<string, string> = {}
    if (!guildData.guildCode) newErrors.guildCode = 'Guild code is required'
    if (!guildData.displayName)
      newErrors.displayName = 'Guild display name is required'
    if (
      guildData.leaderEmail &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guildData.leaderEmail)
    ) {
      newErrors.leaderEmail = 'Invalid email format'
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    setLoading(true)
    setErrors({})

    try {
      const response = await fetch('/api/clusters/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          inviteCode,
          guildData
        })
      })

      const result: JoinClusterResult = await response.json()

      if (response.ok && result.success) {
        setStep('success')
        toast.success(
          'Joined cluster',
          `${guildData.displayName} has joined ${clusterInfo?.display_name}`
        )
        logger.info(
          {
            guildCode: guildData.guildCode,
            clusterCode: clusterInfo?.cluster_code,
            action: result.action
          },
          'Guild joined cluster successfully'
        )

        if (onJoinSuccess) {
          onJoinSuccess(result)
        }
      } else {
        throw new Error(extractErrorMessage(result, 'Failed to join cluster'))
      }
    } catch (error) {
      logger.error({ error }, 'Error joining cluster')
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to join cluster'
      toast.error('Join Failed', errorMessage)
      setErrors({ general: errorMessage })
    } finally {
      setLoading(false)
    }
  }

  const renderValidateStep = () => (
    <div className="space-y-6">
      <div className="text-center">
        <div className="w-16 h-16 mx-auto bg-[color-mix(in_srgb,var(--primary)_20%,transparent)] rounded-full flex items-center justify-center mb-4">
          <Hash className="w-8 h-8 text-(--primary)" />
        </div>
        <h2 className="text-xl font-bold text-primary-wh40k mb-2">
          Join a Cluster
        </h2>
        <p className="text-secondary-wh40k">
          Enter your invite code to join an existing cluster
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label>Invite Code</Label>
          <Input
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
            placeholder="Enter your invite code"
            className="text-center text-lg font-mono"
            maxLength={20}
          />
          {errors.inviteCode && (
            <p className="text-red-400 text-sm mt-1 flex items-center gap-1">
              <AlertCircle className="w-4 h-4" />
              {errors.inviteCode}
            </p>
          )}
        </div>

        <Button
          onClick={handleValidateCode}
          disabled={loading || !inviteCode.trim()}
          className="w-full"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <ArrowRight className="w-4 h-4 mr-2" />
          )}
          {loading ? 'Validating...' : 'Validate Code'}
        </Button>
      </div>
    </div>
  )

  const renderGuildInfoStep = () => (
    <div className="space-y-6">
      {/* Cluster Info Header */}
      <div className="bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] rounded-lg p-4">
        <h2 className="text-lg font-semibold text-primary-wh40k mb-1 flex items-center gap-2">
          <Star className="w-5 h-5 text-(--primary)" />
          Joining: {clusterInfo?.display_name}
        </h2>
        <p className="text-sm text-secondary-wh40k">
          Cluster Code:{' '}
          <span className="font-mono">{clusterInfo?.cluster_code}</span> • Max
          Guilds: {clusterInfo?.max_guilds}
        </p>
      </div>

      <div>
        <h3 className="font-semibold text-primary-wh40k mb-4">
          Guild Information
        </h3>

        <div className="space-y-4">
          {/* Required Fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="flex items-center gap-1">
                <Building className="w-4 h-4" />
                Guild Code *
              </Label>
              <Input
                value={guildData.guildCode}
                onChange={(e) =>
                  setGuildData({
                    ...guildData,
                    guildCode: e.target.value.toUpperCase()
                  })
                }
                placeholder="YOUR_GUILD"
                maxLength={20}
              />
              {errors.guildCode && (
                <p className="text-red-400 text-sm mt-1">{errors.guildCode}</p>
              )}
            </div>

            <div>
              <Label className="flex items-center gap-1">
                <Users className="w-4 h-4" />
                Display Name *
              </Label>
              <Input
                value={guildData.displayName}
                onChange={(e) =>
                  setGuildData({
                    ...guildData,
                    displayName: e.target.value
                  })
                }
                placeholder="Your Guild Name"
              />
              {errors.displayName && (
                <p className="text-red-400 text-sm mt-1">
                  {errors.displayName}
                </p>
              )}
            </div>
          </div>

          {/* Optional Fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="flex items-center gap-1">
                <Mail className="w-4 h-4" />
                Leader Email
              </Label>
              <Input
                type="email"
                value={guildData.leaderEmail}
                onChange={(e) =>
                  setGuildData({
                    ...guildData,
                    leaderEmail: e.target.value
                  })
                }
                placeholder="leader@example.com"
              />
              {errors.leaderEmail && (
                <p className="text-red-400 text-sm mt-1">
                  {errors.leaderEmail}
                </p>
              )}
            </div>

            {process.env.NEXT_PUBLIC_RUNTIME_PROFILE !== 'desktop' && (
              <div>
                <Label className="flex items-center gap-1">
                  <Key className="w-4 h-4" />
                  API Key (Optional)
                </Label>
                <Input
                  type="password"
                  value={guildData.apiKey}
                  onChange={(e) =>
                    setGuildData({
                      ...guildData,
                      apiKey: e.target.value
                    })
                  }
                  placeholder="For immediate sync setup"
                />
                <p className="text-xs text-secondary-wh40k mt-1">
                  Provide to enable automatic data sync
                </p>
              </div>
            )}
          </div>

          {/* Additional Info */}
          <div>
            <Label>Guild Tagline</Label>
            <Input
              value={guildData.tagline}
              onChange={(e) =>
                setGuildData({
                  ...guildData,
                  tagline: e.target.value
                })
              }
              placeholder="A short tagline for your guild"
              maxLength={100}
            />
          </div>

          <div>
            <Label>Guild Description</Label>
            <textarea
              value={guildData.description}
              onChange={(e) =>
                setGuildData({
                  ...guildData,
                  description: e.target.value
                })
              }
              placeholder="Describe your guild..."
              className="w-full px-3 py-2 bg-(--bg-secondary) border border-(--card-border) rounded-sm h-20 resize-none"
              maxLength={500}
            />
          </div>

          <div>
            <Label className="flex items-center gap-1">
              <Globe className="w-4 h-4" />
              Logo URL
            </Label>
            <Input
              type="url"
              value={guildData.logoUrl}
              onChange={(e) =>
                setGuildData({
                  ...guildData,
                  logoUrl: e.target.value
                })
              }
              placeholder="https://example.com/logo.png"
            />
          </div>
        </div>
      </div>

      {/* Error Display */}
      {errors.general && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
          <p className="text-red-400 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {errors.general}
          </p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3">
        <Button
          onClick={() => setStep('validate')}
          variant="outline"
          className="flex-1"
        >
          Back
        </Button>
        <Button
          onClick={handleJoinCluster}
          disabled={loading}
          className="flex-1"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <CheckCircle className="w-4 h-4 mr-2" />
          )}
          {loading ? 'Joining...' : 'Join Cluster'}
        </Button>
      </div>
    </div>
  )

  const renderSuccessStep = () => (
    <div className="space-y-6 text-center">
      <div className="w-20 h-20 mx-auto bg-green-500/20 rounded-full flex items-center justify-center mb-4">
        <CheckCircle className="w-10 h-10 text-green-400" />
      </div>

      <div>
        <h2 className="text-xl font-bold text-primary-wh40k mb-2">
          Cluster joined
        </h2>
        <p className="text-secondary-wh40k mb-4">
          <strong>{guildData.displayName}</strong> has been added to{' '}
          <strong>{clusterInfo?.display_name}</strong>
        </p>
      </div>

      <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
        <h4 className="font-medium text-green-400 mb-2">What&#39;s Next?</h4>
        <ul className="text-sm text-secondary-wh40k space-y-1">
          <li>• Access cluster analytics and leaderboards</li>
          <li>• Coordinate with other guild leaders</li>
          <li>• View cross-guild performance metrics</li>
          {guildData.apiKey && <li>• Automatic data sync is now active</li>}
        </ul>
      </div>

      <div className="flex gap-3">
        <Button
          onClick={() => (window.location.href = '/dashboard')}
          variant="outline"
          className="flex-1"
        >
          Go to Dashboard
        </Button>
        <Button
          onClick={() =>
            (window.location.href = `/leaderboards?cluster=${clusterInfo?.cluster_code}`)
          }
          className="flex-1"
        >
          <Users className="w-4 h-4 mr-2" />
          View Cluster
        </Button>
      </div>
    </div>
  )

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-(--card-bg) border border-(--card-border) rounded-lg p-6">
        {step === 'validate' && renderValidateStep()}
        {step === 'guild_info' && renderGuildInfoStep()}
        {step === 'success' && renderSuccessStep()}

        {/* Cancel Option */}
        {onCancel && step !== 'success' && (
          <div className="mt-6 text-center">
            <Button onClick={onCancel} variant="ghost" size="sm">
              Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
