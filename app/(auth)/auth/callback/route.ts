import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { serverEnv } from '@tacticus/app-core/server-env'
import { authConfig } from '@/app/lib/auth/config'
import { featureFlags } from '@/app/lib/utils/feature-flags'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { createComponentLogger, generateRequestId } from '@/app/lib/logging'
import { syncDiscordProfile } from '@/app/lib/discord/sync-profile'
import { extractDiscordIdentityClaims } from '@/app/lib/discord/identity-claims'
import { validateRedirectPath } from '@/app/lib/auth/redirect'
import {
  activatePendingDiscordRelink,
  DiscordRelinkActivationError
} from '@/app/lib/auth/discord-relink-activation'
import { DISCORD_RELINK_STATE_COOKIE } from '@/app/lib/auth/discord-relink-state'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import { findActiveBanForAuthUser } from '@/app/lib/auth/user-bans'

const logger = createComponentLogger('auth.callback')

export const dynamic = 'force-dynamic'

async function suspendedRedirect(
  supabase: SupabaseClient,
  user: User | null,
  origin: string
): Promise<NextResponse | null> {
  if (!user || !(await findActiveBanForAuthUser(user))) return null

  const { error } = await supabase.auth.signOut()
  if (error) {
    logger.warn(
      { error: error.message, userId: user.id },
      '[Auth Callback] Failed to clear banned session'
    )
  }
  logger.warn(
    { userId: user.id },
    '[Auth Callback] Banned authentication rejected'
  )
  return NextResponse.redirect(`${origin}/auth/suspended`)
}

/** Syncs display fields only; the DB trigger verifies the identity and nothing auto-binds. */
async function ensureDiscordProfileSynced(
  supabase: SupabaseClient,
  user: User | null,
  options: {
    freshDiscordOAuth?: boolean
    cookieStore?: Awaited<ReturnType<typeof cookies>>
  } = {}
): Promise<void> {
  if (!featureFlags.discordAuth || !user) return

  const claims = extractDiscordIdentityClaims(user)
  if (!claims?.discordUserId) return

  if (options.freshDiscordOAuth && options.cookieStore) {
    const sealedState = options.cookieStore.get(
      DISCORD_RELINK_STATE_COOKIE
    )?.value
    if (sealedState) {
      try {
        await activatePendingDiscordRelink(supabase, user, sealedState)
        options.cookieStore.delete(DISCORD_RELINK_STATE_COOKIE)
      } catch (activationError) {
        // Discard state only when proven invalid, expired or stale; transient failures keep it.
        if (
          activationError instanceof DiscordRelinkActivationError &&
          activationError.discardState
        ) {
          options.cookieStore.delete(DISCORD_RELINK_STATE_COOKIE)
        }
        logger.error(
          { activationError, userId: user.id },
          '[Auth Callback] Discord generation activation failed'
        )
        throw activationError
      }
    }
  }

  try {
    await syncDiscordProfile(supabase, user)
    logger.info(
      { userId: user.id },
      '[Auth Callback] Discord profile sync completed'
    )
  } catch (syncError) {
    logger.warn({ syncError }, '[Auth Callback] Discord sync failed')
    // Sync errors never fail the login.
  }
}

async function needsOnboarding(
  supabase: SupabaseClient,
  user: User | null
): Promise<boolean> {
  if (!user) return false

  if (user.user_metadata?.role && user.user_metadata.role !== 'onboarding') {
    return false
  }

  try {
    const { data: profile, error } = await supabase
      .from(CURRENT_USER_PLAYER_MAPPING)
      .select('role, is_current')
      .eq('user_id', user.id)
      .eq('is_current', true)
      .maybeSingle()

    // Fail safe: a query error must not redirect to onboarding.
    if (error) {
      logger.warn(
        {
          userId: user.id,
          error: error.message
        },
        '[Auth Callback] Failed to check player_mapping, skipping onboarding redirect'
      )
      return false
    }

    if (profile && profile.role && profile.role !== 'onboarding') {
      return false
    }

    return true
  } catch (err) {
    logger.error(
      {
        userId: user.id,
        error: err
      },
      '[Auth Callback] Unexpected error checking onboarding status'
    )
    return false
  }
}

// Every callback response sets or rotates the session: never let a shared cache keep one.
const NO_STORE_HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
  Expires: '0',
  Pragma: 'no-cache'
}

export async function GET(request: Request) {
  const response = await handleCallback(request)
  for (const [key, value] of Object.entries(NO_STORE_HEADERS)) {
    response.headers.set(key, value)
  }
  return response
}

async function handleCallback(request: Request) {
  let callbackSupabase: SupabaseClient | null = null
  let sessionCreatedByCallback = false

  try {
    const { searchParams } = new URL(request.url)
    const requestId = generateRequestId()
    const telemetryLogger = createComponentLogger('auth-callback', {
      requestId
    })
    // Runtime SITE_URL avoids container-internal addresses.
    const origin =
      process.env.SITE_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      new URL(request.url).origin

    logger.info(
      {
        siteUrl: process.env.SITE_URL,
        nextPublicSiteUrl: process.env.NEXT_PUBLIC_SITE_URL,
        requestUrl: new URL(request.url).origin + new URL(request.url).pathname,
        resolvedOrigin: origin
      },
      '[Auth Callback] Origin resolution'
    )
    const code = searchParams.get('code')
    const type = searchParams.get('type')
    const isRecovery = type === 'recovery'
    const defaultRedirect = isRecovery
      ? '/auth/reset-password'
      : authConfig.redirects.afterLogin || '/'
    const redirectParam =
      searchParams.get('redirectTo') ?? searchParams.get('next')
    // Blocks `%2F%2F` and backslash open-redirect bypasses.
    const next = validateRedirectPath(redirectParam) ?? defaultRedirect
    const provider = searchParams.get('provider') || undefined
    const safeProvider =
      provider === 'discord' || provider === 'google' ? provider : undefined
    const error = searchParams.get('error')
    const errorDescription = searchParams.get('error_description')

    if (error) {
      logger.error(
        {
          event: 'oauth_error',
          provider: safeProvider,
          hasErrorDescription: Boolean(errorDescription)
        },
        '[Auth Callback] OAuth error:'
      )
      telemetryLogger.warn(
        {
          event: 'oauth_error',
          provider: safeProvider,
          hasErrorDescription: Boolean(errorDescription)
        },
        'OAuth callback error'
      )
      const errorParams = new URLSearchParams({
        error,
        description: errorDescription || '',
        ...(provider && { provider })
      })
      return NextResponse.redirect(
        `${origin}/auth/error?${errorParams.toString()}`
      )
    }

    const cookieStore = await cookies()
    // Cookie domain only in production (cross-subdomain auth); localhost uses the origin.
    const isLocalhost =
      origin.includes('localhost') || origin.includes('127.0.0.1')
    const cookieDomain = isLocalhost ? undefined : '.tacticusanalytics.com'

    // Internal URL keeps traffic on the Docker network (avoids external DNS).
    const supabase = createServerClient(
      serverEnv.SUPABASE_INTERNAL_URL,
      serverEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        auth: {
          storageKey: authConfig.session.storageKey
        },
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, {
                ...options,
                ...(cookieDomain && { domain: cookieDomain })
              })
            )
          }
        }
      }
    )
    callbackSupabase = supabase

    // Handles double-click/refresh; recovery flows still exchange the code.
    const {
      data: { session: existingSession }
    } = await supabase.auth.getSession()

    const nextIsOnboardingSubpage =
      next.startsWith('/onboarding/') || next.includes('/onboarding/claim')

    if (existingSession && !isRecovery) {
      // getUser verifies the refresh token; getSession only reads cookies.
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (user && !userError) {
        const banned = await suspendedRedirect(supabase, user, origin)
        if (banned) return banned
        logger.info('[Auth Callback] User already authenticated, redirecting')
        let finalNext = next
        if (
          !nextIsOnboardingSubpage &&
          (await needsOnboarding(supabase, user))
        ) {
          finalNext = '/onboarding'
        }
        // A manual Discord link from /profile arrives with a session and skips the sync below.
        await ensureDiscordProfileSynced(supabase, user, {
          freshDiscordOAuth: Boolean(code && provider === 'discord'),
          cookieStore
        })
        return NextResponse.redirect(`${origin}${finalNext}`)
      }

      // Stale cookie: fall through and exchange the new code.
      logger.warn(
        {
          hasCode: Boolean(code),
          error: userError?.message
        },
        '[Auth Callback] Stale session detected, proceeding to code exchange'
      )
    }

    if (!code) {
      logger.error(
        { provider: safeProvider },
        '[Auth Callback] No code provided in callback'
      )
      telemetryLogger.warn(
        { event: 'missing_code', provider: safeProvider, isRecovery },
        'Auth callback missing code'
      )
      return NextResponse.redirect(`${origin}/auth/error?error=no_code`)
    }

    // Some email flows (magic links) do not use PKCE; handle both.
    const { data: exchangeData, error: sessionError } =
      await supabase.auth.exchangeCodeForSession(code)
    sessionCreatedByCallback = Boolean(exchangeData.session)

    if (sessionError) {
      const hasCodeVerifier = Boolean(
        cookieStore.get('sb-code-verifier')?.value
      )
      telemetryLogger.warn(
        {
          event: 'session_exchange_failed',
          provider: safeProvider,
          isRecovery,
          error: sessionError.message,
          hasCodeVerifier
        },
        'Auth callback session exchange failed'
      )
      // Race: the user may have been authenticated meanwhile.
      const {
        data: { session: checkSession }
      } = await supabase.auth.getSession()

      if (checkSession) {
        sessionCreatedByCallback ||=
          !existingSession ||
          checkSession.access_token !== existingSession.access_token
        logger.info(
          '[Auth Callback] Session exchange had error but user is authenticated, redirecting'
        )
        const {
          data: { user },
          error: recoveredUserError
        } = await supabase.auth.getUser()
        if (recoveredUserError || !user) {
          throw (
            recoveredUserError ??
            new Error('Unable to verify the recovered callback session')
          )
        }
        const banned = await suspendedRedirect(supabase, user, origin)
        if (banned) return banned
        let finalNext = next
        if (
          !isRecovery &&
          !nextIsOnboardingSubpage &&
          (await needsOnboarding(supabase, user))
        ) {
          finalNext = '/onboarding'
        }
        if (!isRecovery) {
          await ensureDiscordProfileSynced(supabase, user, {
            freshDiscordOAuth: Boolean(code && provider === 'discord'),
            cookieStore
          })
        }
        return NextResponse.redirect(`${origin}${finalNext}`)
      }

      if (
        sessionError.message?.includes('code verifier') ||
        sessionError.message?.includes('validation_failed')
      ) {
        // Email links opened outside the PKCE flow; try a stored verifier.
        const codeVerifier = cookieStore.get('sb-code-verifier')?.value

        if (!codeVerifier) {
          // No verifier: likely an expired or re-clicked email link.
          logger.warn(
            '[Auth Callback] PKCE code verifier missing - likely expired or duplicate link click'
          )
          telemetryLogger.warn(
            {
              event: 'pkce_code_verifier_missing',
              provider: safeProvider,
              isRecovery
            },
            'Auth callback PKCE code verifier missing'
          )
          return NextResponse.redirect(
            `${origin}/auth/login?error=link_expired&message=${encodeURIComponent('This link has expired or was already used. Please request a new one.')}`
          )
        }
      }

      if (
        sessionError.message?.includes('expired') ||
        sessionError.message?.includes('already been used')
      ) {
        const {
          data: { user }
        } = await supabase.auth.getUser()
        if (user) {
          const banned = await suspendedRedirect(supabase, user, origin)
          if (banned) return banned
          logger.info(
            '[Auth Callback] Token already used but user authenticated, redirecting'
          )
          let finalNext = next
          if (
            !isRecovery &&
            !nextIsOnboardingSubpage &&
            (await needsOnboarding(supabase, user))
          ) {
            finalNext = '/onboarding'
          }
          if (!isRecovery) {
            await ensureDiscordProfileSynced(supabase, user, {
              freshDiscordOAuth: Boolean(code && provider === 'discord'),
              cookieStore
            })
          }
          return NextResponse.redirect(`${origin}${finalNext}`)
        }

        telemetryLogger.warn(
          { event: 'link_expired', provider: safeProvider, isRecovery },
          'Auth callback link expired or already used'
        )
        return NextResponse.redirect(
          `${origin}/auth/login?error=link_expired&message=${encodeURIComponent('This link has expired or was already used. Please request a new one.')}`
        )
      }

      logger.error(
        { err: sessionError },
        '[Auth Callback] Session exchange error:'
      )
      telemetryLogger.error(
        {
          event: 'session_exchange_error',
          provider: safeProvider,
          isRecovery,
          error: sessionError.message
        },
        'Auth callback session exchange error'
      )
      return NextResponse.redirect(
        `${origin}/auth/error?error=session_exchange&description=${encodeURIComponent(sessionError.message)}`
      )
    }

    const {
      data: { user }
    } = await supabase.auth.getUser()
    const banned = await suspendedRedirect(supabase, user, origin)
    if (banned) return banned
    let finalNext = next
    if (
      !isRecovery &&
      !nextIsOnboardingSubpage &&
      (await needsOnboarding(supabase, user))
    ) {
      finalNext = '/onboarding'
    }

    if (!isRecovery) {
      const requireDiscordLink =
        featureFlags.requireDiscordLink && featureFlags.discordAuth
      const hasDiscordIdentity = user?.identities?.some(
        (identity) => identity.provider === 'discord'
      )
      if (requireDiscordLink && !hasDiscordIdentity) {
        const redirectUrl = new URL('/profile', origin)
        redirectUrl.searchParams.set('linkRequired', 'discord')
        redirectUrl.searchParams.set('redirectTo', next || defaultRedirect)
        finalNext = redirectUrl.pathname + redirectUrl.search
      }

      // In-process so the access token never crosses a fetch boundary that logs could capture.
      await ensureDiscordProfileSynced(supabase, user, {
        freshDiscordOAuth: Boolean(code && provider === 'discord'),
        cookieStore
      })
    }

    return NextResponse.redirect(`${origin}${finalNext}`)
  } catch (error) {
    // Clear only a session this callback minted (a relink starts with a valid one); rejected
    // new sessions are cleared too.
    if (sessionCreatedByCallback && callbackSupabase) {
      try {
        const { error: signOutError } = await callbackSupabase.auth.signOut()
        if (signOutError) {
          logger.error(
            { error: signOutError.message },
            '[Auth Callback] Failed to clear rejected callback session'
          )
        }
      } catch (signOutError) {
        logger.error(
          { err: signOutError },
          '[Auth Callback] Rejected callback session cleanup threw'
        )
      }
    }
    logger.error({ err: error }, '[Auth Callback] Unexpected error:')
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.redirect(
      `${new URL(request.url).origin}/auth/error?error=unexpected&description=${encodeURIComponent(errorMessage)}`
    )
  }
}
