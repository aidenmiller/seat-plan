/**
 * A tiny external store (DECISIONS 47: no Zustand) and a selector hook built
 * on React's useSyncExternalStore. setState merges a patch and tells
 * listeners only when some field really changed.
 */
import { useMemo, useSyncExternalStore } from 'react'

export type Listener = () => void

export type Store<T extends object> = {
  getState(): T
  setState(patch: Partial<T> | ((state: T) => Partial<T>)): void
  subscribe(listener: Listener): () => void
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial
  const listeners = new Set<Listener>()
  return {
    getState: () => state,
    setState(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch
      let changed = false
      for (const key of Object.keys(p) as (keyof T)[]) {
        if (!Object.is(state[key], p[key])) {
          changed = true
          break
        }
      }
      if (!changed) return
      state = { ...state, ...p }
      for (const listener of [...listeners]) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** Shallow equality for arrays and plain objects, for selectors that build a new value. */
export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a) as (keyof T)[]
  const kb = Object.keys(b) as (keyof T)[]
  if (ka.length !== kb.length) return false
  return ka.every((k) => Object.is(a[k], b[k]))
}

type Subscribable<T> = { getState(): T; subscribe(listener: Listener): () => void }

/**
 * A getSnapshot that runs the selector once per store state and keeps the
 * last value while `isEqual` says it is the same, as useSyncExternalStore needs.
 */
export function memoSelector<T, U>(store: Pick<Subscribable<T>, 'getState'>, selector: (state: T) => U, isEqual: (a: U, b: U) => boolean): () => U {
  let has = false
  let lastState: T
  let lastValue: U
  return () => {
    const state = store.getState()
    if (has && Object.is(state, lastState)) return lastValue
    const value = selector(state)
    lastState = state
    if (has && isEqual(lastValue, value)) return lastValue
    has = true
    lastValue = value
    return value
  }
}

/**
 * Reads part of a store. The component re-renders only when the selected
 * value changes (by `isEqual`, Object.is by default). `serverValue` is what
 * the server render and hydration see.
 */
export function useStoreSelector<T, U>(
  store: Subscribable<T>,
  selector: (state: T) => U,
  isEqual: (a: U, b: U) => boolean = Object.is,
  serverValue?: () => U,
): U {
  const getSnapshot = useMemo(() => memoSelector(store, selector, isEqual), [store, selector, isEqual])
  return useSyncExternalStore(store.subscribe, getSnapshot, serverValue ?? getSnapshot)
}
