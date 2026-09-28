import Link from 'next/link'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const revalidate = false

export default function NotFound() {
  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center">
      <div className="text-center">
        <h2>++ Data-shrine not found (404) ++</h2>
        <p>This data-shrine has been purged or was never consecrated.</p>
        <Link
          href="/"
          className="mt-4 inline-block px-4 py-2 bg-blue-600 text-white rounded-sm hover:bg-blue-700"
        >
          Return to the sanctioned path
        </Link>
      </div>
    </div>
  )
}
