'use client'

import React, { useState, useRef } from 'react'
import { createPortal } from 'react-dom'

// Rendered outside the component tree to avoid clipping.
export function Tooltip({
  children,
  content
}: {
  children: React.ReactNode
  content: string
}) {
  const [isVisible, setIsVisible] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const triggerRef = useRef<HTMLDivElement>(null)
  const portalTarget =
    typeof document !== 'undefined' && typeof document.body !== 'undefined'
      ? document.body
      : null

  const handleMouseEnter = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPosition({
        x: rect.right + 8,
        y: rect.top + rect.height / 2 - 40 // Center vertically
      })
      setIsVisible(true)
    }
  }

  const handleMouseLeave = () => {
    setIsVisible(false)
  }

  const tooltipElement = isVisible ? (
    <div
      className="fixed z-[9999] w-64 p-3 text-xs bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg shadow-2xl text-white pointer-events-none whitespace-pre-line"
      style={{
        left: position.x,
        top: position.y
      }}
    >
      {content}
      <div
        className="absolute w-2 h-2 bg-[var(--card-bg)] border-l border-b border-[var(--card-border)] transform rotate-45"
        style={{
          top: '40px',
          left: '-4px'
        }}
      />
    </div>
  ) : null

  return (
    <>
      <div
        ref={triggerRef}
        className="inline-block cursor-help"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {children}
      </div>
      {portalTarget &&
        tooltipElement &&
        createPortal(tooltipElement, portalTarget)}
    </>
  )
}
