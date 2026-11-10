'use client'

/**
 * Small pieces the note tools, the Notes tab and the Properties tab share
 * (spec section 9): an icon for each note type and for the notes layer
 * switches, the six color swatches, and a chip that shows a note's type in
 * its color.
 */
import type { ReactElement } from 'react'
import { NOTE_COLOR_PRESETS, NOTE_COLORS, type NoteColor, type NoteType } from '@/domain/notes'

export type NoteGlyph = NoteType | 'eye' | 'eyeOff' | 'lock' | 'lockOpen'

const GLYPHS: Record<NoteGlyph, () => ReactElement> = {
  sticky: () => (
    <>
      <path d="M5 4h14v10l-6 6H5z" />
      <path d="M13 20v-6h6" />
    </>
  ),
  text: () => <path d="M6 6h12M12 6v13M9.5 19h5" />,
  arrow: () => (
    <>
      <path d="M5 19L18 6" />
      <path d="M10 5h9v9" />
    </>
  ),
  line: () => <path d="M5 19L19 5" />,
  box: () => <rect x={4} y={6} width={16} height={12} rx={1.5} />,
  circle: () => <circle cx={12} cy={12} r={8} />,
  eye: () => (
    <>
      <path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" />
      <circle cx={12} cy={12} r={2.8} />
    </>
  ),
  eyeOff: () => (
    <>
      <path d="M9.9 5.8A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.4M6.3 7.4C3.9 9 2.5 12 2.5 12s3.5 6.5 9.5 6.5a9 9 0 0 0 4.4-1.1" />
      <path d="M4 4l16 16" />
    </>
  ),
  lock: () => (
    <>
      <rect x={5} y={11} width={14} height={9} rx={1.5} />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  lockOpen: () => (
    <>
      <rect x={5} y={11} width={14} height={9} rx={1.5} />
      <path d="M8 11V8a4 4 0 0 1 7.6-1.7" />
    </>
  ),
}

/** A note glyph as line art in the text color (or `color`), sized by `className`. */
export function NoteIcon({ name, className = 'h-5 w-5', color }: { name: NoteGlyph; className?: string; color?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke={color ?? 'currentColor'}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {GLYPHS[name]()}
    </svg>
  )
}

/** A note's type in its color: the type's icon on the note's paper. */
export function NoteChip({ type, color, className = 'h-8 w-8' }: { type: NoteType; color: NoteColor; className?: string }) {
  const preset = NOTE_COLOR_PRESETS[color] ?? NOTE_COLOR_PRESETS.yellow
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-md border ${className}`}
      style={{ backgroundColor: preset.fill, borderColor: preset.stroke }}
      data-note-chip={color}
    >
      <NoteIcon name={type} className="h-4 w-4" color={preset.stroke} />
    </span>
  )
}

/**
 * The six note colors as a row of swatches (radio buttons), each at least
 * 44 px. Three to a row in narrow panels, six when there is room.
 */
export function ColorSwatches({
  label,
  value,
  onChange,
  disabled,
  testId,
}: {
  label: string
  value: NoteColor
  onChange(color: NoteColor): void
  disabled?: boolean
  testId?: string
}) {
  return (
    <div className="@container">
      <p className="text-sm font-medium text-stone-700">{label}</p>
      <div role="radiogroup" aria-label={label} data-testid={testId} className="mt-1 grid grid-cols-3 gap-2 @xs:grid-cols-6">
        {NOTE_COLORS.map((c) => {
          const preset = NOTE_COLOR_PRESETS[c]
          const on = c === value
          return (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={preset.label}
              title={preset.label}
              disabled={disabled}
              data-color={c}
              onClick={() => onChange(c)}
              className={`flex h-11 min-w-11 items-center justify-center rounded-lg border-2 outline-none focus-visible:ring-2 focus-visible:ring-blue-700/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${
                on ? 'ring-2 ring-blue-900 ring-offset-1' : ''
              }`}
              style={{ backgroundColor: preset.fill, borderColor: preset.stroke }}
            >
              {on && (
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke={preset.stroke} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
