import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { footerElement, footerElementStyle } from '../src/utils/footerElements.js'

assert.equal(footerElement({}, 'youtube').url, 'https://www.youtube.com/@thundbalance3668')
const styled = footerElementStyle({ width: 46, layout: { desktop: { x: 90, width: 70 }, mobile: { x: -5 } } })
assert.equal(styled['--fe-width-desktop'], '70px')
assert.equal(styled['--fe-x-mobile'], '-5px')

const base = 'http://127.0.0.1:5173'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
let draft = { sections: {}, sectionOrder: [] }
let published
const errors = []
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
const html = `<!doctype html><html><body><div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
const {default:React} = await import('/node_modules/.vite/deps/react.js');
const {default:{createRoot}} = await import('/node_modules/.vite/deps/react-dom_client.js');
const {LandingContentProvider,useLandingContent} = await import('/src/content/LandingContentContext.jsx');
const {I18nProvider} = await import('/src/i18n/I18nContext.jsx');
const {default:Footer} = await import('/src/components/Footer.jsx');
const {default:Panel} = await import('/src/components/editor/PropertiesPanel.jsx');
await import('/src/index.css');
const h=React.createElement;
function Workspace(){const ctx=useLandingContent();return h('div',null,
h('div',null,...['desktop','tablet','mobile'].map(d=>h('button',{onClick:()=>ctx.setDevice(d)},d)),h('button',{onClick:ctx.undo},'Undo'),h('button',{onClick:ctx.redo},'Redo'),h('button',{onClick:ctx.save},'Save'),h('button',{onClick:ctx.publish},'Publish')),
h('div',{style:{display:'flex'}},h('div',{style:{width:ctx.device==='mobile'?390:ctx.device==='tablet'?834:1200}},h(Footer)),h(Panel)));}
createRoot(document.getElementById('root')).render(h(I18nProvider,null,h(LandingContentProvider,{mode:new URLSearchParams(location.search).get('view')?'view':'edit'},h(Workspace))));
</script></body></html>`
try {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/footer-test') return route.fulfill({ contentType: 'text/html', body: html })
    if (url.pathname === '/src/api/admin.js') return route.fulfill({ contentType: 'text/javascript', body: 'export const adminFetch = (url, options) => fetch(url, options)' })
    if (url.pathname.startsWith('/landing-page/')) {
      if (route.request().method() === 'PUT') draft = route.request().postDataJSON().content
      if (url.pathname.endsWith('/publish')) published = route.request().postDataJSON().content
      return route.fulfill({ json: { content: url.searchParams.get('version') === 'published' ? published || draft : draft } })
    }
    if (url.hostname !== '127.0.0.1') return route.abort()
    return route.continue()
  })
  await page.goto(`${base}/footer-test`)
  const item = key => page.locator(`[data-footer-element="${key}"]`)
  await item('contact').click()
  await page.getByRole('textbox', { name: 'Texto', exact: true }).fill('Talk to us')
  await page.getByRole('textbox', { name: 'URL', exact: true }).fill('/#contact-test')
  await page.getByRole('spinbutton', { name: 'Posição horizontal (X)', exact: true }).fill('75')
  assert.equal(await item('contact').evaluate(el => getComputedStyle(el).left), '75px')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  assert.equal(await item('contact').evaluate(el => getComputedStyle(el).left), '0px')
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await item('instagram').click()
  await page.getByRole('combobox', { name: 'Ícone', exact: true }).selectOption('globe')
  await page.getByRole('spinbutton', { name: 'Largura', exact: true }).fill('70')
  await page.getByRole('spinbutton', { name: 'Tamanho do ícone', exact: true }).fill('28')
  assert.equal(await item('instagram').evaluate(el => getComputedStyle(el).width), '70px')
  assert.equal(await item('instagram').locator('svg').evaluate(el => getComputedStyle(el).width), '28px')
  await item('visit').click()
  await page.getByRole('textbox', { name: 'Texto', exact: true }).fill('Find us')
  await item('address').click()
  await page.getByRole('spinbutton', { name: 'Posição vertical (Y)', exact: true }).fill('9')
  await page.getByRole('button', { name: 'Editar Google Maps', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Altura', exact: true }).fill('160')
  assert.equal(await item('map').evaluate(el => getComputedStyle(el).height), '160px')
  await page.getByRole('button', { name: 'mobile', exact: true }).click()
  assert.equal(await item('map').evaluate(el => getComputedStyle(el).height), '112px')
  await page.getByRole('spinbutton', { name: 'Altura', exact: true }).fill('90')
  await Promise.all([page.waitForResponse(response => response.url().endsWith('/landing-page/publish')), page.getByRole('button', { name: 'Publish', exact: true }).click()])
  assert.equal(published.sections.footer.elements.map.layout.mobile.height, 90)
  await page.reload()
  await item('contact').waitFor()
  assert.equal(await item('contact').textContent(), 'Talk to us')
  assert.equal(await item('contact').getAttribute('href'), '/#contact-test')
  assert.equal(await item('map').evaluate(el => getComputedStyle(el).height), '160px')
  await page.goto(`${base}/footer-test?view=true`)
  await item('visit').waitFor()
  assert.equal(await item('visit').textContent(), 'Find us')
  assert.equal(await item('address').evaluate(el => getComputedStyle(el).top), '9px')
  await page.setViewportSize({ width: 390, height: 900 })
  assert.equal(await item('map').evaluate(el => getComputedStyle(el).height), '90px')
  assert.equal(await item('contact').evaluate(el => getComputedStyle(el).left), '0px')
  assert.deepEqual(errors, [])
  console.log('Footer editing: selection, text, URL, icons, size, position, devices, undo/redo, publishing and reload passed')
} finally { await browser.close() }




