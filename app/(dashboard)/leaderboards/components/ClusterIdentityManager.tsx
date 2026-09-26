'use client'

import { useState, useEffect } from 'react'
import { dbClient } from '@/app/lib/db/client'
import { Button } from '@tacticus/ui-kit'
import { Input } from '@tacticus/ui-kit'
import { Label } from '@tacticus/ui-kit'
import { Skeleton } from '@tacticus/ui-kit/loading'
import { Save, X, Globe, Flag } from 'lucide-react'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger(
  'leaderboards.components.ClusterIdentityManager'
)
import { useToast } from '@/app/hooks/useToast'

interface ClusterIdentity {
  id: string
  cluster_code: string
  display_name: string
  short_name: string
  tagline: string
  description: string
  logo_url: string | null
  banner_url: string | null
  primary_color: string
  secondary_color: string
  accent_color: string
  discord_server_id: string | null
  discord_invite_url: string | null
  website_url: string | null
  time_zone: string
  primary_language: string
  public_notes: string | null
  cluster_stats: {
    founding_guilds?: string[]
    [key: string]: unknown
  } | null
  feature_flags: Record<string, boolean> | null
}

interface ClusterIdentityManagerProps {
  clusterCode: string
  isAdmin: boolean
}

export default function ClusterIdentityManager({
  clusterCode,
  isAdmin
}: ClusterIdentityManagerProps) {
  const { toast } = useToast()
  const supabase = dbClient()
  const [identity, setIdentity] = useState<ClusterIdentity | null>(null)
  const [editedIdentity, setEditedIdentity] = useState<ClusterIdentity | null>(
    null
  )
  const [isEditing, setIsEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchClusterIdentity()
  }, [clusterCode]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchClusterIdentity = async () => {
    try {
      // Probe whether the clusters table exists.
      const { data, error } = await supabase
        .from('clusters')
        .select('*')
        .eq('cluster_code', clusterCode)
        .single()

      if (error || !data) {
        // Table missing or empty.
        setIdentity(null)
      } else {
        const clusterIdentity = data as ClusterIdentity
        setIdentity(clusterIdentity)
        setEditedIdentity(clusterIdentity)
      }
    } catch (error) {
      logger.error({ err: error }, 'Error fetching cluster identity:')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!editedIdentity || !identity) return

    setSaving(true)
    try {
      const updates = {
        display_name: editedIdentity.display_name,
        short_name: editedIdentity.short_name,
        tagline: editedIdentity.tagline,
        description: editedIdentity.description,
        logo_url: editedIdentity.logo_url,
        banner_url: editedIdentity.banner_url,
        primary_color: editedIdentity.primary_color,
        secondary_color: editedIdentity.secondary_color,
        accent_color: editedIdentity.accent_color,
        discord_server_id: editedIdentity.discord_server_id,
        discord_invite_url: editedIdentity.discord_invite_url,
        website_url: editedIdentity.website_url,
        time_zone: editedIdentity.time_zone,
        primary_language: editedIdentity.primary_language,
        public_notes: editedIdentity.public_notes
      }

      const { error } = await supabase.rpc('update_cluster_identity', {
        p_cluster_id: identity.id,
        p_updates: updates
      })

      if (error) throw error

      setIdentity(editedIdentity)
      setIsEditing(false)
      toast.success(
        'Identity updated',
        'Cluster identity updated successfully!'
      )
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      toast.error(
        'Update failed',
        `Error updating cluster identity: ${errorMessage}`
      )
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4" />
        <Skeleton className="h-4" />
        <Skeleton className="h-4" />
      </div>
    )
  }

  if (!identity) {
    return (
      <div className="space-y-4">
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-yellow-500 mb-2">
            Cluster Identity Setup Required
          </h3>
          <p className="text-[var(--text-secondary)] mb-4">
            The cluster identity system requires database setup. Please run the
            following SQL migration in your Supabase dashboard:
          </p>
          <div className="bg-[var(--bg-secondary)] hover:bg-card/80 transition-colors duration-200 p-3 rounded font-mono text-sm">
            20250902_cluster_identity_minimal.sql
          </div>
          <p className="text-[var(--text-secondary)] mt-4 text-sm">
            This will create the necessary tables and initial data for cluster
            identity management, including:
          </p>
          <ul className="list-disc list-inside text-[var(--text-secondary)] text-sm mt-2 space-y-1">
            <li>Cluster branding and customization</li>
            <li>Social media and Discord links</li>
            <li>Public-facing cluster information</li>
          </ul>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-[var(--text-primary)]">
            {identity.display_name} Identity
          </h2>
          <p className="text-[var(--text-secondary)]">
            Manage your cluster&apos;s public identity and branding
          </p>
        </div>

        {isAdmin && !isEditing && (
          <Button
            onClick={() => setIsEditing(true)}
            className="w-full lg:w-auto"
          >
            Edit Identity
          </Button>
        )}
      </div>

      {/* Identity Display/Edit */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Basic Information */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-lg font-semibold">
            <Flag className="h-5 w-5" />
            Basic Information
          </div>

          <div>
            <Label>Display Name</Label>
            {isEditing ? (
              <Input
                value={editedIdentity?.display_name || ''}
                onChange={(e) =>
                  setEditedIdentity({
                    ...editedIdentity!,
                    display_name: e.target.value
                  })
                }
              />
            ) : (
              <p className="text-[var(--text-primary)]">
                {identity.display_name}
              </p>
            )}
          </div>

          <div>
            <Label>Short Name</Label>
            {isEditing ? (
              <Input
                value={editedIdentity?.short_name || ''}
                onChange={(e) =>
                  setEditedIdentity({
                    ...editedIdentity!,
                    short_name: e.target.value
                  })
                }
                maxLength={20}
              />
            ) : (
              <p className="text-[var(--text-primary)]">
                {identity.short_name}
              </p>
            )}
          </div>

          <div>
            <Label>Tagline</Label>
            {isEditing ? (
              <Input
                value={editedIdentity?.tagline || ''}
                onChange={(e) =>
                  setEditedIdentity({
                    ...editedIdentity!,
                    tagline: e.target.value
                  })
                }
                placeholder="Your cluster's motto or tagline"
              />
            ) : (
              <p className="text-[var(--text-primary)]">
                {identity.tagline || 'No tagline set'}
              </p>
            )}
          </div>

          <div>
            <Label>Description</Label>
            {isEditing ? (
              <textarea
                className="w-full p-2 bg-[var(--card-bg)] border border-[var(--card-border)] rounded"
                value={editedIdentity?.description || ''}
                onChange={(e) =>
                  setEditedIdentity({
                    ...editedIdentity!,
                    description: e.target.value
                  })
                }
                rows={4}
                placeholder="Describe your cluster..."
              />
            ) : (
              <p className="text-[var(--text-primary)] whitespace-pre-wrap">
                {identity.description || 'No description set'}
              </p>
            )}
          </div>
        </div>

        {/* Links & Social */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-lg font-semibold">
            <Globe className="h-5 w-5" />
            Links & Social
          </div>

          <div>
            <Label>Discord Invite URL</Label>
            {isEditing ? (
              <Input
                value={editedIdentity?.discord_invite_url || ''}
                onChange={(e) =>
                  setEditedIdentity({
                    ...editedIdentity!,
                    discord_invite_url: e.target.value
                  })
                }
                placeholder="https://discord.gg/..."
              />
            ) : (
              <p className="text-[var(--text-primary)]">
                {identity.discord_invite_url ? (
                  <a
                    href={identity.discord_invite_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--accent)] hover:underline"
                  >
                    {identity.discord_invite_url}
                  </a>
                ) : (
                  'No Discord invite set'
                )}
              </p>
            )}
          </div>

          <div>
            <Label>Website URL</Label>
            {isEditing ? (
              <Input
                value={editedIdentity?.website_url || ''}
                onChange={(e) =>
                  setEditedIdentity({
                    ...editedIdentity!,
                    website_url: e.target.value
                  })
                }
                placeholder="https://..."
              />
            ) : (
              <p className="text-[var(--text-primary)]">
                {identity.website_url ? (
                  <a
                    href={identity.website_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--accent)] hover:underline"
                  >
                    {identity.website_url}
                  </a>
                ) : (
                  'No website set'
                )}
              </p>
            )}
          </div>

          <div>
            <Label>Time Zone</Label>
            {isEditing ? (
              <Input
                value={editedIdentity?.time_zone || ''}
                onChange={(e) =>
                  setEditedIdentity({
                    ...editedIdentity!,
                    time_zone: e.target.value
                  })
                }
                placeholder="UTC"
              />
            ) : (
              <p className="text-[var(--text-primary)]">{identity.time_zone}</p>
            )}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      {isEditing && (
        <div className="flex gap-2 justify-end">
          <Button onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setEditedIdentity(identity)
              setIsEditing(false)
            }}
          >
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}
