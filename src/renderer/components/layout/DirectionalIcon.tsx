import * as React from 'react'
import { cn } from '@renderer/lib/utils'
import { useTranslation } from 'react-i18next'

interface DirectionalIconProps {
  children: React.ReactElement
  className?: string
}

/**
 * Mirrors directional icons (chevrons, arrows, back/next) when the UI is in
 * RTL mode. Wrap directional icons only — never call this on
 * semantic/non-directional icons like Search, Tag, Folder.
 */
export function DirectionalIcon({
  children,
  className
}: DirectionalIconProps): JSX.Element {
  const { i18n } = useTranslation()
  const isRtl = i18n.dir() === 'rtl'

  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex',
        isRtl && 'scale-x-[-1]',
        className
      )}
    >
      {children}
    </span>
  )
}
