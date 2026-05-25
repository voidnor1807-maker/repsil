import { cn } from '@renderer/lib/utils'

interface RadialGlowProps {
  color?: 'accent' | 'destructive'
  intensity?: 'soft' | 'medium'
  className?: string
}

/**
 * Soft radial bloom that sits behind hero content in Expressive-mode screens.
 * Single CSS gradient, no JS, no animation. Cheap to render.
 * Used ONLY in Expressive mode — never on Work surfaces.
 */
export function RadialGlow({
  color = 'accent',
  intensity = 'soft',
  className
}: RadialGlowProps): JSX.Element {
  const rgb = color === 'accent' ? '34, 211, 238' : '255, 39, 76'
  const alpha = intensity === 'soft' ? 0.18 : 0.28

  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 -z-10 overflow-hidden',
        className
      )}
    >
      <div
        className="absolute left-1/2 top-1/2 h-[640px] w-[640px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
        style={{
          background: `radial-gradient(circle at center, rgba(${rgb}, ${alpha}) 0%, rgba(${rgb}, 0) 70%)`
        }}
      />
    </div>
  )
}
