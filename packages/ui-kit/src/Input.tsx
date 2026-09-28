import React from 'react'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={`flex h-10 w-full rounded-md border border-(--card-border) bg-(--card-bg) px-3 py-2 text-sm text-primary-wh40k placeholder:text-secondary-wh40k placeholder:opacity-60 focus:outline-hidden focus:ring-2 focus:ring-(--accent) focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
        {...props}
      />
    )
  }
)

Input.displayName = 'Input'
