import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '@renderer/lib/utils'

interface LineMotifProps {
  variant?: 'folders' | 'pages'
  speed?: 'slow' | 'medium'
  className?: string
}

/**
 * Drifting thin-line outlines (folders / pages / archive shelves) for the
 * background of Expressive-mode screens. Themed alternative to the reference
 * image's atom rings. Very low opacity (~6%), respects prefers-reduced-motion.
 * Used ONLY in Expressive mode.
 */
export function LineMotif({
  variant = 'folders',
  speed = 'slow',
  className
}: LineMotifProps): JSX.Element {
  const reducedMotion = useReducedMotion()
  const cycleSec = speed === 'slow' ? 80 : 50

  const shapes =
    variant === 'folders'
      ? FOLDER_SHAPES
      : PAGE_SHAPES

  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 -z-10 overflow-hidden',
        className
      )}
    >
      <svg
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid slice"
        viewBox="0 0 1200 800"
      >
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          className="text-fg-subtle"
          opacity="0.08"
        >
          {shapes.map((shape, i) => {
            const baseProps = {
              key: i,
              transform: `translate(${shape.x}, ${shape.y}) rotate(${shape.r})`
            }
            const path = shape.path
            if (reducedMotion) {
              return <path {...baseProps} d={path} />
            }
            return (
              <motion.path
                {...baseProps}
                d={path}
                animate={{ y: [0, -10, 0] }}
                transition={{
                  duration: cycleSec,
                  ease: 'easeInOut',
                  repeat: Infinity,
                  delay: i * 1.5
                }}
              />
            )
          })}
        </g>
      </svg>
    </div>
  )
}

interface Shape {
  x: number
  y: number
  r: number
  path: string
}

// Thin-line outlined folder shapes
const FOLDER_SHAPES: Shape[] = [
  { x: 80, y: 120, r: -8, path: folderPath(180, 120) },
  { x: 940, y: 100, r: 12, path: folderPath(140, 100) },
  { x: 1020, y: 540, r: -4, path: folderPath(160, 110) },
  { x: 60, y: 580, r: 6, path: folderPath(150, 110) },
  { x: 500, y: 680, r: 0, path: folderPath(200, 130) },
  { x: 700, y: 60, r: -2, path: folderPath(120, 90) }
]

// Thin-line page stack shapes
const PAGE_SHAPES: Shape[] = [
  { x: 120, y: 160, r: -6, path: pagePath(120, 160) },
  { x: 960, y: 130, r: 10, path: pagePath(100, 140) },
  { x: 1040, y: 580, r: -3, path: pagePath(110, 150) },
  { x: 100, y: 620, r: 5, path: pagePath(110, 150) },
  { x: 540, y: 720, r: 0, path: pagePath(140, 180) }
]

function folderPath(w: number, h: number): string {
  const tabW = w * 0.4
  const tabH = h * 0.12
  return [
    `M 0 ${tabH}`,
    `L ${tabW * 0.1} 0`,
    `L ${tabW} 0`,
    `L ${tabW + tabH} ${tabH}`,
    `L ${w} ${tabH}`,
    `L ${w} ${h}`,
    `L 0 ${h}`,
    `Z`
  ].join(' ')
}

function pagePath(w: number, h: number): string {
  const fold = w * 0.18
  return [
    `M 0 0`,
    `L ${w - fold} 0`,
    `L ${w} ${fold}`,
    `L ${w} ${h}`,
    `L 0 ${h}`,
    `Z`,
    `M ${w - fold} 0`,
    `L ${w - fold} ${fold}`,
    `L ${w} ${fold}`
  ].join(' ')
}
