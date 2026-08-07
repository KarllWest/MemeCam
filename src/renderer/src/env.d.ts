/// <reference types="vite/client" />
import type { MemeCamApi } from '../../preload'

declare global {
  interface Window {
    memecam: MemeCamApi
  }
}

export {}
