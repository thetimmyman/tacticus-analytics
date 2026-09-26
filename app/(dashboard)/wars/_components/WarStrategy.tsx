'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { dbClient } from '@/app/lib/db/client'
import { Card, CardContent, CardHeader, CardTitle } from '@tacticus/ui-kit'
import { Button } from '@tacticus/ui-kit'
import { Textarea } from '@tacticus/ui-kit/textarea'
import {
  RadixSelect,
  RadixSelectContent,
  RadixSelectItem,
  RadixSelectTrigger,
  RadixSelectValue
} from '@tacticus/ui-kit/radix-select'
import { Switch } from '@tacticus/ui-kit'
import { Settings, Save, Shield, Sword } from 'lucide-react'
import LineupEditor from './LineupEditor'

interface WarStrategyProps {
  guildCode: string
  userRole: string
}

interface WarSettings {
  auto_opt_in: boolean
  auto_pick_battlefield_level: boolean
  preferred_battlefield_level?: number
  defensive_lineup_auto: boolean
  war_notifications_enabled: boolean
  strategy_notes: string
}

export default function WarStrategy({ guildCode, userRole }: WarStrategyProps) {
  const [settings, setSettings] = useState<WarSettings>({
    auto_opt_in: false,
    auto_pick_battlefield_level: false,
    defensive_lineup_auto: false,
    war_notifications_enabled: true,
    strategy_notes: ''
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const supabase = useMemo(() => dbClient(), [])
  const canManage = userRole === 'leader' || userRole === 'officer'

  const fetchWarSettings = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('guild_war_settings')
        .select('*')
        .eq('guild_code', guildCode)
        .single()

      if (error && error.code !== 'PGRST116') {
        throw error
      }

      if (data) {
        setSettings({
          auto_opt_in: data.auto_opt_in || false,
          auto_pick_battlefield_level:
            data.auto_pick_battlefield_level || false,
          preferred_battlefield_level:
            data.preferred_battlefield_level || undefined,
          defensive_lineup_auto: data.defensive_lineup_auto || false,
          war_notifications_enabled: data.war_notifications_enabled !== false,
          strategy_notes: data.strategy_notes || ''
        })
      }
    } catch (err) {
      console.error('Error fetching war settings:', err)
      setError('Failed to load war settings')
    } finally {
      setLoading(false)
    }
  }, [guildCode, supabase])

  useEffect(() => {
    fetchWarSettings()
  }, [fetchWarSettings])

  const saveWarSettings = async () => {
    if (!canManage) return

    setSaving(true)
    try {
      const { error } = await supabase.from('guild_war_settings').upsert(
        {
          guild_code: guildCode,
          ...settings,
          updated_at: new Date().toISOString()
        },
        {
          onConflict: 'guild_code'
        }
      )

      if (error) throw error
      setError(null)
    } catch (err) {
      console.error('Error saving war settings:', err)
      setError('Failed to save war settings')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-[var(--text-secondary)]">
          Loading strategy settings...
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="card-wh40k border-red-500/30 bg-red-500/10">
          <div className="p-4">
            <p className="text-red-400">{error}</p>
            <Button
              onClick={() => setError(null)}
              variant="ghost"
              size="sm"
              className="mt-2"
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Settings className="h-5 w-5" />
            <span>War Settings</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center space-x-3">
                <Switch
                  checked={settings.auto_pick_battlefield_level}
                  onCheckedChange={(checked) =>
                    setSettings((prev) => ({
                      ...prev,
                      auto_pick_battlefield_level: checked
                    }))
                  }
                  disabled={!canManage}
                />
                <label className="text-sm text-[var(--text-primary)]">
                  Auto-pick battlefield level
                </label>
              </div>

              <div className="flex items-center space-x-3">
                <Switch
                  checked={settings.war_notifications_enabled}
                  onCheckedChange={(checked) =>
                    setSettings((prev) => ({
                      ...prev,
                      war_notifications_enabled: checked
                    }))
                  }
                  disabled={!canManage}
                />
                <label className="text-sm text-[var(--text-primary)]">
                  Enable war notifications
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--text-primary)]">
                Preferred Battlefield Level
              </label>
              <p className="text-xs text-[var(--text-secondary)] mb-2">
                This setting is used as the default for Zone Planning
              </p>
              <RadixSelect
                value={settings.preferred_battlefield_level?.toString() || ''}
                onValueChange={(value) =>
                  setSettings((prev) => ({
                    ...prev,
                    preferred_battlefield_level: parseInt(value)
                  }))
                }
                disabled={!canManage}
              >
                <RadixSelectTrigger className="w-full md:w-48">
                  <RadixSelectValue placeholder="Select level..." />
                </RadixSelectTrigger>
                <RadixSelectContent>
                  <RadixSelectItem value="1">BF1 - Recruit</RadixSelectItem>
                  <RadixSelectItem value="2">BF2 - Veteran</RadixSelectItem>
                  <RadixSelectItem value="3">BF3 - Elite</RadixSelectItem>
                  <RadixSelectItem value="4">BF4 - Champion</RadixSelectItem>
                  <RadixSelectItem value="5">BF5 - Hero</RadixSelectItem>
                </RadixSelectContent>
              </RadixSelect>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--text-primary)]">
                Strategy Notes
              </label>
              <Textarea
                value={settings.strategy_notes}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    strategy_notes: e.target.value
                  }))
                }
                placeholder="Add general war strategy notes for your guild..."
                className="h-32"
                disabled={!canManage}
              />
            </div>

            {canManage && (
              <div className="flex justify-end">
                <Button onClick={saveWarSettings} disabled={saving}>
                  <Save className="h-4 w-4 mr-2" />
                  {saving ? 'Saving...' : 'Save Settings'}
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Shield className="h-5 w-5 text-blue-400" />
            <span>My Defensive Lineups</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--text-secondary)] mb-4">
            Create defensive lineups from your roster. These are your personal
            pre-made teams for zone defense.
          </p>
          <LineupEditor
            guildCode={guildCode}
            lineupType="defensive"
            notesPrompt="Describe when to use this defensive lineup, what it's good against, etc."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Sword className="h-5 w-5 text-red-400" />
            <span>My Offensive Lineups</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--text-secondary)] mb-4">
            Create offensive lineups from your roster. Use the notes to record
            what teams this lineup counters and what to avoid.
          </p>
          <LineupEditor
            guildCode={guildCode}
            lineupType="offensive"
            notesPrompt="What does this team counter? What teams should you avoid with it?"
          />
        </CardContent>
      </Card>
    </div>
  )
}
