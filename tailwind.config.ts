import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

const config: Config = {
  darkMode: 'class',
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    container: {
      center: true,
      padding: '2rem'
    },
    extend: {
      // Every palette slot now reads from a CSS variable defined in
      // [globals.css](src/renderer/theme/globals.css). The light/dark class
      // on <html> swaps the variable values — no Tailwind variants needed at
      // call sites. The `<alpha-value>` placeholder is what lets `bg-bg/60`
      // etc. still work with opacity modifiers.
      colors: {
        bg: {
          DEFAULT: 'rgb(var(--bg) / <alpha-value>)',
          surface: 'rgb(var(--bg-surface) / <alpha-value>)',
          elevated: 'rgb(var(--bg-elevated) / <alpha-value>)'
        },
        border: {
          DEFAULT: 'rgb(var(--border) / <alpha-value>)',
          subtle: 'rgb(var(--border-subtle) / <alpha-value>)'
        },
        fg: {
          DEFAULT: 'rgb(var(--fg) / <alpha-value>)',
          muted: 'rgb(var(--fg-muted) / <alpha-value>)',
          subtle: 'rgb(var(--fg-subtle) / <alpha-value>)'
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          hover: 'rgb(var(--accent-hover) / <alpha-value>)',
          soft: 'rgb(var(--accent-soft) / <alpha-value>)',
          glow: 'rgb(var(--accent-glow) / <alpha-value>)'
        },
        destructive: {
          DEFAULT: 'rgb(var(--destructive) / <alpha-value>)',
          hover: 'rgb(var(--destructive-hover) / <alpha-value>)'
        },
        success: {
          DEFAULT: 'rgb(var(--success) / <alpha-value>)',
          hover: 'rgb(var(--success-hover) / <alpha-value>)'
        },
        warning: {
          DEFAULT: 'rgb(var(--warning) / <alpha-value>)',
          hover: 'rgb(var(--warning-hover) / <alpha-value>)'
        },
        info: {
          DEFAULT: 'rgb(var(--info) / <alpha-value>)'
        }
      },
      fontFamily: {
        sans: [
          'IBM Plex Sans',
          'IBM Plex Sans Arabic',
          'system-ui',
          'sans-serif'
        ],
        mono: ['IBM Plex Mono', 'ui-monospace', 'monospace']
      },
      fontSize: {
        // Work mode
        'w-small': ['12px', { lineHeight: '16px' }],
        'w-body': ['14px', { lineHeight: '20px' }],
        'w-h2': ['18px', { lineHeight: '26px', letterSpacing: '-0.01em' }],
        'w-h1': ['24px', { lineHeight: '32px', letterSpacing: '-0.01em' }],
        // Expressive mode
        'e-small': ['14px', { lineHeight: '20px' }],
        'e-body': ['18px', { lineHeight: '28px' }],
        'e-h2': ['24px', { lineHeight: '32px', letterSpacing: '-0.01em' }],
        'e-h1': ['36px', { lineHeight: '44px', letterSpacing: '-0.01em' }],
        'e-display': ['56px', { lineHeight: '64px', letterSpacing: '-0.02em' }]
      },
      borderRadius: {
        DEFAULT: '8px',
        sm: '4px',
        lg: '12px',
        pill: '9999px'
      },
      boxShadow: {
        // Subtle elevation tuned for the dark surface
        soft: '0 1px 0 rgba(255,255,255,0.02), 0 8px 24px rgba(0,0,0,0.4)',
        glow: '0 0 32px rgba(34,211,238,0.18)'
      },
      keyframes: {
        drift: {
          '0%, 100%': { transform: 'translate3d(0,0,0)' },
          '50%': { transform: 'translate3d(0,-8px,0)' }
        }
      },
      animation: {
        drift: 'drift 60s ease-in-out infinite'
      }
    }
  },
  plugins: [animate]
}

export default config
