// What is inside a chunk, by package / folder (development tool, reads the stats of rollup-plugin-visualizer):
//   STATS_FILE=stats.json npx vite build --config tests/perf/analyze.config.mjs --outDir /tmp/analysis
//   node scripts/bundle-modules.mjs stats.json assets/index-
import { readFileSync } from 'node:fs'

const [file, prefix = 'assets/'] = process.argv.slice(2)
const stats = JSON.parse(readFileSync(file, 'utf8'))
const bySource = {}
for (const meta of Object.values(stats.nodeMetas)) {
  for (const [bundle, uid] of Object.entries(meta.moduleParts)) {
    if (!bundle.startsWith(prefix)) continue
    const path = meta.id.split(String.fromCharCode(92)).join('/')
    let key
    if (path.includes('node_modules/')) {
      const rest = path.split('node_modules/').pop().split('/')
      key = rest[0].startsWith('@') ? rest.slice(0, 2).join('/') : rest[0]
    } else {
      key = 'src/' + (path.split('/src/')[1] || path).split('/').slice(0, 2).join('/')
    }
    bySource[key] = (bySource[key] || 0) + stats.nodeParts[uid].renderedLength
  }
}
const rows = Object.entries(bySource).sort((a, b) => b[1] - a[1]).slice(0, 25)
for (const [name, size] of rows) console.log((size / 1024).toFixed(1).padStart(8) + ' kB  ' + name)
