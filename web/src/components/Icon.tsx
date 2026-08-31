/**
 * A small hand-drawn icon set.
 *
 * Deliberately not a dependency: the published package bundles everything and
 * declares no runtime deps, and an icon library would add far more weight than
 * the dozen glyphs this UI actually uses. Every icon is a 24x24 stroke drawing
 * so they share one visual weight.
 *
 * Icons are always decorative here -- `aria-hidden` -- because every control
 * that uses one carries its own accessible name via `aria-label`.
 */

export type IconName =
  | 'settings'
  | 'refresh'
  | 'plus'
  | 'trash'
  | 'play'
  | 'stop'
  | 'layoutVertical'
  | 'layoutHorizontal'
  | 'zoomIn'
  | 'zoomOut'
  | 'fit'
  | 'close'
  | 'panelLeft'
  | 'panelRight'
  | 'graph'
  | 'list'

const PATHS: Record<IconName, JSX.Element> = {
  // Sliders rather than a gear: a gear's teeth collapse into a sun at 15px,
  // which is the size every one of these actually renders at.
  settings: (
    <>
      <path d="M4 7h5M13 7h7M4 17h9M17 17h3" />
      <circle cx="11" cy="7" r="2.1" />
      <circle cx="15" cy="17" r="2.1" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.4-5.7" />
      <path d="M20 4v4.5h-4.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  trash: (
    <>
      <path d="M4 7h16M10 7V4.5h4V7M6 7l1 12.5h10L18 7" />
      <path d="M10.5 11v5M13.5 11v5" />
    </>
  ),
  play: <path d="M8 5.5l10 6.5-10 6.5z" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="1.5" />,
  layoutVertical: (
    <>
      <rect x="8.5" y="3" width="7" height="6" rx="1.5" />
      <rect x="8.5" y="15" width="7" height="6" rx="1.5" />
      <path d="M12 9v6" />
    </>
  ),
  layoutHorizontal: (
    <>
      <rect x="3" y="8.5" width="6" height="7" rx="1.5" />
      <rect x="15" y="8.5" width="6" height="7" rx="1.5" />
      <path d="M9 12h6" />
    </>
  ),
  zoomIn: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M8.5 11h5M11 8.5v5M16 16l4 4" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M8.5 11h5M16 16l4 4" />
    </>
  ),
  fit: <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  panelLeft: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9.5 4v16" />
    </>
  ),
  panelRight: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M14.5 4v16" />
    </>
  ),
  graph: (
    <>
      <circle cx="12" cy="5" r="2.3" />
      <circle cx="6" cy="19" r="2.3" />
      <circle cx="18" cy="19" r="2.3" />
      <path d="M12 7.3v4.2M12 11.5L6.9 16.9M12 11.5l5.1 5.4" />
    </>
  ),
  list: <path d="M4 6h16M4 12h16M4 18h10" />,
}

/** Icons that read better filled than stroked. */
const FILLED = new Set<IconName>(['play', 'stop'])

export interface IconProps {
  name: IconName
  size?: number
  className?: string
}

export function Icon({ name, size = 15, className }: IconProps) {
  const filled = FILLED.has(name)
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}
