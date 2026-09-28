import { createPageMetadata } from '@/app/lib/metadata'

export const dynamic = 'force-dynamic'

export const metadata = createPageMetadata({
  title: 'Confirm Email',
  description:
    'Instructions for verifying a new Tacticus Analytics account before accessing the command deck.',
  path: '/auth/confirm-email'
})

export default function ConfirmEmailPage() {
  return (
    <div className="min-h-screen bg-linear-to-br from-(--bg-from) via-red-900 to-(--bg-to) flex items-center justify-center">
      <div className="max-w-md w-full mx-auto p-6">
        <div className="bg-black/60 backdrop-blur-xs rounded-lg border border-amber-500/30 p-8 text-center">
          <div className="text-6xl mb-4">📧</div>
          <h2 className="text-2xl font-bold text-yellow-400 mb-4">
            Check Your Email
          </h2>
          <p className="text-amber-100/80 mb-6">
            We&apos;ve sent a confirmation email to verify your account.
          </p>

          <div className="bg-amber-900/20 border border-amber-500/30 rounded-lg p-4 mb-6">
            <p className="text-sm text-amber-200 font-medium mb-2">
              ⚠️ Important: Check your spam/junk folder
            </p>
            <p className="text-xs text-amber-100/70">
              Email providers often mark automated emails as spam. Please check
              your junk/spam folder if you don&apos;t see the email in your
              inbox.
            </p>
          </div>

          <div className="space-y-4 text-sm text-amber-100/70">
            <p>
              Click the link in the email to activate your account and access
              the Command Deck.
            </p>
            <p>
              The email is from{' '}
              <span className="text-yellow-300 font-mono">
                noreply@supabase.io
              </span>
            </p>
          </div>

          <div className="mt-8 pt-6 border-t border-(--card-border)">
            <p className="text-sm text-secondary-wh40k">
              Already confirmed?{' '}
              <a
                href="/auth/login"
                className="text-yellow-400 hover:text-amber-300 underline"
              >
                Sign in here
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
