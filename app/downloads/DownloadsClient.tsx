'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  platforms,
  type Platform,
  type Channel
} from '@/app/lib/downloads/schema'
import { type DownloadsState } from '@/app/lib/downloads/state'

const names: Record<Platform, string> = {
  linux: 'Linux',
  macos: 'macOS',
  windows: 'Windows',
  android: 'Android',
  ios: 'iOS'
}

export function detectPlatform(userAgent: string): Platform | null {
  if (
    /iPad|iPhone|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && /Mobile/.test(userAgent))
  )
    return 'ios'
  if (/Android/.test(userAgent)) return 'android'
  if (/Windows/.test(userAgent)) return 'windows'
  if (/Macintosh|Mac OS X/.test(userAgent)) return 'macos'
  if (/Linux/.test(userAgent)) return 'linux'
  return null
}

const subscribeAgent = () => () => {}
const browserAgent = () => navigator.userAgent
const serverAgent = () => ''

export default function DownloadsClient({
  initialState
}: {
  initialState: DownloadsState
}) {
  const agent = useSyncExternalStore(subscribeAgent, browserAgent, serverAgent)
  const [override, setOverride] = useState<Platform | 'all' | null>(null)
  const [architecture, setArchitecture] = useState('all')
  const [channel, setChannel] = useState(initialState.channels[0] || 'stable')
  const [state, setState] = useState(initialState)
  const recommended = detectPlatform(agent)
  const selected = override ?? recommended ?? 'all'

  useEffect(() => {
    const controller = new AbortController()
    const refresh = async () => {
      // Recheck restored browser snapshots; every installer handoff is also revalidated by the server.
      try {
        const response = await fetch('/api/downloads/manifest', {
          cache: 'no-store',
          signal: controller.signal
        })
        if (!response.ok) {
          setState({ status: 'unavailable', releases: [], channels: [] })
          return
        }
        const result: DownloadsState = await response.json()
        setState(result)
      } catch {
        if (!controller.signal.aborted)
          setState({ status: 'unavailable', releases: [], channels: [] })
      }
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void refresh()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const expires = state.expiresAt
      ? Date.parse(state.expiresAt) - Date.now()
      : 0
    const timer = state.expiresAt
      ? setTimeout(
          () => setState({ status: 'unavailable', channels: [], releases: [] }),
          Math.max(0, expires)
        )
      : undefined
    window.addEventListener('pageshow', onPageShow)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      controller.abort()
      clearTimeout(timer)
      window.removeEventListener('pageshow', onPageShow)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [state.expiresAt])

  const visible = state.releases.filter(
    (release) =>
      (selected === 'all' || release.platform === selected) &&
      (architecture === 'all' || release.architecture === architecture) &&
      release.channel === channel
  )
  const control =
    'rounded border border-slate-500 bg-slate-900 p-2 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300'

  return (
    <>
      <section
        aria-labelledby="choose-platform"
        className="my-8 rounded-xl border border-slate-600 p-5"
      >
        <h2 id="choose-platform" className="text-xl font-semibold">
          Choose your platform
        </h2>
        <p className="my-3 text-slate-300">
          {recommended
            ? `${names[recommended]} is suggested from your browser. Confirm the architecture and minimum OS before installing.`
            : 'Choose your operating system and architecture below.'}{' '}
          You can select another platform at any time.
        </p>
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-2">
            Operating system
            <select
              className={control}
              value={selected}
              onChange={(event) =>
                setOverride(event.target.value as Platform | 'all')
              }
            >
              <option value="all">All platforms</option>
              {platforms.map((platform) => (
                <option value={platform} key={platform}>
                  {names[platform]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2">
            Architecture
            <select
              className={control}
              value={architecture}
              onChange={(event) => setArchitecture(event.target.value)}
            >
              <option value="all">All architectures</option>
              <option value="x64">x64</option>
              <option value="arm64">ARM64</option>
              <option value="universal">Universal (macOS)</option>
            </select>
          </label>
          <label className="flex flex-col gap-2">
            Release channel
            <select
              className={control}
              value={channel}
              onChange={(event) => setChannel(event.target.value as Channel)}
            >
              {initialState.channels.map((entry) => (
                <option value={entry} key={entry}>
                  {entry === 'stable' ? 'Stable' : 'Preview'}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>
      <section aria-label="Available downloads" aria-live="polite">
        {visible.length === 0 && (
          <p className="rounded border border-slate-600 p-5">
            No qualified download is currently available for this selection.
            Platform entries below describe the current availability; a preview
            does not establish full feature parity.
          </p>
        )}
        <div className="grid gap-5 lg:grid-cols-2">
          {visible.map((release) => (
            <article
              key={release.id}
              className="rounded-xl border border-slate-600 p-5"
            >
              <h2 className="text-xl font-semibold">
                {names[release.platform]} {release.architecture} ·{' '}
                {release.component === 'core'
                  ? 'Application'
                  : release.component === 'guild-war'
                    ? 'Guild War addon'
                    : 'Replays addon'}
              </h2>
              <p className="my-3">
                Version {release.version} · {release.channel} ·{' '}
                {new Date(release.releasedAt).toISOString().slice(0, 10)}
              </p>
              <p>
                Requires {release.minimumOS} ·{' '}
                {(release.artifact.size / 1024 / 1024).toFixed(1)} MiB ·{' '}
                {release.artifact.format}
              </p>
              <a
                className="my-5 inline-block rounded bg-cyan-300 px-4 py-3 font-semibold text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                href={`/api/downloads/${release.id}`}
                rel="noreferrer"
              >
                {release.distribution.method === 'direct'
                  ? 'Download'
                  : release.distribution.method === 'testflight'
                    ? 'Open TestFlight'
                    : 'Open approved store'}{' '}
                {names[release.platform]} {release.architecture}
              </a>
              <details className="my-3">
                <summary className="cursor-pointer">
                  Verify this release
                </summary>
                <p className="mt-2">SHA-256</p>
                <code className="block break-all text-sm">
                  {release.artifact.sha256}
                </code>
                <p className="my-2">
                  Signature: {release.artifact.signature.scheme}, verified.{' '}
                  {release.platform === 'macos' && 'Notarization verified.'}{' '}
                  {release.platform === 'ios' && 'Provisioning verified.'}
                </p>
                <a
                  className="underline"
                  href={release.artifact.signature.evidenceUrl!}
                  rel="noreferrer"
                >
                  Signature verification evidence
                </a>
                {' · '}
                <a
                  className="underline"
                  href={release.qualification.evidenceUrl!}
                  rel="noreferrer"
                >
                  Installed qualification evidence
                </a>
                <p className="my-2 text-sm">
                  Store listings may change. Match the approved version/build
                  with this release; the digest identifies the archived package.
                </p>
              </details>
              <h3 className="mt-4 font-semibold">Install</h3>
              <p>{release.guidance.install}</p>
              <h3 className="mt-4 font-semibold">Update</h3>
              <p>{release.guidance.update}</p>
              <h3 className="mt-4 font-semibold">Uninstall and local data</h3>
              <p>{release.guidance.uninstall}</p>
              <h3 className="mt-4 font-semibold">Release notes</h3>
              <p className="whitespace-pre-line">
                {release.guidance.releaseNotes}
              </p>
              <h3 className="mt-4 font-semibold">
                Known gaps and client compatibility
              </h3>
              <p>{release.guidance.localClientSupport}</p>
              <ul className="list-disc pl-5">
                {release.guidance.knownGaps.map((gap) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
      <section aria-labelledby="support-matrix" className="my-10">
        <h2 id="support-matrix" className="mb-4 text-xl font-semibold">
          Platform support matrix
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <caption className="sr-only">
              Qualified core application downloads in the selected channel
            </caption>
            <thead>
              <tr>
                <th className="p-3" scope="col">
                  Platform
                </th>
                <th className="p-3" scope="col">
                  Current availability
                </th>
                <th className="p-3" scope="col">
                  Requirements
                </th>
              </tr>
            </thead>
            <tbody>
              {platforms.map((platform) => {
                const supported = state.releases.filter(
                  (release) =>
                    release.platform === platform &&
                    release.channel === channel &&
                    release.component === 'core'
                )
                return (
                  <tr key={platform} className="border-t border-slate-600">
                    <th scope="row" className="p-3">
                      {names[platform]}
                    </th>
                    <td className="p-3">
                      {supported.length
                        ? supported
                            .map(
                              (release) =>
                                `${release.architecture} ${release.version}`
                            )
                            .join(', ')
                        : 'No qualified public release'}
                    </td>
                    <td className="p-3">
                      {supported.length
                        ? supported
                            .map((release) => release.minimumOS)
                            .join('; ')
                        : 'Support has not been established'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
