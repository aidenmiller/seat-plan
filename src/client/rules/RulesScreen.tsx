'use client'

/**
 * The Rules page (spec section 7, "Rules"; PLAN changes 8 and 16). Couple
 * rules come from partner links: one line per linked pair, with a switch
 * that flips both partners. Other rules show their kind, guests, next to
 * each other, where they apply, an on and off switch and the note, with
 * Edit and Delete. A rule that names the same guests as a rule of the
 * other kind is flagged as a clash; a rule whose guests were removed shows
 * "Needs guests".
 */
import { useMemo, useState } from 'react'
import { ApiRequestError, createRule, deleteRule, errorMessage, setCoupleRule, updateRule } from '@/client/api'
import { Switch } from '@/client/editor/panels/controls'
import { randomId } from '@/client/sync/random-id'
import { Dialog, DialogActions } from '@/client/ui/Dialog'
import { ChoiceGroup } from '@/client/ui/fields'
import { dangerButton, errorClass, inputClass, labelClass, primaryButton, secondaryButton } from '@/client/ui/styles'
import { fullName } from '@/domain/guest-list'
import { withCoupleRules, type AppliesTo, type RuleKind } from '@/domain/rules'
import { APPLIES_TO_TEXT, clashMap, couplePairs, ruleKindText } from '@/domain/rules-list'
import { joinAnd } from '@/domain/wording'
import type { GuestConflict, Group, Guest, StoredRule } from '@/shared/api'
import { GuestPicker } from './GuestPicker'

type Editing = { rule: StoredRule | null } | null

export function RulesScreen({
  weddingId,
  guests: initialGuests,
  groups,
  rules: initialRules,
}: {
  weddingId: string
  guests: Guest[]
  groups: Group[]
  rules: StoredRule[]
}) {
  const [guests, setGuests] = useState(initialGuests)
  const [rules, setRules] = useState(initialRules)
  const [message, setMessage] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing>(null)
  const [deleting, setDeleting] = useState<StoredRule | null>(null)

  const byId = useMemo(() => new Map(guests.map((g) => [g.id, g])), [guests])
  const couples = useMemo(() => couplePairs(guests), [guests])
  const clash = useMemo(() => clashMap(withCoupleRules(guests, rules)), [guests, rules])
  const names = (ids: readonly string[]) => joinAnd(ids.map((id) => (byId.get(id) ? fullName(byId.get(id)!) : 'Removed guest')))
  const ruleName = (id: string) => {
    const r = rules.find((x) => x.id === id)
    if (r) return `${ruleKindText(r)}: ${names(r.guestIds)}`
    const c = couples.find((x) => x.id === id)
    return c ? `Couple: ${names(c.guestIds)}` : 'Another rule'
  }

  function putRule(rule: StoredRule) {
    setRules((list) => (list.some((r) => r.id === rule.id) ? list.map((r) => (r.id === rule.id ? rule : r)) : [...list, rule]))
  }

  function putGuests(changed: readonly Guest[]) {
    const map = new Map(changed.map((g) => [g.id, g]))
    setGuests((list) => list.map((g) => map.get(g.id) ?? g))
  }

  async function switchCouple(guestIds: [string, string], enabled: boolean) {
    setMessage(null)
    putGuests(guestIds.flatMap((id) => (byId.get(id) ? [{ ...byId.get(id)!, coupleRuleEnabled: enabled }] : [])))
    try {
      const reply = await setCoupleRule({ guestIds, enabled })
      putGuests(reply.guests)
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409) putGuests((err.body as GuestConflict).guests ?? [])
      else putGuests(guestIds.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : [])))
      setMessage(`Could not change the couple rule. ${errorMessage(err)}`)
    }
  }

  async function switchRule(rule: StoredRule, enabled: boolean) {
    setMessage(null)
    putRule({ ...rule, enabled })
    try {
      putRule(await updateRule(rule.id, { enabled }))
    } catch (err) {
      putRule(rule)
      setMessage(`Could not change the rule. ${errorMessage(err)}`)
    }
  }

  return (
    <div className="space-y-6" data-testid="rules-screen">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-stone-600">Rules never stop a move. Broken ones show as problems in the editor.</p>
        <button type="button" className={`${primaryButton} w-full sm:w-auto`} onClick={() => setEditing({ rule: null })} data-testid="add-rule">
          Add rule
        </button>
      </div>
      {message && (
        <div role="alert" className="flex items-start justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <span>{message}</span>
          <button type="button" className="min-h-11 shrink-0 rounded-lg px-3 font-medium hover:bg-red-100" onClick={() => setMessage(null)}>
            Dismiss
          </button>
        </div>
      )}

      <section aria-labelledby="couple-rules">
        <h3 id="couple-rules" className="text-base font-semibold text-stone-900">
          Couple rules
        </h3>
        <p className="mt-1 text-sm text-stone-600">Partners sit at one table, next to each other. Link partners on the Guests tab.</p>
        {couples.length === 0 ? (
          <p className="mt-2 rounded-xl border border-dashed border-stone-300 bg-white p-4 text-sm text-stone-600">No partners linked yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white" data-testid="couple-rules">
            {couples.map((c) => (
              <li key={c.id} className="px-3 py-1" data-testid="couple-rule">
                <Switch label={names(c.guestIds)} hint="Together, next to each other" checked={c.enabled} onChange={(on) => void switchCouple(c.guestIds, on)} />
                <ClashNote ids={clash.get(c.id)} ruleName={ruleName} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="other-rules">
        <h3 id="other-rules" className="text-base font-semibold text-stone-900">
          Other rules
        </h3>
        {rules.length === 0 ? (
          <p className="mt-2 rounded-xl border border-dashed border-stone-300 bg-white p-4 text-sm text-stone-600" data-testid="rules-empty">
            No rules yet. Add one above, or select seated guests in the editor and use Keep together or Keep apart.
          </p>
        ) : (
          <ul className="mt-2 space-y-2" data-testid="rule-list">
            {rules.map((rule) => (
              <li key={rule.id} className="rounded-xl border border-stone-200 bg-white p-3" data-testid="rule" data-rule-id={rule.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="font-medium text-stone-900">{ruleKindText(rule)}</p>
                    <p className="text-sm text-stone-700">{rule.guestIds.length > 0 ? names(rule.guestIds) : 'No guests left'}</p>
                    <p className="text-xs text-stone-500">{APPLIES_TO_TEXT[rule.appliesTo]}</p>
                    {rule.needsGuests && (
                      <p className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900" data-testid="rule-needs-guests">
                        Needs guests
                      </p>
                    )}
                    {rule.note && <p className="mt-1 whitespace-pre-line text-sm text-stone-600">{rule.note}</p>}
                  </div>
                  <div className="flex items-center gap-1">
                    <Switch label={rule.enabled ? 'On' : 'Off'} checked={rule.enabled} onChange={(on) => void switchRule(rule, on)} testId="rule-switch" />
                  </div>
                </div>
                <ClashNote ids={clash.get(rule.id)} ruleName={ruleName} />
                <div className="mt-2 flex gap-2">
                  <button type="button" className={secondaryButton} onClick={() => setEditing({ rule })}>
                    Edit
                  </button>
                  <button type="button" className={`${secondaryButton} text-red-700 hover:bg-red-50`} onClick={() => setDeleting(rule)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <RuleDialog
        editing={editing}
        weddingId={weddingId}
        guests={guests}
        groups={groups}
        onClose={() => setEditing(null)}
        onSaved={(rule) => {
          putRule(rule)
          setEditing(null)
        }}
      />
      <DeleteRuleDialog
        rule={deleting}
        label={deleting ? `${ruleKindText(deleting)}: ${names(deleting.guestIds)}` : ''}
        onClose={() => setDeleting(null)}
        onDeleted={(id) => {
          setRules((list) => list.filter((r) => r.id !== id))
          setDeleting(null)
        }}
      />
    </div>
  )
}

function ClashNote({ ids, ruleName }: { ids: readonly string[] | undefined; ruleName(id: string): string }) {
  if (!ids || ids.length === 0) return null
  return (
    <p className="mt-2 rounded-lg bg-red-50 px-2 py-1 text-sm text-red-800" data-testid="rule-clash">
      Clashes with {ids.map(ruleName).join('; ')}
    </p>
  )
}

const KIND_CHOICES = [
  { value: 'together', label: 'Keep together', hint: 'Same table' },
  { value: 'apart', label: 'Keep apart', hint: 'Different tables' },
] as const

function RuleDialog({
  editing,
  weddingId,
  guests,
  groups,
  onClose,
  onSaved,
}: {
  editing: Editing
  weddingId: string
  guests: readonly Guest[]
  groups: readonly Group[]
  onClose(): void
  onSaved(rule: StoredRule): void
}) {
  return (
    <Dialog open={editing !== null} onClose={onClose} title={editing?.rule ? 'Edit rule' : 'Add rule'} testId="rule-dialog">
      {editing && <RuleForm key={editing.rule?.id ?? 'new'} rule={editing.rule} weddingId={weddingId} guests={guests} groups={groups} onClose={onClose} onSaved={onSaved} />}
    </Dialog>
  )
}

function RuleForm({
  rule,
  weddingId,
  guests,
  groups,
  onClose,
  onSaved,
}: {
  rule: StoredRule | null
  weddingId: string
  guests: readonly Guest[]
  groups: readonly Group[]
  onClose(): void
  onSaved(rule: StoredRule): void
}) {
  const [id] = useState(() => rule?.id ?? randomId())
  const [kind, setKind] = useState<RuleKind>(rule?.kind ?? 'together')
  const [picked, setPicked] = useState<string[]>(rule?.guestIds ?? [])
  const [nextTo, setNextTo] = useState(rule?.nextToEachOther ?? false)
  const [appliesTo, setAppliesTo] = useState<AppliesTo>(rule?.appliesTo ?? 'both')
  const [enabled, setEnabled] = useState(rule?.enabled ?? true)
  const [note, setNote] = useState(rule?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (busy) return
    if (picked.length < 2) {
      setError('Pick two or more guests.')
      return
    }
    setBusy(true)
    setError(null)
    const body = { kind, guestIds: picked, nextToEachOther: kind === 'together' && nextTo, appliesTo, enabled, note }
    try {
      onSaved(rule ? await updateRule(rule.id, body) : await createRule(weddingId, { id, ...body }))
    } catch (err) {
      setError(`Could not save the rule. ${errorMessage(err)}`)
      setBusy(false)
    }
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      className="space-y-4"
    >
      <ChoiceGroup legend="Kind" name="rule-kind" value={kind} onChange={setKind} choices={KIND_CHOICES} />
      <GuestPicker guests={guests} groups={groups} picked={picked} onChange={setPicked} />
      {kind === 'together' && <Switch label="Next to each other" checked={nextTo} onChange={setNextTo} testId="rule-next-to" />}
      <div>
        <label htmlFor="rule-applies" className={labelClass}>
          Applies to
        </label>
        <select id="rule-applies" value={appliesTo} onChange={(e) => setAppliesTo(e.target.value as AppliesTo)} className={`${inputClass} mt-1`}>
          {(['both', 'reception', 'ceremony'] as const).map((v) => (
            <option key={v} value={v}>
              {APPLIES_TO_TEXT[v]}
            </option>
          ))}
        </select>
      </div>
      <Switch label="On" checked={enabled} onChange={setEnabled} />
      <div>
        <label htmlFor="rule-note" className={labelClass}>
          Note
        </label>
        <textarea id="rule-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} className={`${inputClass} mt-1 h-auto py-2`} />
      </div>
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
      <DialogActions>
        <button type="button" className={secondaryButton} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={primaryButton} disabled={busy} data-testid="rule-save">
          {busy ? 'Saving…' : 'Save rule'}
        </button>
      </DialogActions>
    </form>
  )
}

function DeleteRuleDialog({ rule, label, onClose, onDeleted }: { rule: StoredRule | null; label: string; onClose(): void; onDeleted(id: string): void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function remove() {
    if (!rule || busy) return
    setBusy(true)
    setError(null)
    try {
      await deleteRule(rule.id)
      onDeleted(rule.id)
    } catch (err) {
      setError(`Could not delete the rule. ${errorMessage(err)}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={rule !== null} onClose={onClose} title="Delete this rule?" description={label} size="sm" testId="delete-rule-dialog">
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
      <DialogActions>
        <button type="button" className={secondaryButton} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={dangerButton} disabled={busy} onClick={() => void remove()}>
          Delete
        </button>
      </DialogActions>
    </Dialog>
  )
}
