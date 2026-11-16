// Why is a module in the entry chunk? Prints one import chain from the entry file to every module that matches (development tool).
//   node scripts/bundle-why.mjs stats.json libphonenumber-js
import { readFileSync } from 'node:fs'

const [file, needle] = process.argv.slice(2)
const stats = JSON.parse(readFileSync(file, 'utf8'))
const metas = stats.nodeMetas
const clean = (id) => id.split(String.fromCharCode(92)).join('/')
const entries = Object.entries(metas).filter(([, meta]) => /\/src\/main\.jsx$/.test(clean(meta.id)))
const entry = entries[0] && entries[0][0]
const seen = new Set()
const found = []
function walk(uid, trail) {
  if (seen.has(uid)) return
  seen.add(uid)
  const meta = metas[uid]
  if (!meta) return
  const path = clean(meta.id)
  const here = [...trail, path.split('/src/')[1] || path.split('node_modules/').pop()]
  if (path.includes(needle) && !found.length) found.push(here)
  for (const next of meta.imported || []) walk(next.uid, here)          // static imports only (dynamic ones are `importedDynamic`)
}
walk(entry, [])
console.log(found.length ? found[0].join('\n  -> ') : 'not reachable by static imports from src/main.jsx')
