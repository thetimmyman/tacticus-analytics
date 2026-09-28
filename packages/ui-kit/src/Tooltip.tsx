'use client'

import { ReactNode, useState, useRef, useCallback } from 'react'

interface TooltipProps {
  content: string | ReactNode
  children: ReactNode
  className?: string
  position?: 'top' | 'bottom' | 'left' | 'right'
  delay?: number
  disabled?: boolean
}

export function Tooltip({
  content,
  children,
  className = '',
  position = 'top',
  delay = 500,
  disabled = false
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  const handleMouseEnter = useCallback(() => {
    if (disabled) return
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true)
    }, delay)
  }, [disabled, delay])

  const handleMouseLeave = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    setIsVisible(false)
  }, [])

  const positionClasses = {
    top: 'bottom-full left-1/2 transform -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 transform -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 transform -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 transform -translate-y-1/2 ml-2'
  }

  const arrowClasses = {
    top: 'top-full left-1/2 transform -translate-x-1/2 border-t-(--card-bg)',
    bottom:
      'bottom-full left-1/2 transform -translate-x-1/2 border-b-(--card-bg)',
    left: 'left-full top-1/2 transform -translate-y-1/2 border-l-(--card-bg)',
    right: 'right-full top-1/2 transform -translate-y-1/2 border-r-(--card-bg)'
  }

  if (disabled || !content) {
    return <>{children}</>
  }

  return (
    <div className="relative inline-block">
      <div
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocus={handleMouseEnter}
        onBlur={handleMouseLeave}
      >
        {children}
      </div>

      {isVisible && (
        <div
          className={`absolute z-50 ${positionClasses[position]} pointer-events-none`}
          role="tooltip"
          aria-live="polite"
        >
          <div
            className={`bg-card/95 backdrop-blur-xs text-primary-wh40k text-sm rounded-lg px-3 py-2 shadow-xl border border-(--card-border) max-w-xs ${className}`}
          >
            {content}
            <div
              className={`absolute w-0 h-0 border-4 border-transparent ${arrowClasses[position]}`}
              style={{
                borderTopWidth: position === 'bottom' ? 0 : 4,
                borderBottomWidth: position === 'top' ? 0 : 4,
                borderLeftWidth: position === 'right' ? 0 : 4,
                borderRightWidth: position === 'left' ? 0 : 4
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
