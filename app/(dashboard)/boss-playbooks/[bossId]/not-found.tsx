import Link from 'next/link'
import { ArrowLeft, AlertCircle } from 'lucide-react'

export default function BossNotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="card-wh40k p-8 max-w-md text-center">
        <AlertCircle className="h-12 w-12 text-(--text-tertiary) mx-auto mb-4" />
        <h1 className="text-xl font-bold text-primary-wh40k mb-2">
          Boss Not Found
        </h1>
        <p className="text-sm text-secondary-wh40k mb-6">
          The playbook you&apos;re looking for doesn&apos;t exist or may have
          been moved.
        </p>
        <Link
          href="/boss-playbooks"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-accent-wh40k text-white hover:opacity-90 transition-opacity"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to All Playbooks
        </Link>
      </div>
    </div>
  )
}
