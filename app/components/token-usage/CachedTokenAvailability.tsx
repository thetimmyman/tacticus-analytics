'use client'

import type { GuildTokenAvailabilityRow } from './types'
import { formatShortDuration } from './utils'

export function CachedTokenAvailability({
  rows,
  computedAt,
  refresh
}: {
  rows: GuildTokenAvailabilityRow[]
  computedAt: string | null
  refresh: () => void
}) {
  return (
    <section
      className="card-wh40k p-4 space-y-3"
      aria-label="Saved token availability"
    >
      <h2 className="text-xl font-semibold">Saved token availability</h2>
      <p className="text-sm text-secondary-wh40k" role="status">
        Calculated from saved local snapshots and battle history. No live API
        request.
        {computedAt && (
          <> Calculated at {new Date(computedAt).toISOString()}.</>
        )}
      </p>
      <button type="button" onClick={refresh} className="button-wh40k">
        Recalculate saved data
      </button>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {[
                'Member',
                'Tokens available',
                'Next token',
                'Bombs available',
                'Next bomb',
                'Lost tokens at cap',
                'Time at cap',
                'Source',
                'Saved snapshot'
              ].map((label) => (
                <th key={label} scope="col" className="p-2 text-left">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.player_id}>
                <th scope="row" className="p-2 text-left">
                  {row.display_name}
                </th>
                <td className="p-2">{row.tokens_available} / 3</td>
                <td className="p-2">
                  {formatShortDuration(row.token_next_in_seconds) ??
                    (row.tokens_available >= 3 ? 'At cap' : 'Unavailable')}
                </td>
                <td className="p-2">{row.bombs_available} / 1</td>
                <td className="p-2">
                  {formatShortDuration(row.bomb_next_in_seconds) ??
                    (row.bombs_available >= 1 ? 'At cap' : 'Unavailable')}
                </td>
                <td className="p-2">{row.burned_tokens ?? 'Unavailable'}</td>
                <td className="p-2">
                  {formatShortDuration(row.time_over_cap_seconds) ??
                    'Unavailable'}
                </td>
                <td className="p-2">
                  {row.data_source === 'cached'
                    ? 'Saved snapshot projection'
                    : 'Saved battle history'}
                </td>
                <td className="p-2">
                  {row.last_sync_at
                    ? new Date(row.last_sync_at).toISOString()
                    : 'No snapshot'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
