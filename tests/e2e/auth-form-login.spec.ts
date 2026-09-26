import { test, expect } from '@playwright/test'

// Manual only (never add to CI): needs E2E_SIGNIN_EMAIL / E2E_SIGNIN_PASSWORD (never logged);
// run with `npm run test:e2e:signin`. The CI guard is tests/components/AuthClientPage.test.tsx.

const EMAIL = process.env.E2E_SIGNIN_EMAIL
const PASSWORD = process.env.E2E_SIGNIN_PASSWORD

test.skip(
  !EMAIL || !PASSWORD,
  'E2E_SIGNIN_EMAIL / E2E_SIGNIN_PASSWORD not set -- see file header'
)

test('signs in through the form and reaches an authenticated page', async ({
  page
}) => {
  // E2E_MOCK_LOGIN=1 stubs only the backend's answer; the form is still driven.
  if (process.env.E2E_MOCK_LOGIN === '1') {
    await page.route('**/api/auth/login', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { id: 'e2e-mock' },
          session: { serverPersisted: true }
        })
      })
    })
  }

  await page.goto('/auth', { waitUntil: 'networkidle' })

  const turnstile = page.locator(
    'iframe[src*="challenges.cloudflare.com"], .cf-turnstile, [data-sitekey]'
  )
  test.skip(
    (await turnstile.count()) > 0,
    'Turnstile is blocking this login; automation cannot solve it (see ticket notes)'
  )

  // This selector once resolved to a "Sign In" tab instead of the button.
  const signInButtons = page.getByRole('button', { name: /sign in/i })
  await expect(signInButtons).toHaveCount(1)

  await page.getByLabel('Email Address').fill(EMAIL as string)
  await page.getByLabel('Password').fill(PASSWORD as string)
  await signInButtons.first().click()

  await page.waitForURL((url) => !url.pathname.startsWith('/auth'), {
    timeout: 20_000
  })

  await expect(page.locator('input[type="password"]')).toHaveCount(0)
})
