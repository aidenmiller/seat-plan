import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Store = Map<string, string>

function fakeWindow(store: Store, blocked = false) {
  const storage = {
    getItem: (k: string) => {
      if (blocked) throw new Error('blocked')
      return store.get(k) ?? null
    },
    setItem: (k: string, v: string) => {
      if (blocked) throw new Error('blocked')
      store.set(k, v)
    },
    removeItem: (k: string) => void store.delete(k),
  }
  return { localStorage: storage, addEventListener: vi.fn(), removeEventListener: vi.fn() }
}

/** A fresh copy of the module each time, so its in-memory fallback starts empty. */
async function load() {
  vi.resetModules()
  return import('./author')
}

describe('author', () => {
  let store: Store
  beforeEach(() => {
    store = new Map()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is null on the server', async () => {
    const { getAuthor } = await load()
    expect(getAuthor()).toBeNull()
  })

  it('is null until someone picks, then remembers the plain name', async () => {
    vi.stubGlobal('window', fakeWindow(store))
    const { getAuthor, setAuthor, AUTHOR_KEY } = await load()
    expect(AUTHOR_KEY).toBe('seat-plan:author')
    expect(getAuthor()).toBeNull()
    setAuthor('Aiden')
    expect(store.get(AUTHOR_KEY)).toBe('Aiden')
    expect(getAuthor()).toBe('Aiden')
  })

  it('ignores a stored value that is not Noa or Aiden', async () => {
    store.set('seat-plan:author', 'Bob')
    vi.stubGlobal('window', fakeWindow(store))
    const { getAuthor } = await load()
    expect(getAuthor()).toBeNull()
  })

  it('keeps the choice in memory when storage is blocked', async () => {
    vi.stubGlobal('window', fakeWindow(store, true))
    const { getAuthor, setAuthor } = await load()
    setAuthor('Noa')
    expect(getAuthor()).toBe('Noa')
  })
})
