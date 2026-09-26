import type { ReactNode } from 'react'
import clsx from 'clsx'

interface ScreenReaderOnlyProps {
  children: ReactNode
  as?: 'span' | 'div' | 'p'
  className?: string
}

export function ScreenReaderOnly({
  children,
  as: Element = 'span',
  className
}: ScreenReaderOnlyProps) {
  return <Element className={clsx('sr-only', className)}>{children}</Element>
}
