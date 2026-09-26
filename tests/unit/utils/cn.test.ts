import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cn } from '@/app/lib/utils/cn'
import { cn as uiKitCn } from '@tacticus/ui-kit/cn'
import { cn as uiKitRootCn } from '@tacticus/ui-kit'

const repoRoot = process.cwd()

describe('cn - Class Name Utility', () => {
  describe('implementation boundary', () => {
    it('uses the shared ui-kit implementation through the app compatibility shim', () => {
      expect(cn).toBe(uiKitCn)
      expect(uiKitRootCn).toBe(uiKitCn)
    })

    it('keeps app/lib/utils/cn as a re-export instead of a duplicate implementation', () => {
      const appShim = readFileSync(
        join(repoRoot, 'app/lib/utils/cn.ts'),
        'utf8'
      )
      const uiKitIndex = readFileSync(
        join(repoRoot, 'packages/ui-kit/src/index.ts'),
        'utf8'
      )

      expect(appShim).toContain("export { cn } from '@tacticus/ui-kit/cn'")
      expect(appShim).not.toContain("from 'tailwind-merge'")
      expect(appShim).not.toContain("from 'clsx'")
      expect(uiKitIndex).toContain("export * from './cn'")
    })
  })

  describe('basic string handling', () => {
    it('returns single class unchanged', () => {
      expect(cn('px-4')).toBe('px-4')
    })

    it('merges multiple class strings', () => {
      expect(cn('px-4', 'py-2')).toBe('px-4 py-2')
    })

    it('handles empty strings', () => {
      expect(cn('')).toBe('')
      expect(cn('', 'px-4')).toBe('px-4')
      expect(cn('px-4', '')).toBe('px-4')
    })
  })

  describe('tailwind class merging', () => {
    it('overrides conflicting padding classes', () => {
      const result = cn('px-2 py-1', 'px-4')
      expect(result).toBe('py-1 px-4')
    })

    it('overrides conflicting margin classes', () => {
      const result = cn('mt-2', 'mt-6')
      expect(result).toBe('mt-6')
    })

    it('overrides conflicting width classes', () => {
      const result = cn('w-full', 'w-1/2')
      expect(result).toBe('w-1/2')
    })

    it('overrides conflicting background colors', () => {
      const result = cn('bg-red-500', 'bg-blue-500')
      expect(result).toBe('bg-blue-500')
    })

    it('overrides conflicting text colors', () => {
      const result = cn('text-gray-500', 'text-white')
      expect(result).toBe('text-white')
    })

    it('preserves non-conflicting classes', () => {
      const result = cn('px-4 py-2', 'mt-4')
      expect(result).toContain('px-4')
      expect(result).toContain('py-2')
      expect(result).toContain('mt-4')
    })
  })

  describe('conditional classes', () => {
    it('handles falsy values', () => {
      expect(cn('px-4', false)).toBe('px-4')
      expect(cn('px-4', null)).toBe('px-4')
      expect(cn('px-4', undefined)).toBe('px-4')
    })

    it('handles conditional expressions', () => {
      const isActive = true
      const result = cn('base', isActive && 'active')
      expect(result).toBe('base active')
    })

    it('excludes false conditions', () => {
      const isActive = false
      const result = cn('base', isActive && 'active')
      expect(result).toBe('base')
    })
  })

  describe('object syntax', () => {
    it('includes classes with true values', () => {
      const result = cn({ 'px-4': true, 'py-2': true })
      expect(result).toContain('px-4')
      expect(result).toContain('py-2')
    })

    it('excludes classes with false values', () => {
      const result = cn({ 'px-4': true, hidden: false })
      expect(result).toBe('px-4')
    })

    it('supports conditional class application', () => {
      const isActive = true
      const isDisabled = false

      expect(
        cn('button', {
          'button--active': isActive,
          'button--disabled': isDisabled
        })
      ).toBe('button button--active')
    })

    it('handles mixed object and string inputs', () => {
      const result = cn('base', { active: true, disabled: false })
      expect(result).toContain('base')
      expect(result).toContain('active')
      expect(result).not.toContain('disabled')
    })
  })

  describe('array syntax', () => {
    it('handles arrays of class names', () => {
      const result = cn(['px-4', 'py-2'])
      expect(result).toContain('px-4')
      expect(result).toContain('py-2')
    })

    it('deduplicates classes provided as arrays', () => {
      expect(cn(['text-sm', ['text-sm', 'font-semibold']])).toBe(
        'text-sm font-semibold'
      )
    })

    it('handles nested arrays', () => {
      const result = cn(['px-4', ['py-2', 'mt-4']])
      expect(result).toContain('px-4')
      expect(result).toContain('py-2')
      expect(result).toContain('mt-4')
    })
  })

  describe('complex scenarios', () => {
    it('handles component variant pattern', () => {
      const variant = 'primary' as const
      const size = 'lg' as const

      const variantClasses = {
        primary: 'bg-blue-500 text-white',
        secondary: 'bg-gray-500 text-white'
      }

      const sizeClasses = {
        sm: 'px-2 py-1 text-sm',
        lg: 'px-4 py-2 text-lg'
      }

      const result = cn('button', variantClasses[variant], sizeClasses[size])

      expect(result).toContain('button')
      expect(result).toContain('bg-blue-500')
      expect(result).toContain('text-white')
      expect(result).toContain('px-4')
      expect(result).toContain('py-2')
      expect(result).toContain('text-lg')
    })

    it('handles responsive classes', () => {
      const result = cn('w-full', 'md:w-1/2', 'lg:w-1/3')
      expect(result).toContain('w-full')
      expect(result).toContain('md:w-1/2')
      expect(result).toContain('lg:w-1/3')
    })

    it('handles hover and focus states', () => {
      const result = cn('bg-blue-500', 'hover:bg-blue-600', 'focus:ring-2')
      expect(result).toContain('bg-blue-500')
      expect(result).toContain('hover:bg-blue-600')
      expect(result).toContain('focus:ring-2')
    })
  })
})
