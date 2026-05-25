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
      colors: {
        // Layered background system (deepest → most elevated)
        bg: {
          DEFAULT: '#0a0d14',
          surface: '#0f1320',
          elevated: '#161b2c'
        },
        border: {
          DEFAULT: '#1f2540',
          subtle: '#141a2a'
        },

        // Text
        fg: {
          DEFAULT: '#f1f5f9',
          muted: '#94a3b8',
          subtle: '#64748b'
        },

        // Primary accent — solid cyan, no gradient
        accent: {
          DEFAULT: '#22d3ee',
          hover: '#06b6d4',
          soft: '#67e8f9',
          glow: '#0891b2'
        },

        // Semantic — muted, dark-tuned
        destructive: {
          DEFAULT: '#ff274c',
          hover: '#e51c41'
        },
        success: {
          DEFAULT: '#10b981',
          hover: '#059669'
        },
        warning: {
          DEFAULT: '#f59e0b',
          hover: '#d97706'
        },
        info: {
          DEFAULT: '#22d3ee'
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
