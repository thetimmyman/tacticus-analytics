import Link from 'next/link'
import { getDownloadsState } from '@/app/lib/downloads/server'
import DownloadsClient from './DownloadsClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export const metadata = {
  title: 'Downloads | Tacticus Analytics',
  description:
    'Qualified application releases, platform requirements and installation guidance.',
  robots: { index: false, follow: false }
}

export default async function DownloadsPage() {
  const state = await getDownloadsState()
  return (
    <main
      id="main-content"
      className="mx-auto min-h-screen max-w-6xl px-5 py-12 text-slate-100"
    >
      <nav aria-label="Downloads navigation" className="mb-8">
        <Link className="underline" href="/">
          Tacticus Analytics home
        </Link>
      </nav>
      <h1 className="text-3xl font-bold">Tacticus Analytics downloads</h1>
      {state.status !== 'ready' ? (
        <p className="mt-5 rounded border border-slate-600 p-5" role="status">
          Downloads are currently unavailable. Public releases will appear here
          after their installation, signing, rights and security reviews are
          complete.
        </p>
      ) : (
        <>
          <p className="mt-4 max-w-3xl text-slate-300">
            Install only the release qualified for your operating system and
            architecture. No hosted account is required to download or use the
            local application. Platform detection is a convenience; it does not
            establish support.
          </p>
          {state.channels.includes('preview') && (
            <p className="mt-4 rounded border border-amber-400 p-4">
              Preview review access is active. Preview releases may have
              documented feature gaps and are separate from stable releases.
            </p>
          )}
          <DownloadsClient initialState={state} />
          <section aria-labelledby="privacy-consent" className="my-8 max-w-3xl">
            <h2 id="privacy-consent" className="text-xl font-semibold">
              Local operation, privacy and consent
            </h2>
            <p className="mt-3">
              Local workspaces request verified Player API access for personal
              content, with optional Guild and Guild Raid access. A key can
              cover multiple scopes. Store credentials in the native operating
              system vault; connection consent and cloud contribution consent
              are separate choices. Previously synced local data remains
              readable offline.
            </p>
            <p className="mt-3">
              Optional Guild War and Replays modules depend on supported
              device-local connections. The application can run when local
              game-client discovery is unavailable; consult each release’s
              compatibility notes. Never paste game-client secrets into support
              requests.
            </p>
            <p className="mt-3">
              Opening a download contacts the artifact provider or approved
              store. Returning to this page checks release availability again.
              Downloading does not enroll credentials or gameplay data for
              contribution. Update checks must remain a separate, disableable
              choice in the installed application.
            </p>
            <p className="mt-3">
              The software remains proprietary. Review the release’s notices and
              permissions before installation.{' '}
              <Link className="underline" href="/privacy">
                Privacy policy
              </Link>
              {' · '}
              <Link className="underline" href="/terms">
                Terms
              </Link>
            </p>
          </section>
        </>
      )}
    </main>
  )
}
