import { useEffect, useState } from 'react'

/**
 * Returns `true` when the window has been scrolled past `threshold` pixels.
 * Used to drive the shrinking-header pattern in the campaign workspace.
 */
export function useScrolled(threshold = 24): boolean {
  const [scrolled, setScrolled] = useState(() =>
    typeof window === 'undefined' ? false : window.scrollY > threshold,
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const update = () => setScrolled(window.scrollY > threshold)
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [threshold])

  return scrolled
}
