export function WarsFAQ() {
  return (
    <details
      className="card-wh40k p-4 sm:p-6 mt-6 group"
      data-component="wars-faq"
    >
      <summary className="flex items-center justify-between w-full text-left py-2 sm:py-0 min-h-[44px] sm:min-h-0 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <h3 className="text-lg sm:text-xl font-bold text-[var(--text-primary)] group-open:text-[var(--primary)] transition-colors pr-2">
          How War Analytics Work
        </h3>
        <div className="transition-transform duration-200 flex-shrink-0 group-open:rotate-180">
          <svg
            className="w-6 h-6 sm:w-5 sm:h-5 text-[var(--text-secondary)]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </summary>

      <div className="space-y-5 sm:space-y-6 pt-4 border-t border-[var(--card-border)]">
        {/* Data Source */}
        <div className="space-y-2">
          <h4 className="text-base sm:text-lg font-semibold text-[var(--accent)] flex items-center gap-2">
            <span className="w-2 h-2 bg-[var(--accent)] rounded-full flex-shrink-0" />
            Data Source &amp; Season Filtering
          </h4>
          <div className="pl-4 space-y-2 text-xs sm:text-sm text-[var(--text-secondary)]">
            <p>
              All analytics read from{' '}
              <code className="text-[var(--text-primary)]">
                guild_war_battles
              </code>{' '}
              — one row per attack attempt. Data is scoped to your guild and
              filtered to the last <strong>4 war seasons</strong> by default
              (configurable in some views). Seasons are numbered sequentially;
              each contains 6 wars.
            </p>
            <p>
              Hero keys in the raw battle data are in camelCase format (e.g.,{' '}
              <code>ultraTigurius</code>, <code>blackHaarken</code>) matching
              the Loki game API&apos;s <code>unitId</code> field. These are
              resolved to display names and portrait icons via the{' '}
              <code>hero_mappings</code> catalog.
            </p>
          </div>
        </div>

        {/* War Reports */}
        <div className="space-y-2">
          <h4 className="text-base sm:text-lg font-semibold text-[var(--accent)] flex items-center gap-2">
            <span className="w-2 h-2 bg-[var(--accent)] rounded-full flex-shrink-0" />
            War Reports (Dashboard)
          </h4>
          <div className="pl-4 space-y-1 text-xs sm:text-sm text-[var(--text-secondary)]">
            <p>
              Lists all synced wars for your guild from{' '}
              <code>guild_war_matches</code>. Each row shows the opponent, final
              score, result, and a link to the detailed war view. The detailed
              view aggregates player attack stats and zone breakdown from{' '}
              <code>guild_war_battles</code> for that specific war.
            </p>
          </div>
        </div>

        {/* Maps */}
        <div className="space-y-2">
          <h4 className="text-base sm:text-lg font-semibold text-[var(--accent)] flex items-center gap-2">
            <span className="w-2 h-2 bg-[var(--accent)] rounded-full flex-shrink-0" />
            Maps
          </h4>
          <div className="pl-4 space-y-1 text-xs sm:text-sm text-[var(--text-secondary)]">
            <p>
              Zone-level win rates and average scores across all historical
              wars, grouped by zone type (e.g., Trenches, Fortress, Sanctuary).
              Useful for identifying which zone types your guild consistently
              wins or struggles with. Stats are split into offense (your guild
              attacking) and defense (opponents attacking your zones).
            </p>
          </div>
        </div>

        {/* Offense / Defense Heroes */}
        <div className="space-y-2">
          <h4 className="text-base sm:text-lg font-semibold text-[var(--accent)] flex items-center gap-2">
            <span className="w-2 h-2 bg-[var(--accent)] rounded-full flex-shrink-0" />
            Offense &amp; Defense Heroes — Hero Performance
          </h4>
          <div className="pl-4 space-y-2 text-xs sm:text-sm text-[var(--text-secondary)]">
            <p>
              Powered by the{' '}
              <code className="text-[var(--text-primary)]">
                get_hero_performance
              </code>{' '}
              database function. For each hero that appeared in an attack (or
              defense), it calculates:
            </p>
            <ul className="list-disc pl-4 space-y-1">
              <li>
                <strong>Uses</strong> — total appearances in completed battles
              </li>
              <li>
                <strong>Win rate</strong> — wins / total uses
              </li>
              <li>
                <strong>Avg score</strong> — mean score earned across all uses
              </li>
              <li>
                <strong>Avg kills</strong> — mean units eliminated (requires
                kill_count to be populated in the sync; older records show
                &mdash;)
              </li>
            </ul>
            <p>
              Hero keys are extracted from the <code>attacker_units_json</code>{' '}
              (or <code>defender_units_json</code>) JSONB column using{' '}
              <code>
                COALESCE(h-&gt;&gt;&apos;heroKey&apos;,
                h-&gt;&gt;&apos;unitId&apos;)
              </code>{' '}
              since the field name differs by sync version.
            </p>
          </div>
        </div>

        {/* Lineups */}
        <div className="space-y-2">
          <h4 className="text-base sm:text-lg font-semibold text-[var(--accent)] flex items-center gap-2">
            <span className="w-2 h-2 bg-[var(--accent)] rounded-full flex-shrink-0" />
            Lineups
          </h4>
          <div className="pl-4 space-y-1 text-xs sm:text-sm text-[var(--text-secondary)]">
            <p>
              Shows the most-used attack (or defense) team compositions from{' '}
              <code>guild_war_lineups</code>. Lineups are identified by a{' '}
              <code>lineup_id</code> hash of the sorted hero keys, so the same
              5-hero team always maps to the same lineup regardless of slot
              order. Each lineup card shows win rate, total uses, and individual
              hero portraits.
            </p>
          </div>
        </div>

        {/* Cores */}
        <div className="space-y-2">
          <h4 className="text-base sm:text-lg font-semibold text-[var(--accent)] flex items-center gap-2">
            <span className="w-2 h-2 bg-[var(--accent)] rounded-full flex-shrink-0" />
            Cores — Composition Analysis
          </h4>
          <div className="pl-4 space-y-2 text-xs sm:text-sm text-[var(--text-secondary)]">
            <p>
              Powered by the{' '}
              <code className="text-[var(--text-primary)]">
                get_global_war_core_compositions
              </code>{' '}
              database function. A &quot;core&quot; is exactly three heroes that
              appear together across 5-hero lineups. Two-hero results are kept
              separate and explicitly labeled &quot;Pair synergy.&quot; The
              function:
            </p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Finds exact-size combinations within historical lineups</li>
              <li>
                Groups by sorted hero key hash (<code>core_id</code>)
              </li>
              <li>Reports total uses and win rate for each core</li>
              <li>
                Lists &quot;flex options&quot; — the additional heroes most
                commonly paired with each core, with their individual win rate
                contribution
              </li>
            </ul>
            <p className="text-xs text-[var(--text-tertiary)]">
              Rankings are global rather than guild- or cluster-scoped. The
              archived community aggregate contributes to 3-hero cores; other
              exact sizes use tracked first-party battles.
            </p>
          </div>
        </div>

        {/* Team Analysis */}
        <div className="space-y-2">
          <h4 className="text-base sm:text-lg font-semibold text-[var(--accent)] flex items-center gap-2">
            <span className="w-2 h-2 bg-[var(--accent)] rounded-full flex-shrink-0" />
            Team Analysis
          </h4>
          <div className="pl-4 space-y-2 text-xs sm:text-sm text-[var(--text-secondary)]">
            <p>
              Lets you select up to 5 heroes and look up their historical win
              rate as a lineup against all recorded opponents. Two hero pool
              sources are available:
            </p>
            <ul className="list-disc pl-4 space-y-1">
              <li>
                <strong className="text-[var(--text-primary)]">
                  Your Roster
                </strong>{' '}
                — heroes from your synced player roster, showing actual
                rank/star level. Portrait icons are resolved by matching the
                Loki API <code>hero.id</code> against{' '}
                <code>hero_mappings.unit_id</code>.
              </li>
              <li>
                <strong className="text-[var(--text-primary)]">
                  Full Catalog
                </strong>{' '}
                — all heroes in <code>hero_mappings</code>, regardless of
                whether you own them. Useful for scouting or planning.
              </li>
            </ul>
            <p>
              Win rate results are filtered to battles where <em>exactly</em>{' '}
              the selected lineup was used, with breakdowns by opponent team,
              zone type, and debuff level.
            </p>
          </div>
        </div>

        {/* Icon Resolution */}
        <div className="space-y-2">
          <h4 className="text-base sm:text-lg font-semibold text-[var(--accent)] flex items-center gap-2">
            <span className="w-2 h-2 bg-[var(--accent)] rounded-full flex-shrink-0" />
            Hero Icons &amp; Display Names
          </h4>
          <div className="pl-4 space-y-1 text-xs sm:text-sm text-[var(--text-secondary)]">
            <p>
              Hero portraits are resolved via the <code>hero_mappings</code>{' '}
              table, which stores Discord CDN icon URLs in{' '}
              <code>web_icon_url</code>. The catalog is fetched once per session
              and cached in localStorage for 24 hours. If icons appear as grey
              circles, the catalog may have a stale cache — a hard refresh
              (Ctrl+Shift+R) will force a reload.
            </p>
            <p>
              Hero IDs from the battle data (e.g., <code>ultraTigurius</code>)
              are matched against
              <code> hero_mappings.unit_id</code> using both exact match and
              normalized (lowercase, alphanumeric-only) fallback. Display names
              come from <code>hero_mappings.display_name</code>.
            </p>
          </div>
        </div>
      </div>
    </details>
  )
}
