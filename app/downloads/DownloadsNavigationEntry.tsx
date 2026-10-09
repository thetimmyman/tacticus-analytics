import { ChromeLink as Link } from '@/app/components/navigation/ChromeLink'
import { getDownloadsState } from '@/app/lib/downloads/server'

export default async function DownloadsNavigationEntry() {
  const state = await getDownloadsState()
  if (
    state.status !== 'ready' ||
    !state.releases.some((release) => release.component === 'core')
  )
    return null
  return (
    <nav
      aria-label="Application downloads"
      className="border-b border-slate-600 bg-slate-900 px-5 py-2 text-right text-slate-100"
    >
      <Link
        href="/downloads"
        className="rounded underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
      >
        Download the application
      </Link>
    </nav>
  )
}
