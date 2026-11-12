/**
 * Shared class names, so buttons and fields look the same on every screen.
 * Every button and field is at least 44 px tall (PLAN section 6, "Phones").
 * Fields use 16 px text, so iPhones do not zoom in when one gets focus.
 */
const buttonShape =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium outline-none ' +
  'disabled:cursor-not-allowed disabled:opacity-50'

const buttonBase = `${buttonShape} focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-1`

export const primaryButton = `${buttonBase} bg-blue-900 text-white hover:bg-blue-800`
export const secondaryButton = `${buttonBase} border border-stone-300 bg-white text-stone-800 hover:bg-stone-100`
export const dangerButton = `${buttonBase} bg-red-700 text-white hover:bg-red-800 disabled:hover:bg-red-700`
export const quietButton = `${buttonBase} text-stone-700 hover:bg-stone-100`

/**
 * Buttons placed straight on blueprint navy (the home page): the main action
 * white with navy text (10.36:1), the others navy outlined in white with
 * white text (10.36:1, 7.48:1 on hover); solid, so the paper's lines do not
 * run behind their words. The usual blue focus ring hardly shows on navy, so
 * these ring in white with a navy gap.
 */
const buttonOnNavyBase = `${buttonShape} focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-blue-900`

export const primaryButtonOnNavy = `${buttonOnNavyBase} bg-white text-blue-900 hover:bg-blue-100`
export const secondaryButtonOnNavy = `${buttonOnNavyBase} border border-white/60 bg-blue-900 text-white hover:bg-blue-800`

export const inputClass =
  'block h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-base text-stone-900 ' +
  'outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-700/20 aria-[invalid=true]:border-red-600'

export const labelClass = 'block text-sm font-medium text-stone-700'
export const hintClass = 'mt-1 text-sm text-stone-600'
export const errorClass = 'text-sm text-red-700'
