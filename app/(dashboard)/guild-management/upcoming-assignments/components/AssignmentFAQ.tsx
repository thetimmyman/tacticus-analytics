'use client'

interface AssignmentFAQProps {
  show: boolean
  setShow: (show: boolean) => void
  seasonDescriptor: string
}

// Role-neutral copy: the queue is automatic and behaviour is set on Targets.
export function AssignmentFAQ({
  show,
  setShow,
  seasonDescriptor
}: AssignmentFAQProps) {
  return (
    <div className="bg-card/50 rounded-lg p-6 border border-[color-mix(in_srgb,var(--primary)_20%,transparent)]">
      <button
        onClick={() => setShow(!show)}
        className="w-full flex items-center justify-between text-left group"
      >
        <h2 className="text-lg font-semibold text-(--primary) group-hover:text-[color-mix(in_srgb,var(--primary)_80%,transparent)] transition-colors">
          How Boss Assignment Works
        </h2>
        <svg
          className={`h-5 w-5 text-(--primary) transform transition-transform ${show ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {show && (
        <div className="mt-6 space-y-6 text-sm text-amber-100/80">
          <div>
            <h3 className="text-base font-semibold text-(--primary) mb-2">
              The queue is computed for you
            </h3>
            <p>
              There is no manual assignment step. The solver reads each
              player&apos;s recent damage history against this season&apos;s
              bosses and lays out who should spend tokens where. It refreshes
              automatically — you do not build or save the queue by hand.
            </p>
          </div>

          <div>
            <h3 className="text-base font-semibold text-(--primary) mb-2">
              Change per-boss behaviour on the Targets tab
            </h3>
            <p>
              How a boss is handled — the token count to target, or skipping a
              boss entirely — is configured on the{' '}
              <span className="font-medium text-(--primary)">Targets</span> tab.
              The queue recomputes from those targets, so adjust a target there
              and the plan below follows.
            </p>
          </div>

          <div>
            <h3 className="text-base font-semibold text-(--primary) mb-2">
              The season selector focuses one season
            </h3>
            <p>
              Pick a season to focus the queue on it. The{' '}
              <span className="font-medium text-green-400">live season</span>{' '}
              shows the interactive queue with real attack data as tokens land;
              other seasons show a{' '}
              <span className="font-medium">planning projection</span> built
              from historical performance.
            </p>
          </div>

          <div>
            <h3 className="text-base font-semibold text-(--primary) mb-2">
              Reading the queue
            </h3>
            <ul className="space-y-2 text-xs">
              <li className="flex items-start">
                <span className="text-(--primary) mr-2">•</span>
                <div>
                  Each stage card lists the assigned attackers with their
                  planned vs. used tokens, expected damage, and status.
                </div>
              </li>
              <li className="flex items-start">
                <span className="text-(--primary) mr-2">•</span>
                <div>
                  The headline panel at the top tracks the current live boss and
                  updates as attacks land.
                </div>
              </li>
              <li className="flex items-start">
                <span className="text-(--primary) mr-2">•</span>
                <div>
                  Plans for the {seasonDescriptor} persist automatically — there
                  is nothing to save.
                </div>
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
