'use client'

import React, { useEffect, useRef, useState } from 'react'
import type {
  AddonId,
  AddonManifest
} from '../../packages/addon-host/src/contract'
import type { AddonSummary } from '../../packages/addon-host/src/host'
import { replayFrame } from '../../packages/addon-host/src/offline'
import type { AddonCommands, ModuleView } from './commands'
import { actionMessage } from './messages'

/** Native shell supplies an authenticated, fixed command adapter and binding revision. */
export function AddonManager({
  commands,
  bindingRevision
}: {
  commands: AddonCommands
  bindingRevision: string
}) {
  const [modules, setModules] = useState<AddonSummary[]>([])
  const [staged, setStaged] = useState<{
    digest: string
    manifest: AddonManifest
  } | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [savedView, setView] = useState<{
    revision: string
    data: ModuleView
  } | null>(null)
  const view = savedView?.revision === bindingRevision ? savedView.data : null
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [deleteData, setDeleteData] = useState(false)
  const revision = useRef(bindingRevision)
  revision.current = bindingRevision

  useEffect(() => {
    let cancelled = false
    setView(null)
    setPlaying(false)
    setStaged(null)
    setMessage('')
    setBusy(false)
    commands
      .list()
      .then((items) => {
        if (!cancelled) setModules(items)
      })
      .catch((error: unknown) => {
        if (!cancelled) setMessage(actionMessage(error))
      })
    return () => {
      cancelled = true
    }
  }, [commands, bindingRevision])

  useEffect(() => {
    if (!playing || view?.addonId !== 'replays') return
    const timer = setInterval(
      () =>
        setTime((current) => {
          const next = Math.min(current + 100, view.replay.durationMs)
          if (next === view.replay.durationMs) setPlaying(false)
          return next
        }),
      100
    )
    return () => clearInterval(timer)
  }, [playing, view])

  async function action(work: (isCurrent: () => boolean) => Promise<void>) {
    const started = revision.current
    const isCurrent = () => started === revision.current
    setBusy(true)
    setMessage('')
    try {
      await work(isCurrent)
      const items = await commands.list()
      if (started === revision.current) setModules(items)
    } catch (error) {
      if (started === revision.current) setMessage(actionMessage(error))
    } finally {
      if (started === revision.current) setBusy(false)
    }
  }
  async function chooseFile(
    file: File | undefined,
    id?: AddonId,
    canRead = true
  ) {
    if (!file) return
    const started = revision.current
    await action(async () => {
      if (file.size > (id ? 2_097_152 : 12_582_912))
        throw new Error('Unsupported file size')
      const content = await file.text()
      if (started !== revision.current) return
      if (id) {
        await commands.importLocalData(id, content)
        // Import and read are independent permissions: only open the view when read was granted.
        if (!canRead) return
        const result = await commands.view(id)
        if (started === revision.current) {
          setView({ revision: started, data: result })
          setTime(0)
          setPlaying(false)
        }
      } else {
        const result = await commands.stagePackage(content)
        if (started === revision.current) setStaged(result)
      }
    })
  }
  const frame =
    view?.addonId === 'replays' ? replayFrame(view.replay, time) : null

  return (
    <section aria-label="Local add-ons">
      <h1>Local add-ons</h1>
      <p>
        Install a reviewed signed package, then import supported local JSON.
        Imported data is unverified and stays in the current local workspace.
      </p>
      <p>
        Connected Guild War acquisition and replay capture are unavailable until
        a supported device method is approved. Official API access is configured
        separately during workspace setup.
      </p>
      <label>
        Choose signed package{' '}
        <input
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(event) => {
            void chooseFile(event.target.files?.[0])
            event.target.value = ''
          }}
        />
      </label>
      {staged && (
        <div role="group" aria-label="Review package permissions">
          <h2>
            {staged.manifest.addonId === 'guild-war' ? 'Guild War' : 'Replays'}{' '}
            {staged.manifest.version}
          </h2>
          <p>
            Requested permissions: {staged.manifest.capabilities.join(', ')}.
            Installing does not connect an account or enable sharing.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void action(async (isCurrent) => {
                await commands.activate(
                  staged.digest,
                  staged.manifest.capabilities
                )
                if (!isCurrent()) return
                setStaged(null)
                setView(null)
                setPlaying(false)
              })
            }
          >
            Approve and install
          </button>
          <button disabled={busy} onClick={() => setStaged(null)}>
            Cancel
          </button>
        </div>
      )}
      <label>
        <input
          type="checkbox"
          checked={deleteData}
          onChange={(event) => setDeleteData(event.target.checked)}
        />{' '}
        Delete module data when uninstalling (other local data is retained)
      </label>
      {modules.map((module) => (
        <article key={module.addonId}>
          <h2>
            {module.addonId === 'guild-war' ? 'Guild War' : 'Replays'}{' '}
            {module.version}
          </h2>
          <p>
            {module.unavailable
              ? 'Unavailable — package is no longer trusted. You can uninstall it.'
              : module.enabled
                ? 'Enabled'
                : 'Disabled — local data retained'}
          </p>
          <button
            disabled={busy || module.unavailable}
            onClick={() =>
              void action(async (isCurrent) => {
                await commands.setEnabled(module.addonId, !module.enabled)
                if (!isCurrent()) return
                setView(null)
                setPlaying(false)
              })
            }
          >
            {module.enabled ? 'Disable' : 'Enable'}
          </button>
          <button
            disabled={busy || module.unavailable || !module.hasPrevious}
            onClick={() =>
              void action(async (isCurrent) => {
                await commands.rollback(module.addonId)
                if (!isCurrent()) return
                setView(null)
                setPlaying(false)
              })
            }
          >
            Restore previous version
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void action(async (isCurrent) => {
                await commands.uninstall(
                  module.addonId,
                  deleteData ? 'delete' : 'retain'
                )
                if (!isCurrent()) return
                setView(null)
                setPlaying(false)
              })
            }
          >
            Uninstall{' '}
            {deleteData ? 'and delete module data' : 'and retain module data'}
          </button>
          <label>
            Import{' '}
            {module.addonId === 'guild-war' ? 'war summary' : 'replay timeline'}{' '}
            JSON{' '}
            <input
              type="file"
              accept="application/json,.json"
              disabled={
                busy ||
                !module.enabled ||
                !module.capabilities.includes('offline.import')
              }
              onChange={(event) => {
                void chooseFile(
                  event.target.files?.[0],
                  module.addonId,
                  module.capabilities.includes('offline.read')
                )
                event.target.value = ''
              }}
            />
          </label>
          <button
            disabled={
              busy ||
              !module.enabled ||
              !module.capabilities.includes('offline.read')
            }
            onClick={() =>
              void action(async () => {
                const started = revision.current
                const result = await commands.view(module.addonId)
                if (started === revision.current) {
                  setView({ revision: started, data: result })
                  setTime(0)
                  setPlaying(false)
                }
              })
            }
          >
            Open retained local data
          </button>
        </article>
      ))}
      {view?.addonId === 'guild-war' && (
        <div>
          <h2>Local war report — unverified</h2>
          <p>
            Season {view.report.season}: {view.report.battles} battles,{' '}
            {view.report.points} points.
          </p>
          <table>
            <thead>
              <tr>
                <th>Player slot</th>
                <th>Battles</th>
                <th>Victories</th>
                <th>Points</th>
              </tr>
            </thead>
            <tbody>
              {view.report.players.map((player) => (
                <tr key={player.slot}>
                  <td>{player.slot}</td>
                  <td>{player.battles}</td>
                  <td>{player.victories}</td>
                  <td>{player.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>Zone totals</h3>
          {view.report.zones.length === 0 ? (
            <p>No zone activity in this imported report.</p>
          ) : (
            <table aria-label="Zone totals">
              <thead>
                <tr>
                  <th scope="col">Zone</th>
                  <th scope="col">Battles</th>
                  <th scope="col">Points</th>
                </tr>
              </thead>
              <tbody>
                {view.report.zones.map((zone) => (
                  <tr key={zone.zone}>
                    <td>{zone.zone}</td>
                    <td>{zone.battles}</td>
                    <td>{zone.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {view?.addonId === 'replays' && frame && (
        <div>
          <h2>Local timeline — unverified</h2>
          <p>
            This normalized format uses placeholder markers. Game replay
            binaries and 3D assets require the approved canonical decoder and
            asset release.
          </p>
          <button
            onClick={() => {
              if (time === view.replay.durationMs) setTime(0)
              setPlaying(!playing)
            }}
          >
            {playing ? 'Pause' : 'Play'}
          </button>
          <label>
            Playback position{' '}
            <input
              type="range"
              min={0}
              max={view.replay.durationMs}
              value={time}
              onChange={(event) => {
                setPlaying(false)
                setTime(Number(event.target.value))
              }}
            />
          </label>
          <p>
            {time} ms / {view.replay.durationMs} ms
          </p>
          <div
            style={{
              position: 'relative',
              width: 320,
              height: 320,
              border: '1px solid currentColor'
            }}
            aria-label="Placeholder replay board"
          >
            {frame.entities.map((entity) => (
              <span
                key={entity.entity}
                style={{
                  position: 'absolute',
                  left: `${entity.x}%`,
                  top: `${entity.y}%`
                }}
              >
                {entity.side === 'allies' ? '●' : '○'} {entity.entity} (
                {entity.hp})
              </span>
            ))}
          </div>
        </div>
      )}
      {message && <p role="alert">{message}</p>}
    </section>
  )
}
