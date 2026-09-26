import { Suspense } from 'react'
import LoginForm from '@/app/components/auth/LoginForm'
import { LoadingSpinner } from '@tacticus/ui-kit/loading'
import { createPageMetadata } from '@/app/lib/metadata'

export const dynamic = 'force-dynamic'

export const metadata = createPageMetadata({
  title: 'Sign In',
  description:
    'Sign in to Tacticus Analytics to access guild raid analytics, roster tools, and operational dashboards.',
  path: '/auth/login'
})

function LoginFormWithSuspense() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center p-8">
          <LoadingSpinner
            message="🔐 Preparing authentication protocols..."
            variant="protocol"
            size="md"
          />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  )
}

export default function LoginPage() {
  return <LoginFormWithSuspense />
}
