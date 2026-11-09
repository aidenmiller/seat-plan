import { expect, type Page } from '@playwright/test'

/** The password this run's server was started with (made up per run). */
export function sitePassword(): string {
  const value = process.env.E2E_SITE_PASSWORD
  if (!value) throw new Error('E2E_SITE_PASSWORD is not set; run through playwright.config.ts')
  return value
}

export async function signIn(page: Page, next = '/'): Promise<void> {
  await page.goto(next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`)
  await page.getByLabel('Password').fill(sitePassword())
  await page.getByRole('button', { name: 'Enter' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}
