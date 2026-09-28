'use client'

import * as React from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { Check, ChevronRight, Circle } from 'lucide-react'

const RadixDropdownMenu = DropdownMenuPrimitive.Root

const RadixDropdownMenuTrigger = DropdownMenuPrimitive.Trigger

const RadixDropdownMenuGroup = DropdownMenuPrimitive.Group

const RadixDropdownMenuPortal = DropdownMenuPrimitive.Portal

const RadixDropdownMenuSub = DropdownMenuPrimitive.Sub

const RadixDropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

const RadixDropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
    inset?: boolean
  }
>(({ className, inset, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={`
      flex cursor-default select-none items-center rounded-xs px-2 py-1.5 text-sm outline-hidden 
      focus:bg-[color-mix(in_srgb,var(--accent)_30%,transparent)] data-[state=open]:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)]
      ${inset && 'pl-8'}
      ${className || ''}
    `}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto h-4 w-4" />
  </DropdownMenuPrimitive.SubTrigger>
))
RadixDropdownMenuSubTrigger.displayName =
  DropdownMenuPrimitive.SubTrigger.displayName

const RadixDropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.SubContent
    ref={ref}
    className={`
      z-50 min-w-32 overflow-hidden rounded-md border border-(--card-border) 
      bg-(--dropdown-bg-solid) backdrop-blur-xs p-1 text-primary-wh40k shadow-xl 
      data-[state=open]:animate-in data-[state=closed]:animate-out 
      data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 
      data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 
      data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 
      data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2
      ${className || ''}
    `}
    {...props}
  />
))
RadixDropdownMenuSubContent.displayName =
  DropdownMenuPrimitive.SubContent.displayName

const RadixDropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={`
        z-9999 min-w-32 overflow-hidden rounded-md border border-(--card-border) 
        bg-(--dropdown-bg-solid) backdrop-blur-xs p-1 text-primary-wh40k shadow-xl 
        ${className || ''}
      `}
      style={{ zIndex: 9999 }}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
))
RadixDropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

const RadixDropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={`
      relative flex cursor-pointer select-none items-center rounded-xs px-3 py-2 text-sm outline-hidden 
      transition-colors text-primary-wh40k
      hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] hover:text-(--accent)
      focus:bg-[color-mix(in_srgb,var(--accent)_30%,transparent)] focus:text-(--accent)
      data-disabled:pointer-events-none data-disabled:opacity-50
      ${inset && 'pl-8'}
      ${className || ''}
    `}
    {...props}
  />
))
RadixDropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

const RadixDropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    className={`
      relative flex cursor-default select-none items-center rounded-xs py-1.5 pl-8 pr-2 text-sm outline-hidden 
      transition-colors focus:bg-[color-mix(in_srgb,var(--accent)_30%,transparent)] focus:text-primary-wh40k 
      data-disabled:pointer-events-none data-disabled:opacity-50
      hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] hover:text-primary-wh40k
      ${className || ''}
    `}
    checked={checked}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
))
RadixDropdownMenuCheckboxItem.displayName =
  DropdownMenuPrimitive.CheckboxItem.displayName

const RadixDropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    className={`
      relative flex cursor-default select-none items-center rounded-xs py-1.5 pl-8 pr-2 text-sm outline-hidden 
      transition-colors focus:bg-[color-mix(in_srgb,var(--accent)_30%,transparent)] focus:text-primary-wh40k 
      data-disabled:pointer-events-none data-disabled:opacity-50
      hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] hover:text-primary-wh40k
      ${className || ''}
    `}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Circle className="h-2 w-2 fill-current" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
))
RadixDropdownMenuRadioItem.displayName =
  DropdownMenuPrimitive.RadioItem.displayName

const RadixDropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={`
      px-2 py-1.5 text-sm font-semibold text-secondary-wh40k
      ${inset && 'pl-8'}
      ${className || ''}
    `}
    {...props}
  />
))
RadixDropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName

const RadixDropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={`-mx-1 my-1 h-px bg-(--card-border) ${className || ''}`}
    {...props}
  />
))
RadixDropdownMenuSeparator.displayName =
  DropdownMenuPrimitive.Separator.displayName

const RadixDropdownMenuShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={`ml-auto text-xs tracking-widest opacity-60 ${className || ''}`}
      {...props}
    />
  )
}
RadixDropdownMenuShortcut.displayName = 'DropdownMenuShortcut'

export {
  RadixDropdownMenu,
  RadixDropdownMenuTrigger,
  RadixDropdownMenuContent,
  RadixDropdownMenuItem,
  RadixDropdownMenuCheckboxItem,
  RadixDropdownMenuRadioItem,
  RadixDropdownMenuLabel,
  RadixDropdownMenuSeparator,
  RadixDropdownMenuShortcut,
  RadixDropdownMenuGroup,
  RadixDropdownMenuPortal,
  RadixDropdownMenuSub,
  RadixDropdownMenuSubContent,
  RadixDropdownMenuSubTrigger,
  RadixDropdownMenuRadioGroup
}
