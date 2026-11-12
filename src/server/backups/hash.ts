import 'server-only'
import { createHash } from 'node:crypto'

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * JSON with every object's keys sorted, at every depth, and no spaces, so
 * the same value always gives the same text whatever order its keys were
 * made in. Arrays keep their order. Keys whose value is undefined are left
 * out, as JSON.stringify does.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const text = JSON.stringify(value)
    // JSON.stringify gives undefined for undefined and functions; inside an array that is null.
    return text === undefined ? 'null' : text
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.keys(value)
    .sort()
    .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
  return `{${entries.join(',')}}`
}
