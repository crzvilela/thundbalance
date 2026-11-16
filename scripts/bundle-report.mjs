// Size of every JS and CSS file of a build (raw and gzip) and what the entry page loads at first.
//   node scripts/bundle-report.mjs [dist]
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

const dist = process.argv[2] || 'dist'
const files = readdirSync(join(dist, 'assets')).filter(name => /\.(js|css)$/.test(name))
const rows = files.map(name => {
  const body = readFileSync(join(dist, 'assets', name))
  return { name, raw: body.length, gzip: gzipSync(body).length }
}).sort((a, b) => b.gzip - a.gzip)
const kb = (n) => (n / 1024).toFixed(1).padStart(8)
console.log('file'.padEnd(46), '     raw kB', '  gzip kB')
for (const row of rows.slice(0, 25)) console.log(row.name.padEnd(46), kb(row.raw), kb(row.gzip))
const total = rows.reduce((sum, row) => ({ raw: sum.raw + row.raw, gzip: sum.gzip + row.gzip }), { raw: 0, gzip: 0 })
console.log('TOTAL js+css (' + rows.length + ' files)'.padEnd(36), kb(total.raw), kb(total.gzip))

// what index.html loads before anything else: the entry script, its static imports (modulepreload) and the stylesheets
const html = readFileSync(join(dist, 'index.html'), 'utf8')
const first = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g)].map(match => match[1].replace('assets/', ''))
let raw = 0, gzip = 0
for (const name of first) { const row = rows.find(item => item.name === name); if (row) { raw += row.raw; gzip += row.gzip } }
console.log('\nFIRST LOAD (index.html): ' + first.join(', '))
console.log('first-load js+css'.padEnd(46), kb(raw), kb(gzip))
const entry = html.match(/<script[^>]+type="module"[^>]+src="\/assets\/([^"]+)"/)
if (entry) { const row = rows.find(item => item.name === entry[1]); console.log('ENTRY chunk ' + entry[1], kb(row.raw), kb(row.gzip)) }
export {}
