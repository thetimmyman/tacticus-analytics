export const authConfig = {
  email: {
    confirmEmail: false, // Set to true in production
    enableSignup: true,
    passwordMinLength: 8,
    emailDomainWhitelist: [] // Empty = allow all domains
  },

  session: {
    expiryMargin: 60 * 5, // 5 minutes before expiry
    autoRefresh: true,
    persistSession: true,
    detectSessionInUrl: true,
    storageKey: 'tacticus-auth-token'
  },

  // Enforced by middleware.
  rateLimit: {
    login: {
      attempts: 5,
      windowMs: 60 * 1000 // 1 minute
    },
    signup: {
      attempts: 3,
      windowMs: 60 * 60 * 1000 // 1 hour
    }
  },

  redirects: {
    afterLogin: '/home',
    afterLogout: '/',
    afterSignup: '/home',
    onboarding: '/onboarding'
  },

  cookies: {
    name: 'tacticus-auth',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 60 * 60 * 24 * 7 // 7 days
  },

  csrf: {
    cookieName: 'csrf-token',
    headerName: 'x-csrf-token',
    tokenLength: 32
  },

  guild: {
    maxPlayersPerGuild: 30,
    defaultRole: 'member' as const,
    requireGuildOnSignup: true
  }
}
