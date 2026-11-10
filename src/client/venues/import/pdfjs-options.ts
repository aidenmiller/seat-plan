/**
 * The options every floor plan PDF is opened with, in the browser and in the
 * tests that check them.
 *
 * pdf.js decodes JBIG2 and CCITT fax pictures (what most scanners and copiers
 * write for black and white pages) and JPEG 2000 with WebAssembly modules it
 * loads from `wasmUrl`. Without it the picture is skipped with no error and
 * the page renders white, so a scanned plan would reach the model as a blank
 * page. The app serves those files from public/pdfjs-wasm (behind the site
 * cookie, like every other path), copied from the pinned pdfjs-dist by
 * scripts/copy-pdfjs-wasm.ts; pdfjs-options.test.ts fails when the copies
 * and node_modules differ.
 */

/** Where the decoders are served. pdf.js needs the trailing slash. */
export const PDFJS_WASM_URL = '/pdfjs-wasm/'

/**
 * The files copied into public/pdfjs-wasm: the JBIG2 and CCITT decoder, the
 * JPEG 2000 decoder, the plain JavaScript versions pdf.js falls back to where
 * WebAssembly is off, and their licences.
 */
export const PDFJS_WASM_FILES = [
  'jbig2.wasm',
  'jbig2_nowasm_fallback.js',
  'openjpeg.wasm',
  'openjpeg_nowasm_fallback.js',
  'LICENSE_JBIG2',
  'LICENSE_OPENJPEG',
  'LICENSE_PDFJS_JBIG2',
  'LICENSE_PDFJS_OPENJPEG',
] as const

/** getDocument's parameters for a plan. Tests pass a folder on disk as `wasmUrl`. */
export function planDocumentParams(data: Uint8Array, verbosity: number, wasmUrl: string = PDFJS_WASM_URL) {
  return { data, verbosity, wasmUrl }
}
