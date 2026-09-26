import { requireActiveMembershipForApi } from '@/app/lib/auth'
import { createGuildWarAnalyticsRoute } from '../_rpc-route'

export const GET = createGuildWarAnalyticsRoute({
  component: 'api.wars.analytics.performance',
  defaultLimit: 50,
  failureMessage: 'Failed to fetch hero performance',
  responseKey: 'heroes',
  rpc: 'get_hero_performance',
  requireMembership: () => requireActiveMembershipForApi()
})
