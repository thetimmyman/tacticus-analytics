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
      inline-flex min-h-9 md:min-h-10 items-center justify-center rounded-md
      bg-(--card-bg) p-1 text-secondary-wh40k
      border border-(--card-border)
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
      inline-flex items-center justify-center whitespace-nowrap rounded-xs
      px-2 md:px-3 py-1 md:py-1.5 text-xs md:text-sm font-medium ring-offset-background
      transition-all focus-visible:outline-hidden focus-visible:ring-2
      focus-visible:ring-(--accent) focus-visible:ring-offset-2
      disabled:pointer-events-none disabled:opacity-50
      data-[state=active]:bg-accent-wh40k
      data-[state=active]:text-(--accent-foreground)
      data-[state=active]:shadow-xs
      hover:bg-(--hover-bg) hover:text-primary-wh40k
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
      mt-2 ring-offset-background focus-visible:outline-hidden 
      focus-visible:ring-2 focus-visible:ring-(--accent) 
      focus-visible:ring-offset-2
      ${className || ''}
    `}
    {...props}
  />
))
RadixTabsContent.displayName = TabsPrimitive.Content.displayName

export { RadixTabs, RadixTabsList, RadixTabsTrigger, RadixTabsContent }
