'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@tacticus/ui-kit'
import { Button } from '@tacticus/ui-kit'
import { Shield, ArrowRight } from 'lucide-react'

export default function GuildOnboardingPage() {
  const router = useRouter()

  const goToDashboard = () => router.push('/onboarding/dashboard')

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      <div className="container mx-auto max-w-4xl px-4 sm:px-6 py-10">
        <Card className="border border-[var(--card-border)] bg-[var(--card-bg)] shadow-xl">
          <CardHeader className="text-center space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/40">
              <Shield className="h-8 w-8 text-emerald-400" />
            </div>
            <CardTitle className="text-3xl font-bold text-[var(--text-primary)]">
              Guild onboarding has moved
            </CardTitle>
            <CardDescription className="text-base text-[var(--text-secondary)]">
              We now guide every leader through a single onboarding dashboard.
              Create an account or sign in to finish registering your guild.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Button
                className="w-full bg-emerald-600 hover:bg-emerald-500"
                onClick={goToDashboard}
              >
                Open Onboarding Dashboard
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button
                className="w-full"
                variant="outline"
                onClick={() => router.push('/auth/signup')}
              >
                Create Account
              </Button>
            </div>
            <p className="text-sm text-[var(--text-secondary)] text-center">
              Already have an account?{' '}
              <Link
                href="/auth/login?redirectTo=/onboarding/dashboard"
                className="text-[var(--accent)] underline"
              >
                Sign in to continue
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
