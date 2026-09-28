import { notFound } from 'next/navigation'
import { StatusLabel } from '@tacticus/ui-kit'
import { db } from '@/app/lib/db'
import { Card, CardContent, CardHeader, CardTitle } from '@tacticus/ui-kit'
import { Shield, Calendar, Users } from 'lucide-react'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'

interface ProfilePageProps {
  params: Promise<{ id: string }>
}

interface ProfileData {
  display_name: string
  guild_code: string
  guild_name: string
  cluster_code: string
  role: string
  last_sync_at: string
  is_active: boolean
}

async function getPlayerProfile(userId: string) {
  const supabase = await db()

  const { data, error } = await supabase.rpc('get_scoped_player_profile', {
    p_user_id: userId
  })
  const profile = data?.[0]

  if (error || !profile) {
    return null
  }

  const profileData: ProfileData = {
    display_name: profile.display_name ?? 'Unknown',
    guild_code: profile.guild_code ?? '',
    guild_name: profile.guild_code ?? '', // guild_name column doesn't exist in view
    cluster_code: profile.cluster_code ?? '',
    role: profile.role ?? 'member',
    last_sync_at: profile.last_sync_at ?? new Date().toISOString(),
    is_active: Boolean(profile.is_current)
  }

  return profileData
}

export default async function ProfilePage({ params }: ProfilePageProps) {
  const resolvedParams = await params
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  if (!uuidRegex.test(resolvedParams.id)) {
    notFound()
  }

  const profile = await getPlayerProfile(resolvedParams.id)

  if (!profile) {
    notFound()
  }
  const guildLabel = formatGuildDisplayLabel(
    {
      display_name:
        profile.guild_name !== profile.guild_code ? profile.guild_name : null,
      guild_code: profile.guild_code
    },
    profile.guild_code
  )

  // eslint-disable-next-line no-restricted-syntax -- server component, hydration not applicable
  const joinDate = new Date(profile.last_sync_at).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })

  const roleDisplay = {
    leader: 'Guild Leader',
    officer: 'Officer',
    member: 'Member',
    applicant: 'Applicant'
  }

  const roleColor = {
    leader: 'bg-red-100 text-red-800',
    officer: 'bg-blue-100 text-blue-800',
    member: 'bg-green-100 text-green-800',
    applicant: 'bg-yellow-100 text-yellow-800'
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center space-x-2 text-sm text-muted-foreground mb-4">
        <span>Profile</span>
        <span>/</span>
        <span className="text-foreground">{profile.display_name}</span>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-2xl flex items-center gap-2">
              <Shield className="h-6 w-6" />
              {profile.display_name}
            </CardTitle>
            <span
              className={`px-2 py-1 rounded-sm text-sm ${roleColor[profile.role as keyof typeof roleColor]} border-0`}
            >
              {roleDisplay[profile.role as keyof typeof roleDisplay]}
            </span>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Guild</p>
                  <p className="font-medium">{guildLabel}</p>
                  {profile.cluster_code && (
                    <p className="text-xs text-muted-foreground">
                      Cluster: {profile.cluster_code}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Member Since</p>
                  <p className="font-medium">{joinDate}</p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">Status</p>
                <StatusLabel type={profile.is_active ? 'success' : 'inactive'}>
                  {profile.is_active ? 'Active' : 'Inactive'}
                </StatusLabel>
              </div>

              {profile.cluster_code && (
                <div>
                  <p className="text-sm text-muted-foreground">Cluster</p>
                  <p className="font-medium">{profile.cluster_code} Cluster</p>
                </div>
              )}
            </div>
          </div>

          <div className="pt-4 border-t">
            <p className="text-sm text-muted-foreground">
              This is a public profile view. More detailed information may be
              available to guild members and officers.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export async function generateMetadata({ params }: ProfilePageProps) {
  const resolvedParams = await params
  const profile = await getPlayerProfile(resolvedParams.id)

  if (!profile) {
    return {
      title: 'Profile Not Found',
      description: 'The requested player profile could not be found.'
    }
  }
  const guildLabel = formatGuildDisplayLabel(
    {
      display_name:
        profile.guild_name !== profile.guild_code ? profile.guild_name : null,
      guild_code: profile.guild_code
    },
    profile.guild_code
  )

  return {
    title: `${profile.display_name} - Player Profile`,
    description: `View ${profile.display_name}'s profile from ${guildLabel} guild.`,
    openGraph: {
      title: `${profile.display_name} - Player Profile`,
      description: `View ${profile.display_name}'s profile from ${guildLabel} guild.`
    }
  }
}
