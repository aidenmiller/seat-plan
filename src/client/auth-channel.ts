/**
 * What this browser's tabs tell each other about signing in and out, on the
 * BroadcastChannel 'seat-plan-auth':
 *
 * - 'signed-in' (posted by the sign-in form and the invite page): a tab
 *   rendered for anyone else stops (its savers would be refused anyway,
 *   src/server/auth/guards.ts) and says to reload. A tab of the same person
 *   tries its waiting saves again: their session ran out, or someone else
 *   signed in meanwhile, and they signed in again. Such a tab stops showing
 *   "Someone else signed in", and savers stopped by it send what they kept.
 * - 'flush' and its replies (posted while signing out): every tab of that
 *   person sends what waits and reports whether anything is still unsaved,
 *   so the sign-out can ask first.
 * - 'signed-out': that person's other tabs stop their savers and go to the
 *   sign-in page.
 *
 * Browsers without BroadcastChannel get none of this; the server's user
 * header check still keeps one person's edits out of another's session.
 */
import { randomId } from './sync/random-id'

export const AUTH_CHANNEL_NAME = 'seat-plan-auth'

export type AuthMessage =
  | { type: 'signed-in'; userId: string }
  | { type: 'signed-out'; userId: string }
  | { type: 'flush'; userId: string; requestId: string }
  | { type: 'flush-started'; requestId: string; tabId: string }
  | { type: 'flush-done'; requestId: string; tabId: string; unsaved: boolean }

/** The parts of BroadcastChannel used here. */
export type ChannelLike = {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void
  close(): void
}

/** A new channel, or null where the browser has none (or during server rendering). */
export function openAuthChannel(): ChannelLike | null {
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    return new BroadcastChannel(AUTH_CHANNEL_NAME)
  } catch {
    return null
  }
}

let pageChannel: ChannelLike | null | undefined

/**
 * The page's one channel, for both sending and listening: a channel never
 * hears its own messages, so a tab never answers its own flush request.
 */
export function authChannel(): ChannelLike | null {
  if (pageChannel === undefined) pageChannel = openAuthChannel()
  return pageChannel
}

/** Posts on the page's channel. Never throws. */
export function postAuthMessage(message: AuthMessage, channel: ChannelLike | null = authChannel()): void {
  try {
    channel?.postMessage(message)
  } catch {
    // A closed channel: the server's check still covers it.
  }
}

/** The message as an AuthMessage, or null for anything else on the channel. */
export function readAuthMessage(data: unknown): AuthMessage | null {
  if (!data || typeof data !== 'object') return null
  const m = data as Record<string, unknown>
  const str = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 200
  switch (m.type) {
    case 'signed-in':
    case 'signed-out':
      return str(m.userId) ? { type: m.type, userId: m.userId as string } : null
    case 'flush':
      return str(m.userId) && str(m.requestId) ? { type: 'flush', userId: m.userId as string, requestId: m.requestId as string } : null
    case 'flush-started':
      return str(m.requestId) && str(m.tabId) ? { type: 'flush-started', requestId: m.requestId as string, tabId: m.tabId as string } : null
    case 'flush-done':
      return str(m.requestId) && str(m.tabId) && typeof m.unsaved === 'boolean'
        ? { type: 'flush-done', requestId: m.requestId as string, tabId: m.tabId as string, unsaved: m.unsaved }
        : null
    default:
      return null
  }
}

export type AuthListenerHandlers = {
  /** The user this page was rendered for. */
  userId: string
  /** Someone else signed in on this browser. */
  onOtherUser(): void
  /** The same person signed in again (their session had run out). */
  onSignedInAgain(): void
  /** This person signed out in another tab. */
  onSignedOut(): void
  /** Sends what this page's savers hold; resolves whether anything is still unsaved. */
  flush(): Promise<{ unsaved: boolean }>
}

/** Listens on the channel for this page. Returns the function that stops listening. */
export function listenForAuthChanges(handlers: AuthListenerHandlers, channel: ChannelLike | null = authChannel()): () => void {
  if (!channel) return () => undefined
  const tabId = randomId()
  const onMessage = (event: MessageEvent) => {
    const message = readAuthMessage(event.data)
    if (!message) return
    switch (message.type) {
      case 'signed-in':
        if (message.userId === handlers.userId) handlers.onSignedInAgain()
        else handlers.onOtherUser()
        return
      case 'signed-out':
        if (message.userId === handlers.userId) handlers.onSignedOut()
        return
      case 'flush': {
        if (message.userId !== handlers.userId) return
        const { requestId } = message
        postAuthMessage({ type: 'flush-started', requestId, tabId }, channel)
        void handlers.flush().then(
          ({ unsaved }) => postAuthMessage({ type: 'flush-done', requestId, tabId, unsaved }, channel),
          () => postAuthMessage({ type: 'flush-done', requestId, tabId, unsaved: true }, channel),
        )
        return
      }
      default:
        return
    }
  }
  channel.addEventListener('message', onMessage)
  return () => channel.removeEventListener('message', onMessage)
}

/**
 * Asks this person's other tabs to send what they hold, and waits for their
 * answers: up to `waitMs` in all, and at least `answerMs` for the first
 * answers to come in. Anything a tab reports unsaved, or a tab that started
 * and did not finish in time, counts as unsaved. Tabs the browser has frozen
 * in the background cannot answer and are not counted.
 */
export function flushOtherTabs(
  userId: string,
  { waitMs = 3000, answerMs = 300, channel = authChannel() }: { waitMs?: number; answerMs?: number; channel?: ChannelLike | null } = {},
): Promise<{ unsaved: boolean }> {
  if (!channel) return Promise.resolve({ unsaved: false })
  const requestId = randomId()
  const started = new Set<string>()
  const done = new Map<string, boolean>()
  return new Promise((resolve) => {
    let answerWindowOver = false
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      clearTimeout(overall)
      clearTimeout(answers)
      channel.removeEventListener('message', onMessage)
      let unsaved = false
      for (const tab of started) if (done.get(tab) !== false) unsaved = true
      resolve({ unsaved })
    }
    const settledAll = () => [...started].every((tab) => done.has(tab))
    const onMessage = (event: MessageEvent) => {
      const message = readAuthMessage(event.data)
      if (!message || !('requestId' in message) || message.requestId !== requestId) return
      if (message.type === 'flush-started') started.add(message.tabId)
      if (message.type === 'flush-done') {
        started.add(message.tabId)
        done.set(message.tabId, message.unsaved)
      }
      if (answerWindowOver && settledAll()) finish()
    }
    channel.addEventListener('message', onMessage)
    const overall = setTimeout(finish, waitMs)
    const answers = setTimeout(() => {
      answerWindowOver = true
      if (settledAll()) finish()
    }, answerMs)
    postAuthMessage({ type: 'flush', userId, requestId }, channel)
  })
}

// ---------- A sign-in to tell the other tabs about from the next page ----------

/**
 * Making an account on the invite page signs it in, but the reply does not
 * say the new account's id, which 'signed-in' carries. So the invite page
 * leaves word in this tab's sessionStorage, and the first signed-in page
 * after it (src/client/BrowserSession.tsx) tells the other tabs.
 */
export const ANNOUNCE_SIGN_IN_KEY = 'seat-plan:announce-sign-in'
/** Word older than this is ignored: the page it was for never came. */
const ANNOUNCE_WITHIN_MS = 5 * 60_000

type SmallStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function tabStorage(): SmallStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

const sameEmail = (email: string) => email.trim().toLowerCase()

/** Leaves word that this account signed in, for the next page in this tab. Never throws. */
export function announceSignInOnNextPage(email: string, { storage = tabStorage(), now = Date.now } = {}): void {
  try {
    storage?.setItem(ANNOUNCE_SIGN_IN_KEY, JSON.stringify({ email: sameEmail(email), at: now() }))
  } catch {
    // Storage blocked: the server's user header check still keeps the other tabs' edits out of this session.
  }
}

/** On a signed-in page: if the page before it signed this person in, tells the other tabs now. Word is used once. */
export function announcePendingSignIn(
  user: { id: string; email: string },
  { storage = tabStorage(), channel = authChannel(), now = Date.now }: { storage?: SmallStorage | null; channel?: ChannelLike | null; now?: () => number } = {},
): void {
  let word: { email?: unknown; at?: unknown } | null = null
  try {
    const raw = storage?.getItem(ANNOUNCE_SIGN_IN_KEY) ?? null
    if (raw === null) return
    storage?.removeItem(ANNOUNCE_SIGN_IN_KEY)
    word = JSON.parse(raw) as { email?: unknown; at?: unknown }
  } catch {
    return
  }
  if (!word || typeof word.email !== 'string' || typeof word.at !== 'number') return
  const age = now() - word.at
  if (word.email !== sameEmail(user.email) || age < 0 || age > ANNOUNCE_WITHIN_MS) return
  postAuthMessage({ type: 'signed-in', userId: user.id }, channel)
}

// ---------- This page's state ----------

export type PageAuthState = 'current' | 'other-user'

let state: PageAuthState = 'current'
const listeners = new Set<() => void>()

/** 'other-user' once someone else signed in on this browser: the page shows "reload" and saves nothing more. */
export function pageAuthState(): PageAuthState {
  return state
}

export function markOtherUser(): void {
  if (state === 'other-user') return
  state = 'other-user'
  for (const listener of [...listeners]) listener()
}

/** The page's own user signed in again: this browser's session is theirs once more. */
export function clearOtherUser(): void {
  if (state === 'current') return
  state = 'current'
  for (const listener of [...listeners]) listener()
}

export function subscribePageAuthState(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
