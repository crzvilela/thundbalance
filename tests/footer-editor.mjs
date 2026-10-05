import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// Isolated browser test: auth and API are mocked, no live site data is changed.
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
let published = { sections: { footer: { contactEmail: 'studio@example.com', mapEmbedUrl: 'https://www.google.com/maps?q=Barcelona&output=embed' } } }
let failSave = false
let saves = 0
await context.route('**/*', async route => {
  const url = new URL(route.request().url())
  if (url.pathname === '/src/components/admin/RequireAdmin.jsx') return route.fulfill({ contentType: 'application/javascript', body: 'export default function RequireAdmin({children}) { return children }' })
  if (url.pathname === '/src/api/admin.js') return route.fulfill({ contentType: 'application/javascript', body: 'export const adminFetch = (url, options) => fetch(url, options)' })
  if (url.pathname === '/landing-page/content') return route.fulfill({ json: { content: published } })
  if (url.pathname === '/landing-page/footer') {
    saves++
    if (failSave) return route.fulfill({ status: 500, json: { detail: 'test failure' } })
    const payload = route.request().postDataJSON()
    assert.deepEqual(payload.previous_footer, published.sections.footer)
    published = { sections: { footer: payload.footer } }
    return route.fulfill({ json: { message: 'Saved' } })
  }
  return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort()
})
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('dialog', dialog => dialog.accept())
try {
  await page.goto('http://127.0.0.1:5173/admin/footer')
  const save = page.getByRole('button', { name: 'Save Changes', exact: true })
  await save.waitFor()
  assert.equal(await save.isDisabled(), true)
  await page.getByLabel('Heading', { exact: true }).fill('Say hello')
  const preview = page.frameLocator('iframe[title="Live footer preview"]')
  await preview.getByRole('heading', { name: 'Say hello' }).waitFor()
  await page.getByRole('button', { name: '+ Add contact item' }).click()
  await page.getByLabel('Email', { exact: true }).last().fill('new@example.com')
  await preview.getByText('new@example.com', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Move new@example.com up', exact: true }).click()
  const newItem = page.locator('.footer-item').filter({ has: page.locator('input[value="new@example.com"]') })
  await newItem.getByLabel('Visible', { exact: true }).uncheck()
  await preview.getByText('new@example.com', { exact: true }).waitFor({ state: 'hidden' })
  await newItem.getByLabel('Visible', { exact: true }).check()
  await page.getByRole('button', { name: '+ Add social link' }).click()
  await page.getByLabel('Platform', { exact: true }).last().fill('LinkedIn')
  await page.getByLabel('URL', { exact: true }).last().fill('https://linkedin.com/company/studio')
  await page.getByLabel('Location / Address', { exact: true }).fill('Porto Portugal')
  assert.match(await page.locator('iframe[title="Location preview"]').getAttribute('src'), /Porto%20Portugal/)
  failSave = true
  await save.click()
  await page.getByRole('alert').filter({ hasText: 'Could not save' }).waitFor()
  assert.equal(await page.getByLabel('Heading', { exact: true }).inputValue(), 'Say hello')
  failSave = false
  await save.click()
  await page.getByText('Footer saved. Your changes are now live on the website.').waitFor()
  assert.equal(await save.isDisabled(), true)
  assert.equal(published.sections.footer.contactItems.at(-2).value, 'new@example.com')
  assert.equal(saves, 2)
  await page.getByLabel('Heading', { exact: true }).fill('Discard this')
  await page.getByRole('button', { name: 'Discard Changes' }).click()
  assert.equal(await page.getByLabel('Heading', { exact: true }).inputValue(), 'Say hello')
  await page.reload()
  await page.getByLabel('Heading', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('Heading', { exact: true }).inputValue(), 'Say hello')
  assert.equal(await save.isDisabled(), true)
  fs.mkdirSync('artifacts/footer-editor', { recursive: true })
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await page.screenshot({ path: 'artifacts/footer-editor/desktop.png' })
  await page.getByRole('button', { name: 'Mobile', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  await page.screenshot({ path: 'artifacts/footer-editor/mobile.png' })
  assert.deepEqual(errors, [])
  console.log('Footer editor browser checks passed (preview, map, contacts, social links, save failure/retry, discard, mobile)')
} finally { await browser.close() }
