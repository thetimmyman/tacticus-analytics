import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getAuthUser } from '@/app/lib/auth'
import SimplifiedSignupForm from './SimplifiedSignupForm'

export const metadata: Metadata = {
  title: 'Create Account | Tacticus Analytics',
  description:
    'Create your account to access the onboarding dashboard and guild analytics.'
}

export const dynamic = 'force-dynamic'

export default async function SignupPage() {
  const authData = await getAuthUser()

  if (authData?.user) {
    redirect('/onboarding')
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-[#111] to-[#050505] flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-white/10 bg-white/5 p-8 shadow-xl backdrop-blur">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold text-white">
            Create your account
          </h1>
          <p className="text-sm text-white/70">
            Sign up to continue onboarding your guild and unlock analytics.
          </p>
        </div>

        <SimplifiedSignupForm />
      </div>
    </div>
  )
}
