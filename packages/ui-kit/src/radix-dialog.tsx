'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'

const RadixDialog = DialogPrimitive.Root

const RadixDialogTrigger = DialogPrimitive.Trigger

const RadixDialogPortal = DialogPrimitive.Portal

const RadixDialogClose = DialogPrimitive.Close

const RadixDialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={`
      fixed inset-0 z-50 bg-(--modal-overlay-bg) backdrop-blur-xs 
      data-[state=open]:animate-in data-[state=closed]:animate-out 
      data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0
      ${className || ''}
    `}
    {...props}
  />
))
RadixDialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const RadixDialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <RadixDialogPortal>
    <RadixDialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={`
        fixed inset-0 m-auto z-50 grid w-full max-w-lg h-fit gap-4 
        border border-(--card-border) bg-(--dropdown-bg-solid) backdrop-blur-xs p-6 shadow-lg duration-200 
        data-[state=open]:animate-in data-[state=closed]:animate-out 
        data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 
        data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 
        sm:rounded-lg
        ${className || ''}
      `}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-(--accent) focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-(--hover-bg) data-[state=open]:text-secondary-wh40k">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </RadixDialogPortal>
))
RadixDialogContent.displayName = DialogPrimitive.Content.displayName

const RadixDialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={`flex flex-col space-y-1.5 text-center sm:text-left ${className || ''}`}
    {...props}
  />
)
RadixDialogHeader.displayName = 'DialogHeader'

const RadixDialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={`flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 ${className || ''}`}
    {...props}
  />
)
RadixDialogFooter.displayName = 'DialogFooter'

const RadixDialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={`text-lg font-semibold leading-none tracking-tight text-primary-wh40k ${className || ''}`}
    {...props}
  />
))
RadixDialogTitle.displayName = DialogPrimitive.Title.displayName

const RadixDialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={`text-sm text-secondary-wh40k ${className || ''}`}
    {...props}
  />
))
RadixDialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  RadixDialog,
  RadixDialogPortal,
  RadixDialogOverlay,
  RadixDialogClose,
  RadixDialogTrigger,
  RadixDialogContent,
  RadixDialogHeader,
  RadixDialogFooter,
  RadixDialogTitle,
  RadixDialogDescription
}
