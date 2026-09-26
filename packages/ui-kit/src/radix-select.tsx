'use client'

import * as React from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { ChevronDown, ChevronUp, Check } from 'lucide-react'

const RadixSelect = SelectPrimitive.Root

const RadixSelectGroup = SelectPrimitive.Group

const RadixSelectValue = SelectPrimitive.Value

const RadixSelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={`
      flex h-10 w-full items-center justify-between rounded-md 
      border border-[var(--card-border)] bg-[var(--card-bg)] backdrop-blur-sm 
      px-3 py-2 text-sm text-[var(--text-primary)]
      placeholder:text-[var(--text-secondary)]
      focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-opacity-30
      disabled:cursor-not-allowed disabled:opacity-50
      hover:border-[var(--accent)] transition-colors
      ${className || ''}
    `}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
RadixSelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const RadixSelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={`
      flex cursor-default items-center justify-center py-1
      ${className || ''}
    `}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
))
RadixSelectScrollUpButton.displayName =
  SelectPrimitive.ScrollUpButton.displayName

const RadixSelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={`
      flex cursor-default items-center justify-center py-1
      ${className || ''}
    `}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
))
RadixSelectScrollDownButton.displayName =
  SelectPrimitive.ScrollDownButton.displayName

const RadixSelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={`
        relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md 
        border border-[var(--card-border)] 
        bg-[var(--dropdown-bg-solid)] backdrop-blur-sm 
        text-[var(--text-primary)] shadow-xl 
        data-[state=open]:animate-in data-[state=closed]:animate-out 
        data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 
        data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 
        data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 
        data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2
        ${
          position === 'popper' &&
          'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1'
        }
        ${className || ''}
      `}
      position={position}
      {...props}
    >
      <RadixSelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={`
          p-1
          ${
            position === 'popper' &&
            'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]'
          }
        `}
      >
        {children}
      </SelectPrimitive.Viewport>
      <RadixSelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
))
RadixSelectContent.displayName = SelectPrimitive.Content.displayName

const RadixSelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={`py-1.5 pl-8 pr-2 text-sm font-semibold text-[var(--text-secondary)] ${className || ''}`}
    {...props}
  />
))
RadixSelectLabel.displayName = SelectPrimitive.Label.displayName

const RadixSelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={`
      relative flex w-full cursor-default select-none items-center 
      rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none 
      text-[var(--text-primary)]
      focus:bg-[var(--hover-bg)] focus:text-[var(--text-primary)]
      data-[disabled]:pointer-events-none data-[disabled]:opacity-50
      hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]
      transition-colors
      ${className || ''}
    `}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>

    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
RadixSelectItem.displayName = SelectPrimitive.Item.displayName

const RadixSelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={`-mx-1 my-1 h-px bg-[var(--card-border)] ${className || ''}`}
    {...props}
  />
))
RadixSelectSeparator.displayName = SelectPrimitive.Separator.displayName

export {
  RadixSelect,
  RadixSelectGroup,
  RadixSelectValue,
  RadixSelectTrigger,
  RadixSelectContent,
  RadixSelectLabel,
  RadixSelectItem,
  RadixSelectSeparator,
  RadixSelectScrollUpButton,
  RadixSelectScrollDownButton
}
