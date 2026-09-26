import React from 'react'
import { Tooltip } from './Tooltip'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  tooltip?: string | React.ReactNode
  tooltipPosition?: 'top' | 'bottom' | 'left' | 'right'
  loading?: boolean
  loadingText?: string
  children: React.ReactNode
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'default',
      size = 'md',
      className = '',
      tooltip,
      tooltipPosition = 'top',
      loading = false,
      loadingText = 'Loading...',
      children,
      ...props
    },
    ref
  ) => {
    const baseClasses =
      'inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50 disabled:pointer-events-none'

    const variantClasses = {
      default:
        'bg-[var(--accent)] text-[var(--bg-primary)] hover:bg-[color-mix(in_srgb,var(--accent)_90%,transparent)]',
      outline:
        'border border-[var(--card-border)] bg-transparent text-[var(--text-primary)] hover:bg-[var(--card-bg)]',
      ghost:
        'text-[var(--text-primary)] hover:bg-[var(--card-bg)] hover:text-[var(--text-primary)]'
    }

    const sizeClasses = {
      sm: 'h-8 px-3 text-xs',
      md: 'h-10 px-4 py-2',
      lg: 'h-12 px-8 text-base'
    }

    const enhancedTooltip = loading && !tooltip ? loadingText : tooltip

    const button = (
      <button
        ref={ref}
        className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
        disabled={loading || props.disabled}
        aria-busy={loading}
        {...props}
      >
        {loading && (
          <div className="relative -ml-1 mr-3 h-4 w-4">
            {/* Sacred Mechanicus gear */}
            <svg
              className="animate-spin h-4 w-4 text-red-500"
              style={{ animationDuration: '2s' }}
              xmlns="http://www.w3.org/2000/svg"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              {/* Outer gear teeth */}
              <path d="M12,1L15.09,8.26L22,9L17,14L18.18,21L12,17.77L5.82,21L7,14L2,9L8.91,8.26L12,1Z" />
              {/* Inner gear ring */}
              <circle
                cx="12"
                cy="12"
                r="4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                opacity="0.7"
              />
              {/* Center cogitator */}
              <rect
                x="10"
                y="10"
                width="4"
                height="4"
                rx="0.5"
                fill="currentColor"
                opacity="0.9"
              />
            </svg>
            {/* Counter-rotating inner gear */}
            <svg
              className="absolute inset-0 animate-spin h-4 w-4 text-yellow-500"
              style={{
                animationDuration: '1.5s',
                animationDirection: 'reverse'
              }}
              xmlns="http://www.w3.org/2000/svg"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <circle
                cx="12"
                cy="12"
                r="6"
                fill="none"
                stroke="currentColor"
                strokeWidth="0.5"
                opacity="0.4"
              />
              {/* Sacred wrench symbol */}
              <path
                d="M6.5 10.5l2-2 3 3-2 2-3-3z M17.5 6.5l-2 2-3-3 2-2 3 3z"
                opacity="0.6"
              />
            </svg>
            {/* Blessed indicator light */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-1 h-1 bg-red-400 rounded-full animate-pulse" />
            </div>
          </div>
        )}
        {loading ? loadingText : children}
      </button>
    )

    if (enhancedTooltip) {
      return (
        <Tooltip content={enhancedTooltip} position={tooltipPosition}>
          {button}
        </Tooltip>
      )
    }

    return button
  }
)

Button.displayName = 'Button'
