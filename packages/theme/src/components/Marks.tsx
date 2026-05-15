import type { SVGProps } from 'react'

/**
 * Daydream Software corporate mark — sun with a nested crescent moon.
 * Single concentric glyph centered on (32, 32). Uses `currentColor`; recolor
 * the parent and the mark follows. Stroke width 2.6 on a 64-grid.
 */
export function DaydreamMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" {...props}>
      <g stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <circle cx="32" cy="32" r="14" />
        <line x1="32" y1="6" x2="32" y2="11" />
        <line x1="32" y1="53" x2="32" y2="58" />
        <line x1="6" y1="32" x2="11" y2="32" />
        <line x1="53" y1="32" x2="58" y2="32" />
        <line x1="14.2" y1="14.2" x2="17.7" y2="17.7" />
        <line x1="46.3" y1="46.3" x2="49.8" y2="49.8" />
        <line x1="14.2" y1="49.8" x2="17.7" y2="46.3" />
        <line x1="46.3" y1="17.7" x2="49.8" y2="14.2" />
      </g>
      <path
        d="M 32 23 A 9 9 0 0 1 32 41 A 4.5 9 0 0 0 32 23 Z"
        fill="currentColor"
        fillOpacity={0.95}
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * D&D Notes product mark — quill feather dipped into an ink bottle.
 * Stroke width 2.6 on a 64-grid, uses `currentColor`.
 */
export function DndNotesMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" {...props}>
      <g stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M 23 58 H 49 A 4 4 0 0 0 53 54 V 44 A 4 4 0 0 0 49 40 H 23 A 4 4 0 0 0 19 44 V 54 A 4 4 0 0 0 23 58 Z" />
        <line x1="22" y1="48" x2="50" y2="48" strokeOpacity={0.55} />
        <path d="M 28 40 V 36 A 2 2 0 0 1 30 34 H 42 A 2 2 0 0 1 44 36 V 40" />
        <path d="M 30 34 V 31 H 42 V 34" />
      </g>
      <g stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <line x1="9" y1="9" x2="32" y2="32" />
        <path d="M 10 8 C 24 10, 32 18, 32 32 C 22 32, 14 24, 9 9 Z" fill="currentColor" fillOpacity={0.18} />
        <line x1="14" y1="14" x2="18.5" y2="18" strokeWidth="2" />
        <line x1="18" y1="18" x2="23" y2="22" strokeWidth="2" />
        <line x1="22" y1="22" x2="27" y2="26.5" strokeWidth="2" />
      </g>
    </svg>
  )
}

/** GitHub octocat (Phosphor-style fill). */
export function GitHubMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        fill="currentColor"
        d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-1.95c-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.27-1.69-1.27-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.25 3.34.96.1-.74.4-1.25.73-1.54-2.55-.29-5.24-1.27-5.24-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.17a10.94 10.94 0 0 1 5.74 0c2.19-1.48 3.15-1.17 3.15-1.17.63 1.58.24 2.75.12 3.04.74.8 1.18 1.82 1.18 3.07 0 4.4-2.7 5.37-5.26 5.65.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56C20.21 21.38 23.5 17.07 23.5 12 23.5 5.65 18.35.5 12 .5z"
      />
    </svg>
  )
}
