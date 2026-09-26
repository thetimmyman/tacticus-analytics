import { useState, useEffect } from 'react'

/** Guards locale-dependent formatting that would cause hydration mismatches. */
export function useHasMounted(): boolean {
  const [hasMounted, setHasMounted] = useState(false)

  useEffect(() => {
    setHasMounted(true)
  }, [])
  return hasMounted
}
