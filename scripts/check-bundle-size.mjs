// Fails when the site gets heavier than its budget (scripts/bundle-budget.json), so that it never grows again without anybody noticing.
//   npm run build && npm run check:size
// Numbers are gzip kB. firstLoad = what index.html downloads before anything else (the entry script, the chunks it imports, the CSS):
// that is what every visitor of the landing page pays. The limits are the measured value after the optimisation plus about 15 %.
import { readFileSync, readdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

const dist = process.argv[2] || 'dist'
const budget = JSON.parse(readFileSync(new URL('./bundle-budget.json', import.meta.url), 'utf8'))
const gz = (name) => gzipSync(readFileSync(join(dist, 'assets', name))).length / 1024
const html = readFileSync(join(dist, 'index.html'), 'utf8')
const firstFiles = [...html.matchAll(/(?:src|href)="\/assets\/([^"]+\.(?:js|css))"/g)].map(match => match[1])
const entryName = (html.match(/<script[^>]+type="module"[^>]+src="\/assets\/([^"]+)"/) || [])[1]
const sizes = {
  entry: entryName ? gz(entryName) : Infinity,
  firstLoad: firstFiles.reduce((sum, name) => sum + gz(name), 0),
  firstLoadJs: firstFiles.filter(name => name.endsWith('.js')).reduce((sum, name) => sum + gz(name), 0),
  largestChunk: Math.max(...readdirSync(join(dist, 'assets')).filter(name => name.endsWith('.js')).map(gz)),
}
let failed = false
for (const [name, limit] of Object.entries(budget.limitsKb)) {
  const value = sizes[name]
  const over = value > limit
  failed ||= over
  console.log(`${over ? 'FAIL' : 'ok  '} ${name.padEnd(13)} ${value.toFixed(1).padStart(7)} kB gzip   (limit ${limit})`)
}
// nothing that only a few pages use may be downloaded by the landing page
for (const forbidden of budget.notInFirstLoad) {
  const hit = firstFiles.find(name => name.startsWith(forbidden))
  if (hit) { failed = true; console.log(`FAIL ${forbidden}* is in the first load (${hit})`) }
}
if (failed) { console.error('\nThe site is heavier than its budget. Find out why with: node scripts/bundle-modules.mjs (docs/PERFORMANCE.md).'); process.exit(1) }
