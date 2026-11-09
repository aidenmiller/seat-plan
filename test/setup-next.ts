// next/server expects the AsyncLocalStorage global that Next's runtime provides.
import { AsyncLocalStorage } from 'node:async_hooks'
;(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= AsyncLocalStorage
