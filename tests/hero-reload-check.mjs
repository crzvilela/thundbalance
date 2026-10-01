import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
try {
  await page.route('**/maps**', route => route.abort())
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => [...document.querySelectorAll('section img')].some(img => img.src.includes('108f9a4c86e04266aecb3e54c2eb43a3') && img.complete && img.naturalWidth > 0))
  console.log('Real published upload decoded successfully')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => [...document.querySelectorAll('section img')].some(img => img.src.includes('108f9a4c86e04266aecb3e54c2eb43a3') && img.complete && img.naturalWidth > 0))
  await page.screenshot({ path: 'artifacts/hero-live-reload.png' })
  await page.route('**/uploads/108f9a4c86e04266aecb3e54c2eb43a3.jpg', route => route.abort())
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('section img[data-fallback-applied="true"]').waitFor()
  const fallback = page.locator('section img[data-fallback-applied="true"]')
  await fallback.evaluate(img => img.decode())
  assert.match(await fallback.getAttribute('src'), /site-images\/hero.jpg/)
  console.log('Reload with failed upload keeps decoded local hero.jpg; uploaded image is not locked')
} finally { await browser.close() }
