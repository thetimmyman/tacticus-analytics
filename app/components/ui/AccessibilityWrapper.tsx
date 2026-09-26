'use client'

import React from 'react'
import { TooltipWrapper } from '@tacticus/ui-kit'

interface AccessibilityWrapperProps {
  tooltip?: string | React.ReactNode
  tooltipPosition?: 'top' | 'bottom' | 'left' | 'right'

  ariaLabel?: string
  ariaDescription?: string
  role?: string
  tabIndex?: number

  autoFocus?: boolean
  focusOnMount?: boolean

  ariaLive?: 'off' | 'polite' | 'assertive'
  srOnly?: string // Screen reader only text

  onKeyDown?: (event: React.KeyboardEvent) => void

  className?: string
  children: React.ReactNode
}

export function AccessibilityWrapper({
  tooltip,
  tooltipPosition = 'top',
  ariaLabel,
  ariaDescription,
  role,
  tabIndex,
  autoFocus,
  focusOnMount,
  ariaLive,
  srOnly,
  onKeyDown,
  className,
  children
}: AccessibilityWrapperProps) {
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if ((autoFocus || focusOnMount) && ref.current) {
      const focusableElement = ref.current.querySelector(
        'button, input, select, textarea, a, [tabindex]:not([tabindex="-1"])'
      )
      if (focusableElement instanceof HTMLElement) {
        focusableElement.focus()
      }
    }
  }, [autoFocus, focusOnMount])

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (onKeyDown) {
      onKeyDown(event)
    }

    if (event.key === 'Enter' || event.key === ' ') {
      // A wrapped button gets its click triggered.
      const button = event.currentTarget.querySelector('button')
      if (button && event.target === event.currentTarget) {
        event.preventDefault()
        button.click()
      }
    }
  }

  const accessibilityProps = {
    'aria-label': ariaLabel,
    'aria-describedby': ariaDescription,
    'aria-live': ariaLive,
    role,
    tabIndex,
    onKeyDown: onKeyDown || role ? handleKeyDown : undefined,
    className
  }

  const filteredProps = Object.fromEntries(
    Object.entries(accessibilityProps).filter(
      ([_, value]) => value !== undefined
    )
  )

  const content = (
    <div ref={ref} {...filteredProps}>
      {/* Screen reader only text */}
      {srOnly && <span className="sr-only">{srOnly}</span>}
      {children}
    </div>
  )

  if (tooltip) {
    return (
      <TooltipWrapper tooltip={tooltip} position={tooltipPosition}>
        {content}
      </TooltipWrapper>
    )
  }

  return content
}

interface ButtonWrapperProps extends Omit<
  AccessibilityWrapperProps,
  'role' | 'tabIndex'
> {
  disabled?: boolean
  loading?: boolean
  loadingText?: string
}

export function ButtonAccessibilityWrapper({
  disabled,
  loading,
  loadingText,
  tooltip,
  ariaLabel,
  children,
  ...props
}: ButtonWrapperProps) {
  let enhancedTooltip = tooltip
  if (disabled && !tooltip) {
    enhancedTooltip = 'This button is currently disabled'
  } else if (loading && !tooltip) {
    enhancedTooltip = loadingText || 'Please wait, processing...'
  }

  let enhancedAriaLabel = ariaLabel
  if (loading && ariaLabel) {
    enhancedAriaLabel = `${ariaLabel} - ${loadingText || 'Loading'}`
  }

  return (
    <AccessibilityWrapper
      {...props}
      tooltip={enhancedTooltip}
      ariaLabel={enhancedAriaLabel}
      role="button"
      tabIndex={disabled ? -1 : 0}
    >
      {children}
    </AccessibilityWrapper>
  )
}
