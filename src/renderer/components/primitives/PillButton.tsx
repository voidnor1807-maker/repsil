import * as React from 'react'
import { Button, type ButtonProps } from '@renderer/components/ui/button'

/**
 * Pill-shaped CTA. Used ONLY for hero call-to-actions in Expressive mode
 * (Pair Device, Add Files, Get Started). All other buttons use default radius.
 */
export const PillButton = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (props, ref) => <Button ref={ref} size="xl" shape="pill" {...props} />
)
PillButton.displayName = 'PillButton'
