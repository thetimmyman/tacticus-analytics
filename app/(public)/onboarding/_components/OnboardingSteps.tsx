import { Check } from 'lucide-react'
import clsx from 'clsx'

export interface OnboardingStepsProps {
  steps: string[]
  /** 0-based; earlier steps render as completed. */
  currentIndex: number
  className?: string
}

/** Only on sequential pages, not the choice screen or dashboard. */
export function OnboardingSteps({
  steps,
  currentIndex,
  className
}: OnboardingStepsProps) {
  return (
    <ol
      className={clsx('mb-6 flex items-center gap-2 sm:gap-3', className)}
      aria-label="Onboarding progress"
    >
      {steps.map((step, index) => {
        const isComplete = index < currentIndex
        const isCurrent = index === currentIndex
        const status = isComplete
          ? 'completed'
          : isCurrent
            ? 'current step'
            : 'upcoming'
        return (
          <li
            key={step}
            className="flex flex-1 items-center gap-2 last:flex-none"
            aria-current={isCurrent ? 'step' : undefined}
            aria-label={`${step}, ${status}`}
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={clsx(
                  'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[0.65rem] font-bold transition-colors',
                  isComplete && 'bg-[var(--success)] text-[var(--bg-primary)]',
                  isCurrent &&
                    'bg-[var(--accent)] text-[var(--bg-primary)] ring-2 ring-[color-mix(in_srgb,var(--accent)_40%,transparent)]',
                  !isComplete &&
                    !isCurrent &&
                    'border border-[var(--card-border)] text-[var(--text-secondary)]'
                )}
              >
                {isComplete ? (
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  index + 1
                )}
              </span>
              <span
                aria-hidden="true"
                className={clsx(
                  'text-xs font-semibold uppercase tracking-[0.14em]',
                  isCurrent ? 'inline' : 'hidden sm:inline',
                  isCurrent
                    ? 'text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)]'
                )}
              >
                {step}
              </span>
            </div>
            {index < steps.length - 1 && (
              <span
                aria-hidden="true"
                className={clsx(
                  'h-px flex-1',
                  isComplete ? 'bg-[var(--success)]' : 'bg-[var(--card-border)]'
                )}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}
