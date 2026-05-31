import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@renderer/lib/utils'

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'text-w-body font-medium',
    'transition-colors duration-150',
    'disabled:pointer-events-none disabled:opacity-50',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg'
  ].join(' '),
  {
    variants: {
      variant: {
        primary:
          'bg-accent text-white dark:text-bg hover:bg-accent-hover shadow-soft',
        destructive:
          'bg-destructive text-white hover:bg-destructive-hover shadow-soft',
        outline:
          'border border-border bg-transparent text-fg hover:bg-bg-elevated hover:border-fg-subtle',
        ghost: 'bg-transparent text-fg hover:bg-bg-elevated',
        link: 'text-accent underline-offset-4 hover:underline'
      },
      size: {
        sm: 'h-8 px-3 rounded text-w-small',
        md: 'h-10 px-4 rounded',
        lg: 'h-12 px-6 rounded-lg text-e-body',
        xl: 'h-14 px-8 rounded-pill text-e-body',
        icon: 'h-10 w-10 rounded'
      },
      shape: {
        default: '',
        pill: 'rounded-pill'
      }
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
      shape: 'default'
    }
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, shape, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, shape, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
