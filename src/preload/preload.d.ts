import type { RepsilApi } from './preload'

declare global {
  interface Window {
    repsil: RepsilApi
  }
}

export {}
