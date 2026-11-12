/**
 * Helpers for the people, account and admin specs: accounts made for one
 * test (so changing a password or turning an account off never touches the
 * run's shared accounts), signing in with them, another device, and the
 * one-time link a dialog shows.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { dbCreateUser } from './db'
import { presetAuthor } from './helpers'

export type Account = { id: string; email: string; displayName: string; password: string }

/** A made-up password no real account uses. */
export function madeUpPassword(): string {
  return `e2e-${randomBytes(12).toString('hex')}`
}

/** A unique email on the run's test domain. */
export function uniqueEmail(label: string): string {
  return `${label.toLowerCase()}-${randomUUID().slice(0, 8)}@e2e.seat-plan.test`
}

/** A planner account only this test uses. */
export async function newAccount(label: string): Promise<Account> {
  const email = uniqueEmail(label)
  const password = madeUpPassword()
  const displayName = `${label} ${randomBytes(2).toString('hex')}`
  const id = await dbCreateUser(email, displayName, password)
  return { id, email, displayName, password }
}

/** Signs a page in with an email and password, from the sign-in page. */
export async function signInWith(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

/** Another device: a fresh browser context with its own cookies, the author already picked. */
export async function newDevice(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext()
  await presetAuthor(context, 'Noa')
  return { context, page: await context.newPage() }
}

/** The address an invite or reset dialog shows once, after it is made. */
export async function readOneTimeLink(page: Page): Promise<string> {
  const box = page.getByTestId('one-time-link-url')
  await expect(box).toHaveValue(/^https?:\/\/[^#]+#[A-Za-z0-9_-]{43}$/)
  return box.inputValue()
}
