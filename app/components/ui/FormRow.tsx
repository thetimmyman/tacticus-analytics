import type { ReactNode } from 'react'
import { useId } from 'react'
import clsx from 'clsx'

interface FormRowRenderProps {
  labelId: string
  helperId?: string
  describedBy?: string
}

interface FormRowProps {
  label: ReactNode
  children: ReactNode | ((props: FormRowRenderProps) => ReactNode)
  helper?: ReactNode
  /** Right-hand slot on desktop (e.g. a status pill). */
  trailing?: ReactNode
  /** Links the label to the child control when it exposes an id. */
  htmlFor?: string
  className?: string
}

export function FormRow({
  label,
  children,
  helper,
  trailing,
  htmlFor,
  className
}: FormRowProps) {
  const generatedId = useId()
  const labelId = `${generatedId}-label`
  const helperId = helper ? `${generatedId}-helper` : undefined
  const renderedChildren =
    typeof children === 'function'
      ? children({ labelId, helperId, describedBy: helperId })
      : children
  const labelClassName =
    'text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-secondary-wh40k'

  return (
    <div
      className={clsx(
        'grid grid-cols-1 min-w-0 gap-2 py-2',
        'sm:grid-cols-[8rem_1fr] sm:gap-4 sm:items-start',
        className
      )}
    >
      <div className="flex flex-col gap-0.5">
        {htmlFor ? (
          <label id={labelId} htmlFor={htmlFor} className={labelClassName}>
            {label}
          </label>
        ) : (
          <span id={labelId} className={labelClassName}>
            {label}
          </span>
        )}
        {helper && (
          <span
            id={helperId}
            className="text-xs text-[color-mix(in_srgb,var(--text-secondary)_70%,transparent)]"
          >
            {helper}
          </span>
        )}
      </div>
      <div
        className="flex min-w-0 items-center gap-2"
        aria-labelledby={htmlFor ? undefined : labelId}
        aria-describedby={htmlFor ? undefined : helperId}
      >
        <div className="min-w-0 flex-1">{renderedChildren}</div>
        {trailing && <div className="shrink-0">{trailing}</div>}
      </div>
    </div>
  )
}
