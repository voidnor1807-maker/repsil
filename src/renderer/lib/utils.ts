import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * shadcn-standard className combiner: clsx + tailwind-merge.
 * Resolves conflicting Tailwind classes intelligently (later wins).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
