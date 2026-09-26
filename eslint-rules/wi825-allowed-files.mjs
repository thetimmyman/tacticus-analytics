/**
 * The one allowlist for `tacticus/no-internal-identifier-in-ui`, shared with its tests.
 * Every entry needs a `reason`; prefer `identifiers` over whole-file carve-outs.
 */

export const wi825AllowedFiles = [
  // Legitimate surfaces: the identifier is the subject matter.
  {
    path: 'app/(dashboard)/admin/feature-releases/ActivityAnalytics.tsx',
    identifiers: ['guild_code'],
    reason:
      'app-admin console (feature-releases/page.tsx: requireAuth() then redirect("/home") unless profile.is_app_admin). guildName is already the primary cell text; the code is a deliberate secondary mono line so an admin can copy it into psql.'
  },
  {
    path: 'app/(dashboard)/profile/page.tsx',
    identifiers: ['player_id'],
    reason:
      'the viewer\'s OWN Tacticus player id under an explicit "Player ID" <dt> on their own profile. WI-825 concerns opaque guild keys; guild_code on this page stays enforced (the guildDisplayLabel fallback at :226 was fixed, not allowlisted).'
  },
  {
    path: 'app/(dashboard)/profile/edit/EditProfilePlayerIdSection.tsx',
    identifiers: ['player_id'],
    reason:
      'twin of profile/page.tsx — the viewer\'s own player id under "Current Player ID", directly adjacent to the change-player-id control that edits it.'
  },
  {
    path: 'app/(public)/onboarding/dashboard/OnboardingDashboardClient.tsx',
    identifiers: ['player_id'],
    reason:
      'the onboarding flow exists to link the user\'s OWN player id, typed into the adjacent <Label htmlFor="playerId"> input; echoing it back is how the user confirms the link succeeded.'
  },

  // Tracked debt: remove the entry when the fix lands.
  {
    path: 'app/api/guild-raid/unified-assignments/route.ts',
    identifiers: ['player_id'],
    reason:
      'KNOWN LEAK - `displayNameById.get(a.playerId) ?? a.playerId` is used as the KEY of the `allocations` map before it is rendered, so a generic fallback would silently merge two unnamed players into one allocation bucket. Needs the same member-label backfill as useWarAnalyticsData.ts. NOT blessed.'
  }
]
