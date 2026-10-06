'use client'

import { useState } from 'react'

export type ContributionPolicy = {
  revision: number
  enabled: boolean
  paused: boolean
  datasets: { raid: boolean; war: boolean; replay: boolean }
}
export type ContributionControlAdapter = {
  changePolicy: (policy: ContributionPolicy) => Promise<void>
  inspectQueue: () => Promise<string>
  previewFields: () => Promise<string>
  requestOfficialReadEnrollment: () => Promise<void>
  revokeEnrollment: () => Promise<void>
  deleteContributions: () => Promise<void>
}

// The installed runtime supplies this handle-only adapter, bound to a guild/account.
export function ContributionControls({
  initialPolicy,
  adapter
}: {
  initialPolicy: ContributionPolicy
  adapter: ContributionControlAdapter
}) {
  const [policy, setPolicy] = useState(initialPolicy)
  const [detail, setDetail] = useState(
    'Local only. No contribution requests are scheduled.'
  )
  const [busy, setBusy] = useState(false)
  const [previewed, setPreviewed] = useState(false)
  const [enrollmentConsent, setEnrollmentConsent] = useState(false)
  async function run(action: () => Promise<void>) {
    setBusy(true)
    try {
      await action()
    } catch {
      setDetail('The action could not finish. Local data remains available.')
    } finally {
      setBusy(false)
    }
  }
  async function update(next: ContributionPolicy) {
    const revised = { ...next, revision: policy.revision + 1 }
    await adapter.changePolicy(revised)
    setPolicy(revised)
    setDetail(
      revised.enabled
        ? 'Contribution settings saved. Only selected data may be sent.'
        : 'Future contributions stopped. Previously sent data can be deleted separately.'
    )
  }
  return (
    <section aria-label="Meta contribution">
      <h2>Contribute to meta analysis</h2>
      <p>
        Local connection, guild portal publishing and diagnostics have separate
        settings. Contribution is optional. Pseudonymous records are not
        anonymous.
      </p>
      <p>
        Raids can be compared with official API records. Wars and replays remain
        unverified and are excluded from verified totals. Raw replays are never
        contributed.
      </p>
      <button
        disabled={busy}
        onClick={() =>
          run(async () => {
            setDetail(await adapter.previewFields())
            setPreviewed(true)
          })
        }
      >
        Preview exact fields and identifiers
      </button>
      <fieldset disabled={busy}>
        <legend>Datasets for this account and guild</legend>
        {(['raid', 'war', 'replay'] as const).map((dataset) => (
          <label key={dataset}>
            <input
              type="checkbox"
              checked={policy.datasets[dataset]}
              onChange={(event) => {
                const checked = event.target.checked
                void run(() =>
                  update({
                    ...policy,
                    datasets: { ...policy.datasets, [dataset]: checked }
                  })
                )
              }}
            />
            {dataset === 'raid'
              ? 'Raids'
              : dataset === 'war'
                ? 'Wars (unverified)'
                : 'Replays (unverified)'}
          </label>
        ))}
        <label>
          <input
            type="checkbox"
            checked={policy.enabled}
            disabled={!previewed && !policy.enabled}
            onChange={(event) => {
              const checked = event.target.checked
              void run(() => update({ ...policy, enabled: checked }))
            }}
          />
          Enable future contribution
        </label>
        <label>
          <input
            type="checkbox"
            checked={policy.paused}
            onChange={(event) => {
              const checked = event.target.checked
              void run(() => update({ ...policy, paused: checked }))
            }}
          />
          Pause contribution
        </label>
      </fieldset>
      <p>
        Verification enrollment separately shares an official Guild/Guild Raid
        read credential with a protected service for up to 24 hours. Your game
        session secret stays on this device. A secure native dialog accepts the
        official key; this page never receives it.
      </p>
      <label>
        <input
          type="checkbox"
          checked={enrollmentConsent}
          onChange={(event) => setEnrollmentConsent(event.target.checked)}
        />
        I separately consent to official read credential enrollment for
        verification.
      </label>
      <button
        disabled={busy || !enrollmentConsent || !previewed}
        onClick={() =>
          run(async () => {
            await adapter.requestOfficialReadEnrollment()
            setEnrollmentConsent(false)
            setDetail('Official read access enrolled for verification.')
          })
        }
      >
        Enroll through secure input
      </button>
      <button
        disabled={busy}
        onClick={() =>
          run(async () => {
            setDetail(await adapter.inspectQueue())
          })
        }
      >
        Inspect queue and receipts
      </button>
      <button
        disabled={busy}
        onClick={() =>
          run(async () => {
            await adapter.revokeEnrollment()
            setDetail('Verification access revoked. Local data retained.')
          })
        }
      >
        Revoke verification access
      </button>
      <button
        disabled={busy}
        onClick={() =>
          run(async () => {
            await adapter.deleteContributions()
            setDetail(
              'Contributed source data deleted and derived results recomputed.'
            )
          })
        }
      >
        Delete previously contributed data
      </button>
      <p>
        Pending uploads expire after seven days. Source records expire after 30
        days. In-flight bytes cannot be recalled; receipts show delivery after
        revocation.
      </p>
      <pre aria-live="polite">{detail}</pre>
    </section>
  )
}
