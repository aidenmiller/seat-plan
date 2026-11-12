import type { ReactNode } from 'react'
import { dayLabel } from '@/domain/activity'
import type { AdminDay, AdminOverview } from '@/shared/admin-api'

const cell = 'border-b border-stone-200 px-3 py-2 align-middle'
const head = 'border-b border-stone-200 px-3 py-2 font-semibold'

/** "1 wedding", "3 weddings". */
function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function Total({ label, value, children, testId }: { label: string; value: number; children?: ReactNode; testId: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4" data-testid={testId}>
      <dt className="text-sm text-stone-600">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums" data-testid={`${testId}-value`}>
        {value}
      </dd>
      {children && <dd className="mt-1 text-sm text-stone-600">{children}</dd>}
    </div>
  )
}

/**
 * Admin overview: how many people, weddings, guests, layouts, venues and
 * share links there are, and edits and sign-ins for each of the last 30 days.
 * Plain markup (no state), so the page renders it on the server.
 */
export function AdminOverviewScreen({ overview }: { overview: AdminOverview }) {
  const { totals, days } = overview
  const edits = days.reduce((sum, d) => sum + d.edits, 0)
  const signIns = days.reduce((sum, d) => sum + d.signIns, 0)
  const busy = days.filter((d) => d.edits > 0 || d.signIns > 0)
  return (
    <div className="space-y-8">
      <section aria-labelledby="totals-heading">
        <h2 id="totals-heading" className="text-xl font-semibold tracking-tight">
          Overview
        </h2>
        <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Total label="People with an account" value={totals.people.active + totals.people.off} testId="total-people">
            {totals.people.active} active, {totals.people.off} turned off, {count(totals.people.admins, 'admin', 'admins')}
          </Total>
          <Total label="Weddings" value={totals.weddings.live} testId="total-weddings">
            {totals.weddings.deleted} deleted
          </Total>
          <Total label="Guests" value={totals.guests} testId="total-guests">
            In live weddings
          </Total>
          <Total label="Layouts" value={totals.layouts} testId="total-layouts">
            In live weddings
          </Total>
          <Total label="Venues" value={totals.venues.library + totals.venues.private + totals.venues.noOwner} testId="total-venues">
            {totals.venues.library} in the library, {totals.venues.private} private, {totals.venues.noOwner} with no owner
          </Total>
          <Total label="Share links on" value={totals.shareLinks} testId="total-share-links" />
        </dl>
      </section>

      <section aria-labelledby="activity-heading">
        <h2 id="activity-heading" className="text-xl font-semibold tracking-tight">
          Activity, last 30 days
        </h2>
        <p className="mt-1 text-sm text-stone-600" data-testid="activity-summary">
          {count(edits, 'edit', 'edits')} and {count(signIns, 'sign-in', 'sign-ins')}, Toronto time. Edits count saves and other changes, so an hour of
          layout work shows as many edits.
        </p>
        <EditsStrip days={days} />
        {busy.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-stone-300 bg-white p-6 text-center text-stone-600">Nobody has edited or signed in.</p>
        ) : (
          <div className="relative mt-4 overflow-x-auto overscroll-x-contain rounded-xl border border-stone-200 bg-white sm:max-w-md" data-testid="activity-box">
            <table className="w-full border-separate border-spacing-0 text-sm" data-testid="admin-activity">
              <caption className="sr-only">Edits and sign-ins by day. Days with neither are left out.</caption>
              <thead className="text-left text-xs uppercase tracking-wide text-stone-600">
                <tr>
                  <th scope="col" className={head}>Day</th>
                  <th scope="col" className={`${head} text-right`}>Edits</th>
                  <th scope="col" className={`${head} text-right`}>Sign-ins</th>
                </tr>
              </thead>
              <tbody>
                {busy.map((d) => (
                  <tr key={d.day} data-testid="activity-day" data-day={d.day}>
                    <th scope="row" className={`${cell} text-left font-normal`}>
                      {dayLabel(d.day)}
                    </th>
                    <td className={`${cell} text-right tabular-nums`}>{d.edits}</td>
                    <td className={`${cell} text-right tabular-nums`}>{d.signIns}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {busy.length > 0 && <p className="mt-2 text-sm text-stone-600">Days with no edits and no sign-ins are left out.</p>}
      </section>
    </div>
  )
}

const BAR = 8
const GAP = 2
const HEIGHT = 60
const RADIUS = 2

/** A bar from the baseline with rounded top corners. */
function barPath(x: number, height: number): string {
  const top = HEIGHT - height
  const r = Math.min(RADIUS, height, BAR / 2)
  return `M${x},${HEIGHT}V${top + r}Q${x},${top} ${x + r},${top}H${x + BAR - r}Q${x + BAR},${top} ${x + BAR},${top + r}V${HEIGHT}Z`
}

/**
 * Edits per day as a strip of bars, oldest on the left. The table under it
 * holds the same numbers, so the strip is hidden from screen readers; each
 * day's full height is a hover target with the day's numbers.
 */
function EditsStrip({ days }: { days: AdminDay[] }) {
  const oldestFirst = [...days].reverse()
  const max = Math.max(0, ...oldestFirst.map((d) => d.edits))
  if (oldestFirst.length === 0) return null
  const width = oldestFirst.length * (BAR + GAP)
  return (
    <figure className="mt-4 max-w-xl">
      <svg viewBox={`0 0 ${width} ${HEIGHT}`} className="block h-auto w-full" aria-hidden="true" data-testid="edits-strip">
        <line x1={0} x2={width} y1={HEIGHT - 0.25} y2={HEIGHT - 0.25} className="stroke-stone-300" strokeWidth={0.5} />
        {oldestFirst.map((d, i) => {
          const x = i * (BAR + GAP) + GAP / 2
          const height = max === 0 || d.edits === 0 ? 0 : Math.max(1.5, (d.edits / max) * (HEIGHT - 4))
          return (
            <g key={d.day}>
              {height > 0 && <path d={barPath(x, height)} className="fill-blue-900" />}
              <rect x={x - GAP / 2} y={0} width={BAR + GAP} height={HEIGHT} fill="transparent">
                <title>{`${dayLabel(d.day)}: ${count(d.edits, 'edit', 'edits')}, ${count(d.signIns, 'sign-in', 'sign-ins')}`}</title>
              </rect>
            </g>
          )
        })}
      </svg>
      <figcaption className="mt-1 flex justify-between text-xs text-stone-600">
        <span>{dayLabel(oldestFirst[0]!.day)}</span>
        <span>{max > 0 ? `Busiest day: ${count(max, 'edit', 'edits')}` : 'No edits'}</span>
        <span>Today</span>
      </figcaption>
    </figure>
  )
}
