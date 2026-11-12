import { describe, expect, it } from 'vitest'
import { failedMessage, NOT_STORED_MESSAGE, notStoredAlert, saveStatusTitle, saveStatusView } from './save-status'

describe('saveStatusView', () => {
  it('uses the top bar words from the plan', () => {
    expect(saveStatusView({ kind: 'saved', at: '2026-11-09T10:00:00.000Z' }).text).toBe('Saved')
    expect(saveStatusView({ kind: 'saving' }).text).toBe('Saving…')
    expect(
      saveStatusView({
        kind: 'retrying',
        attempt: 2,
        nextTryAt: '2026-11-09T10:00:02.000Z',
        reason: 'No answer.',
        storedLocally: true,
      }),
    ).toEqual({ text: 'Not saved, retrying', detail: 'No answer.', tone: 'warning' })
    expect(saveStatusView({ kind: 'offline', storedLocally: true }).text).toBe('Offline, saved on this device')
    expect(saveStatusView(null).text).toBe('Opening…')
  })

  it('never says saved on this device when the device did not store it', () => {
    expect(saveStatusView({ kind: 'offline', storedLocally: false })).toEqual({
      text: 'Offline, not saved',
      detail: NOT_STORED_MESSAGE,
      tone: 'error',
    })
    expect(NOT_STORED_MESSAGE).toBe('Not saved on this device. Keep this page open until it says Saved.')
    const retrying = saveStatusView({
      kind: 'retrying',
      attempt: 1,
      nextTryAt: '2026-11-09T10:00:01.000Z',
      reason: 'No answer.',
      storedLocally: false,
    })
    expect(retrying.tone).toBe('error')
    expect(retrying.detail).toBe(`No answer. ${NOT_STORED_MESSAGE}`)
  })

  it("names the reason after Couldn't save", () => {
    expect(saveStatusView({ kind: 'failed', reason: 'gone', message: 'x' }).text).toBe(
      "Couldn't save: this layout was deleted",
    )
    expect(saveStatusView({ kind: 'failed', reason: 'invalid', message: 'x' }).text).toBe(
      "Couldn't save: the server would not take this layout",
    )
    expect(saveStatusView({ kind: 'failed', reason: 'signed-out', message: 'x' }).tone).toBe('error')
  })

  it('shows a conflict as not saved', () => {
    const view = saveStatusView({
      kind: 'conflict',
      server: { version: 3, updatedAt: '2026-11-09T10:00:00.000Z', editedBy: 'Aiden', editedById: null, lastSaveId: null, recentSaveIds: [] },
    })
    expect(view.text).toBe('Not saved')
  })
})

describe('saveStatusTitle', () => {
  it('holds the whole status for the narrow slot', () => {
    expect(saveStatusTitle({ text: 'Saved', tone: 'good' })).toBe('Saved')
    expect(saveStatusTitle({ text: 'Not saved, retrying', detail: 'No answer.', tone: 'warning' })).toBe(
      'Not saved, retrying. No answer.',
    )
  })
})

describe('notStoredAlert', () => {
  const retrying = (storedLocally: boolean) =>
    ({ kind: 'retrying', attempt: 1, nextTryAt: 'x', reason: 'No answer.', storedLocally }) as const

  it('warns when the edit is offline or retrying and this device did not store it', () => {
    expect(notStoredAlert({ kind: 'offline', storedLocally: false }, true)).toBe(NOT_STORED_MESSAGE)
    expect(notStoredAlert(retrying(false), true)).toBe(NOT_STORED_MESSAGE)
    expect(notStoredAlert({ kind: 'offline', storedLocally: true }, false)).toBeNull()
    expect(notStoredAlert(retrying(true), false)).toBeNull()
  })

  it('warns a signed-out tab whose draft was not stored', () => {
    const signedOut = { kind: 'failed', reason: 'signed-out', message: 'm' } as const
    expect(notStoredAlert(signedOut, false)).toBe(NOT_STORED_MESSAGE)
    expect(notStoredAlert(signedOut, true)).toBeNull()
    expect(failedMessage(signedOut, true)).toBe('m')
    expect(failedMessage(signedOut, false)).toBe('You were signed out. Sign in again to keep saving.')
  })

  it('stays quiet otherwise', () => {
    expect(notStoredAlert(null, false)).toBeNull()
    expect(notStoredAlert({ kind: 'saving' }, false)).toBeNull()
    expect(notStoredAlert({ kind: 'saved', at: 'x' }, false)).toBeNull()
    expect(notStoredAlert({ kind: 'failed', reason: 'gone', message: 'm' }, false)).toBeNull()
  })
})
