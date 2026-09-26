'use client'

import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'

const RadixTabs = TabsPrimitive.Root

const RadixTabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={`
      inline-flex min-h-[2.25rem] md:min-h-[2.5rem] items-center justify-center rounded-md
      bg-[var(--card-bg)] p-1 text-[var(--text-secondary)]
      border border-[var(--card-border)]
      ${className || ''}
    `}
    {...props}
  />
))
RadixTabsList.displayName = TabsPrimitive.List.displayName

const RadixTabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={`
      inline-flex items-center justify-center whitespace-nowrap rounded-sm
      px-2 md:px-3 py-1 md:py-1.5 text-xs md:text-sm font-medium ring-offset-background
      transition-all focus-visible:outline-none focus-visible:ring-2
      focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2
      disabled:pointer-events-none disabled:opacity-50
      data-[state=active]:bg-[var(--accent)]
      data-[state=active]:text-[var(--accent-foreground)]
      data-[state=active]:shadow-sm
      hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]
      ${className || ''}
    `}
    {...props}
  />
))
RadixTabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const RadixTabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={`
      mt-2 ring-offset-background focus-visible:outline-none 
      focus-visible:ring-2 focus-visible:ring-[var(--accent)] 
      focus-visible:ring-offset-2
      ${className || ''}
    `}
    {...props}
  />
))
RadixTabsContent.displayName = TabsPrimitive.Content.displayName

export { RadixTabs, RadixTabsList, RadixTabsTrigger, RadixTabsContent }
