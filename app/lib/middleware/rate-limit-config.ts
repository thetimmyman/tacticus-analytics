export const RATE_LIMIT_CONFIG = {
  endpoints: {
    '/api/auth/login': { limit: 5, window: 60 * 1000 },
    '/api/auth/signup': { limit: 3, window: 60 * 60 * 1000 },
    '/api/auth/': { limit: 10, window: 60 * 1000 },
    '/api/guild/create-config': { limit: 60, window: 60 * 60 * 1000 },
    '/api/validate-api-key': { limit: 10, window: 60 * 1000 },
    '/api/clusters/create': { limit: 2, window: 60 * 60 * 1000 },
    '/api/discord/bot-invite': { limit: 5, window: 60 * 60 * 1000 },
    '/api/profile/change-player-id': { limit: 10, window: 60 * 60 * 1000 },
    '/api/onboarding/leader/claim-seat': {
      limit: 10,
      window: 60 * 60 * 1000
    },
    '/api/onboarding/claim/consume': {
      limit: 10,
      window: 60 * 60 * 1000
    },
    '/api/guild/': { limit: 50, window: 60 * 1000 },
    '/api/admin/': { limit: 10, window: 60 * 1000 },
    default: { limit: 60, window: 60 * 1000 }
  },
  userLimits: {
    member: { limit: 100, window: 60 * 1000 },
    officer: { limit: 200, window: 60 * 1000 },
    leader: { limit: 500, window: 60 * 1000 },
    default: { limit: 30, window: 60 * 1000 }
  },
  ipLimits: {
    burst: { limit: 100, window: 60 * 1000 },
    sustained: { limit: 1000, window: 60 * 60 * 1000 },
    daily: { limit: 10000, window: 24 * 60 * 60 * 1000 }
  },
  security: {
    blockDuration: 15 * 60 * 1000,
    maxFailedAttempts: 5,
    suspiciousPatterns: [
      /bot|crawler|spider|scraper/i,
      /automated|script|headless/i
    ],
    blockedUserAgents: ['curl', 'wget', 'python-requests', 'PostmanRuntime']
  }
} as const
