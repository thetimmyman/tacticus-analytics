'use client'

import React from 'react'
import { brandColors, BrandType } from './brand-buttons'
import { Tooltip } from '@tacticus/ui-kit'

interface BrandButtonProps {
  brand?: BrandType
  variant?: 'primary' | 'secondary'
  size?: 'sm' | 'md' | 'lg'
  showIcon?: boolean
  as?: 'button' | 'a'
  tooltip?: string | React.ReactNode
  tooltipPosition?: 'top' | 'bottom' | 'left' | 'right'
  className?: string
  children: React.ReactNode
  [key: string]: any // For additional props like onClick, href, etc.
}

export function DiscordButton({
  children,
  ...props
}: Omit<BrandButtonProps, 'brand'>) {
  return (
    <BrandButton {...props} brand="discord">
      {children}
    </BrandButton>
  )
}

function BrandButton({
  brand = 'discord',
  variant = 'primary',
  size = 'md',
  showIcon = false,
  as = 'button',
  tooltip,
  tooltipPosition = 'top',
  className = '',
  children,
  ...otherProps
}: BrandButtonProps) {
  const colors = brandColors[brand]

  const sizeStyles = {
    sm: 'min-h-11 min-w-11 px-3 py-2 text-sm',
    md: 'min-h-11 px-4 py-2 text-base',
    lg: 'min-h-12 px-6 py-3 text-lg'
  }

  const baseStyles = `
    inline-flex items-center justify-center
    font-medium rounded-lg transition-all duration-200
    border border-transparent
    focus:outline-hidden focus:ring-2 focus:ring-offset-2
    disabled:opacity-50 disabled:cursor-not-allowed
    ${sizeStyles[size]}
  `

  const brandStyles =
    variant === 'primary'
      ? `
      bg-[${colors.primary}] hover:bg-[${colors.hover}]
      text-[${colors.text}]
      focus:ring-[${colors.primary}]/50
    `
      : `
      bg-transparent hover:bg-[${colors.primary}]/10
      text-[${colors.primary}] border-[${colors.primary}]
      focus:ring-[${colors.primary}]/50
    `

  const inlineStyles =
    variant === 'primary'
      ? ({
          backgroundColor: colors.primary,
          color: colors.text,
          borderColor: colors.primary,
          '--hover-bg': colors.hover
        } as React.CSSProperties)
      : ({
          backgroundColor: 'transparent',
          color: colors.primary,
          borderColor: colors.primary,
          '--hover-bg': `${colors.primary}10`
        } as React.CSSProperties)

  const finalClassName = `${baseStyles} ${brandStyles} ${className}`.trim()

  const commonProps = {
    className: finalClassName,
    style: {
      ...inlineStyles,
      ...otherProps.style
    },
    'aria-describedby': tooltip
      ? `tooltip-${Math.random().toString(36).substr(2, 9)}`
      : undefined,
    ...otherProps
  }

  const DiscordIcon = () => (
    <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 24 24">
      <path d="M20.317 4.492c-1.53-.69-3.17-1.2-4.885-1.49a.075.075 0 0 0-.079.036c-.211.369-.444.85-.608 1.23a18.566 18.566 0 0 0-5.487 0 12.36 12.36 0 0 0-.617-1.23A.077.077 0 0 0 8.562 3c-1.714.29-3.354.8-4.885 1.491a.07.07 0 0 0-.032.027C.533 9.093-.32 13.555.099 17.961a.08.08 0 0 0 .031.054 20.03 20.03 0 0 0 5.993 2.98.078.078 0 0 0 .084-.026 13.83 13.83 0 0 0 1.226-1.963.074.074 0 0 0-.041-.104 13.201 13.201 0 0 1-1.872-.878.075.075 0 0 1-.008-.125 10.2 10.2 0 0 0 .372-.288.072.072 0 0 1 .077-.01c3.927 1.764 8.18 1.764 12.061 0a.072.072 0 0 1 .078.009 9.63 9.63 0 0 0 .372.29.075.075 0 0 1-.006.125 12.299 12.299 0 0 1-1.873.876.075.075 0 0 0-.041.105c.36.687.772 1.341 1.225 1.962a.077.077 0 0 0 .084.028 19.963 19.963 0 0 0 6.002-2.981.076.076 0 0 0 .032-.054c.5-5.094-.838-9.52-3.549-13.442a.06.06 0 0 0-.031-.028zM8.02 15.278c-1.182 0-2.157-1.069-2.157-2.38 0-1.312.956-2.38 2.157-2.38 1.21 0 2.176 1.077 2.157 2.38 0 1.312-.956 2.38-2.157 2.38zm7.975 0c-1.183 0-2.157-1.069-2.157-2.38 0-1.312.955-2.38 2.157-2.38 1.21 0 2.176 1.077 2.157 2.38 0 1.312-.946 2.38-2.157 2.38z" />
    </svg>
  )

  const content = (
    <>
      {showIcon && brand === 'discord' && <DiscordIcon />}
      {children}
    </>
  )

  const element =
    as === 'a' ? (
      <a {...commonProps}>{content}</a>
    ) : (
      <button {...commonProps}>{content}</button>
    )

  if (tooltip) {
    return (
      <Tooltip content={tooltip} position={tooltipPosition}>
        {element}
      </Tooltip>
    )
  }

  return element
}

export default BrandButton
