import * as React from 'react'
import { motion } from 'framer-motion'
import { cn } from '@renderer/lib/utils'
import { RadialGlow } from '@renderer/components/atmosphere/RadialGlow'
import { LineMotif } from '@renderer/components/atmosphere/LineMotif'

interface ExpressiveShellProps {
  children: React.ReactNode
  className?: string
  withMotif?: boolean
  withGlow?: boolean
}

/**
 * Layout shell for Expressive-mode screens: first-run, empty states,
 * settings landing, about, pairing wizard.
 *
 * Injects atmosphere (RadialGlow + LineMotif), applies generous spacing,
 * runs the page-enter fade+translate transition.
 */
export function ExpressiveShell({
  children,
  className,
  withMotif = true,
  withGlow = true
}: ExpressiveShellProps): JSX.Element {
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-bg">
      {withGlow && <RadialGlow color="accent" intensity="soft" />}
      {withMotif && <LineMotif variant="folders" speed="slow" />}

      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className={cn(
          'relative z-10 mx-auto flex max-w-3xl flex-col items-center px-8 py-16 text-center',
          className
        )}
      >
        {children}
      </motion.div>
    </div>
  )
}
