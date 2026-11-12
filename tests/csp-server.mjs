// Serves a build of the site (dist/) WITH the real headers of vercel.json, to check the Content-Security-Policy in a browser.
//
//   node tests/csp-server.mjs [--dist dist] [--port 5173] [--api http://127.0.0.1:8000[,http://localhost:8000]]
//
// - the headers are the ones of vercel.json (the policy that Vercel sends in production);
// - --api: a build made with VITE_API_URL pointing at a local backend calls that address instead of Render; the policy then
//   allows it too (only here, only for the check: vercel.json is never changed);
// - every page gets a small script (/__csp_probe.js) that records each `securitypolicyviolation` event in window.__cspViolations,
//   so a test (tests/csp-pages.spec.mjs) or a person looking at the console can see exactly what the policy blocked.
// Port 5173 is the one the local backend allows in CORS when ENV=development.
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = resolve(here, '..')

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain', '.xml': 'application/xml', '.mp4': 'video/mp4'
}

const PROBE = `(function(){window.__cspViolations=[];document.addEventListener('securitypolicyviolation',function(e){window.__cspViolations.push({directive:e.violatedDirective,blocked:e.blockedURI,page:location.pathname,source:e.sourceFile||'',sample:(e.sample||'').slice(0,80)})})})();`

export function productionHeaders(api) {
  const config = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'))
  const rule = config.headers.find(item => item.source === '/(.*)')
  const headers = {}
  for (const { key, value } of rule.headers) {
    headers[key] = api && key === 'Content-Security-Policy' ? value.replaceAll('https://thundbalance.onrender.com', `https://thundbalance.onrender.com ${api.split(',').join(' ')}`) : value
  }
  return headers
}

export function start({ dist = 'dist', port = 5173, api = '' } = {}) {
  const base = resolve(root, dist)
  const headers = productionHeaders(api)
  const server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url, 'http://x').pathname)
      if (path === '/__csp_probe.js') {
        response.writeHead(200, { 'Content-Type': 'text/javascript', ...headers })
        return response.end(PROBE)
      }
      let file = normalize(join(base, path))
      if (!file.startsWith(base)) { response.writeHead(403); return response.end() }
      let isFile = existsSync(file) && (await stat(file)).isFile()
      if (!isFile) file = join(base, 'index.html')                                   // the site's rewrite: every path is the app
      let body = await readFile(file)
      const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream'
      if (file.endsWith('index.html')) body = Buffer.from(body.toString('utf8').replace('<head>', '<head><script src="/__csp_probe.js"></script>'))
      response.writeHead(200, { 'Content-Type': type, ...headers })
      response.end(body)
    } catch {
      response.writeHead(500)
      response.end()
    }
  })
  return new Promise(done => server.listen(port, '127.0.0.1', () => done(server)))
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
  const port = Number(option('--port', '5173'))
  await start({ dist: option('--dist', 'dist'), port, api: option('--api', '') })
  console.log(`CSP check server: http://127.0.0.1:${port}/  (dist=${option('--dist', 'dist')})`)
}
