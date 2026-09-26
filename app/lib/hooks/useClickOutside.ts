import { useEffect, type RefObject } from 'react'

/** Uses `mousedown`, not `click`, so it runs before downstream click handlers. SSR-safe. */
export function useClickOutside<T extends HTMLElement>(
  ref: RefObject<T | null>,
  onClickOutside: () => void
): void {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined

    const handler = (event: MouseEvent) => {
      const target = event.target as Node | null
      const el = ref.current
      if (!el || !target) return
      if (el.contains(target)) return
      onClickOutside()
    }

    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [ref, onClickOutside])
}
