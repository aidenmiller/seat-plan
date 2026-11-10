/**
 * Copies pdf.js's image decoders (JBIG2 and CCITT fax, JPEG 2000) from the
 * installed pdfjs-dist into public/pdfjs-wasm, where the floor plan import
 * loads them (src/client/venues/import/pdfjs-options.ts). Run it after
 * changing the pdfjs-dist version:
 *
 *   npm run pdfjs:wasm
 *
 * The copies are checked in, and pdfjs-options.test.ts fails while they
 * differ from node_modules, so an upgrade cannot ship stale decoders.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { PDFJS_WASM_FILES } from '../src/client/venues/import/pdfjs-options'

const root = path.resolve(import.meta.dirname, '..')
const from = path.join(root, 'node_modules', 'pdfjs-dist', 'wasm')
const to = path.join(root, 'public', 'pdfjs-wasm')

const version = (JSON.parse(readFileSync(path.join(root, 'node_modules', 'pdfjs-dist', 'package.json'), 'utf8')) as { version: string }).version
mkdirSync(to, { recursive: true })
for (const name of PDFJS_WASM_FILES) copyFileSync(path.join(from, name), path.join(to, name))
writeFileSync(path.join(to, 'VERSION'), `${version}\n`)
console.log(`Copied ${PDFJS_WASM_FILES.length} files from pdfjs-dist ${version} to public/pdfjs-wasm.`)
