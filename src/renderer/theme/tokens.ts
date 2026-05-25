/**
 * Canonical design tokens — mirror of tailwind.config.ts colors.
 * Use these when a hex value is needed in TS code (e.g. inline SVG, canvas).
 * Tailwind utility classes remain the primary styling mechanism for components.
 */

export const colors = {
  bg: { DEFAULT: '#0a0d14', surface: '#0f1320', elevated: '#161b2c' },
  border: { DEFAULT: '#1f2540', subtle: '#141a2a' },
  fg: { DEFAULT: '#f1f5f9', muted: '#94a3b8', subtle: '#64748b' },
  accent: {
    DEFAULT: '#22d3ee',
    hover: '#06b6d4',
    soft: '#67e8f9',
    glow: '#0891b2'
  },
  destructive: { DEFAULT: '#ff274c', hover: '#e51c41' },
  success: { DEFAULT: '#10b981', hover: '#059669' },
  warning: { DEFAULT: '#f59e0b', hover: '#d97706' },
  info: { DEFAULT: '#22d3ee' }
} as const

export const motion = {
  pageTransitionMs: 200,
  dialogEnterMs: 180,
  cardHoverMs: 150,
  tileStaggerMs: 20,
  motifCycleSec: 60,
  pulseSec: 1.6
} as const
