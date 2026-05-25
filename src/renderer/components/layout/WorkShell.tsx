import * as React from 'react'
import { motion } from 'framer-motion'
import { cn } from '@renderer/lib/utils'

interface WorkShellProps {
  sidebar?: React.ReactNode
  topBar?: React.ReactNode
  statusBar?: React.ReactNode
  children: React.ReactNode
  className?: string
}

/**
 * Dense layout shell for Work-mode screens: folder grid, document viewer,
 * search results, trash, settings sub-pages.
 *
 * Strictly no atmosphere — no glow, no motif. Tight spacing scale.
 * Provides the standard "sidebar + topbar + content + statusbar" shape.
 */
export function WorkShell({
  sidebar,
  topBar,
  statusBar,
  children,
  className
}: WorkShellProps): JSX.Element {
  return (
    <div className="flex h-full w-full flex-col bg-bg text-fg">
      {topBar && (
        <div className="flex h-12 shrink-0 items-center border-b border-border bg-bg-surface px-3">
          {topBar}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        {sidebar && (
          <aside className="flex w-64 shrink-0 flex-col border-e border-border bg-bg-surface">
            {sidebar}
          </aside>
        )}
        <motion.main
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className={cn('min-w-0 flex-1 overflow-auto', className)}
        >
          {children}
        </motion.main>
      </div>
      {statusBar && (
        <div className="flex h-7 shrink-0 items-center border-t border-border bg-bg-surface px-3 text-w-small text-fg-muted">
          {statusBar}
        </div>
      )}
    </div>
  )
}
