'use client'

import { Input, Label } from '@tacticus/ui-kit'

import { LANGUAGES, TIMEZONES, type StepProps } from '../_lib/cluster-types'

export function StepBasicInfo({ data, setData, errors = {} }: StepProps) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">
        Basic Information
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label>Cluster Code*</Label>
          <Input
            value={data.clusterCode}
            onChange={(e) =>
              setData({ ...data, clusterCode: e.target.value.toUpperCase() })
            }
            placeholder="e.g., APEX, NOVA"
            maxLength={10}
          />
          {errors.clusterCode && (
            <p className="text-red-400 text-sm mt-1">{errors.clusterCode}</p>
          )}
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            2-10 uppercase letters/numbers. This will be your cluster&apos;s ID
            and abbreviation.
          </p>
        </div>

        <div>
          <Label>Display Name*</Label>
          <Input
            value={data.displayName}
            onChange={(e) => setData({ ...data, displayName: e.target.value })}
            placeholder="e.g., Apex Alliance"
          />
          {errors.displayName && (
            <p className="text-red-400 text-sm mt-1">{errors.displayName}</p>
          )}
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            The full name that will be shown in the UI
          </p>
        </div>

        <div>
          <Label>Timezone</Label>
          <select
            value={data.timezone}
            onChange={(e) => setData({ ...data, timezone: e.target.value })}
            className="w-full px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--card-border)] rounded"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label>Primary Language</Label>
          <select
            value={data.primaryLanguage}
            onChange={(e) =>
              setData({ ...data, primaryLanguage: e.target.value })
            }
            className="w-full px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--card-border)] rounded"
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <Label>Tagline</Label>
        <Input
          value={data.tagline}
          onChange={(e) => setData({ ...data, tagline: e.target.value })}
          placeholder="Your cluster's motto or tagline"
        />
      </div>

      <div>
        <Label>Description</Label>
        <textarea
          value={data.description}
          onChange={(e) => setData({ ...data, description: e.target.value })}
          placeholder="Describe your cluster's mission and values..."
          className="w-full px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--card-border)] rounded h-24 resize-none"
        />
      </div>
    </div>
  )
}
