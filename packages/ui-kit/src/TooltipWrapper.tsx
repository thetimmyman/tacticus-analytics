'use client'

import React from 'react'
import { Tooltip } from './Tooltip'

interface TooltipWrapperProps {
  tooltip: string | React.ReactNode
  position?: 'top' | 'bottom' | 'left' | 'right'
  delay?: number
  disabled?: boolean
  className?: string
  children: React.ReactNode
}

export function TooltipWrapper({
  tooltip,
  position = 'top',
  delay = 500,
  disabled = false,
  className,
  children
}: TooltipWrapperProps) {
  if (!tooltip || disabled) {
    return <>{children}</>
  }

  return (
    <Tooltip
      content={tooltip}
      position={position}
      delay={delay}
      className={className}
    >
      {children}
    </Tooltip>
  )
}
