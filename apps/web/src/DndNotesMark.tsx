import SvgIcon, { type SvgIconProps } from '@mui/material/SvgIcon'

export function DndNotesMark(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 64 64" {...props}>
      <g
        stroke="currentColor"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <path d="M 23 58 H 49 A 4 4 0 0 0 53 54 V 44 A 4 4 0 0 0 49 40 H 23 A 4 4 0 0 0 19 44 V 54 A 4 4 0 0 0 23 58 Z" />
        <line x1={22} y1={48} x2={50} y2={48} strokeOpacity={0.55} />
        <path d="M 28 40 V 36 A 2 2 0 0 1 30 34 H 42 A 2 2 0 0 1 44 36 V 40" />
        <path d="M 30 34 V 31 H 42 V 34" />
      </g>
      <g
        stroke="currentColor"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <line x1={9} y1={9} x2={32} y2={32} />
        <path
          d="M 10 8 C 24 10, 32 18, 32 32 C 22 32, 14 24, 9 9 Z"
          fill="currentColor"
          fillOpacity={0.18}
        />
        <line x1={14} y1={14} x2={18.5} y2={18} strokeWidth={2} />
        <line x1={18} y1={18} x2={23} y2={22} strokeWidth={2} />
        <line x1={22} y1={22} x2={27} y2={26.5} strokeWidth={2} />
      </g>
    </SvgIcon>
  )
}
