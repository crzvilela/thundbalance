import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { SITE_IMAGES } from './siteImages.js'
import { canPrefetch } from './prefetch.js'

const folder = new URL('../../public/site-images/', import.meta.url)
const size = (name) => statSync(new URL(name, folder)).size

test('every JPG of the site has WebP and AVIF copies, smaller than the original, and its size is in the manifest (no layout shift)', () => {
  const jpgs = readdirSync(folder).filter(name => /\.jpe?g$/i.test(name))
  assert.ok(jpgs.length >= 4)
  for (const file of jpgs) {
    const name = file.replace(/\.[^.]+$/, '')
    const entry = SITE_IMAGES[name]
    assert.ok(entry, `${name} is missing from src/utils/siteImages.js (run npm run optimize:images)`)
    assert.ok(entry.width > 0 && entry.height > 0, `${name} has no width/height`)
    for (const suffix of ['', `-${entry.small}`]) {
      for (const extension of ['webp', 'avif']) {
        const copy = `${name}${suffix}.${extension}`
        assert.ok(existsSync(new URL(copy, folder)), `${copy} is missing`)
        assert.ok(size(copy) < size(file), `${copy} is not smaller than ${file}`)
      }
    }
  }
})

test('the picture helper gives bundled images width, height, lazy loading and AVIF/WebP sources; the first screen image is eager and high priority', async () => {
  const source = readFileSync(new URL('../components/OptimizedPicture.jsx', import.meta.url), 'utf8')
  assert.match(source, /loading: priority \? 'eager' : 'lazy'/)
  assert.match(source, /fetchPriority: 'high'/)
  assert.match(source, /decoding: 'async'/)
  assert.match(source, /type="image\/avif"/)
  assert.match(source, /type="image\/webp"/)
  assert.match(source, /width: bundled\.width, height: bundled\.height/)
  assert.match(readFileSync(new URL('../components/Hero.jsx', import.meta.url), 'utf8'), /\spriority\s*\r?\n/)           // the hero is the one that is not lazy
  assert.match(readFileSync(new URL('../components/editor/SectionBackground.jsx', import.meta.url), 'utf8'), /<OptimizedPicture/)
})

test('nothing is prefetched when the visitor asked to save data or is on a 2G connection', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const set = (connection) => Object.defineProperty(globalThis, 'navigator', { value: { connection }, configurable: true })
  try {
    set({ saveData: true, effectiveType: '4g' }); assert.equal(canPrefetch(), false)
    set({ saveData: false, effectiveType: '2g' }); assert.equal(canPrefetch(), false)
    set({ saveData: false, effectiveType: 'slow-2g' }); assert.equal(canPrefetch(), false)
    set({ saveData: false, effectiveType: '4g' }); assert.equal(canPrefetch(), true)
    set(undefined); assert.equal(canPrefetch(), true)
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original)
  }
})

test('the font files have unicode-range, so the Latin-extended part is only downloaded when a text needs it', () => {
  const css = readFileSync(new URL('../fonts.css', import.meta.url), 'utf8')
  const faces = css.match(/@font-face\s*\{[^}]*\}/g)
  assert.ok(faces.length > 50)
  for (const face of faces) assert.match(face, /unicode-range:/)
})
