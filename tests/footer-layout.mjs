import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const base = 'http://127.0.0.1:5173'
const api = 'http://127.0.0.1:8001'
const getContent = async version => (await (await fetch(`${api}/landing-page/content?version=${version}`)).json()).content
const seed = await getContent('draft')
seed.sections.footer.streetView360EmbedUrl = 'https://www.google.com/maps?layer=c&cbll=41.404704,2.2027016&output=svembed'
// Exercise legacy JSON with no layout fields: defaults must be backfilled.
delete seed.sections.footer.mapLayout
delete seed.sections.footer.streetView360Layout
await fetch(`${api}/landing-page/content/draft`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:seed})})
const browser = await chromium.launch({channel:'msedge',headless:true})
const context = await browser.newContext({viewport:{width:1920,height:1080}})
// Third-party iframes/widgets are not the subject of these local layout tests.
await context.route('**/*', route => {
 const host = new URL(route.request().url()).hostname
 return host === '127.0.0.1' || host === 'localhost' ? route.continue() : route.abort()
})
const page = await context.newPage()
const errors=[]
page.on('pageerror',error=>errors.push(error.message))
const block = key => page.locator(`[data-layout-path="sections.footer.${key}"]`)
const box = async key => block(key).boundingBox()
const choose = async device => {
 await page.getByTitle(device,{exact:true}).click()
 await page.waitForFunction(d=>document.querySelector('[data-layout-path]')?.dataset.editorDevice===d,device.toLowerCase())
 // Wait for the existing canvas width animation, using its computed geometry.
 await page.waitForFunction(() => document.getAnimations().filter(a=>a.effect?.target?.className?.includes?.('transition-[width]')).every(a=>a.playState==='finished'))
}
const fill = async (label,value) => {
 const input = page.getByRole('textbox',{name:label,exact:true})
 await input.fill(value)
 await input.press('Tab')
}
const dimensions = async key => { const r=await box(key); return [Math.round(r.width),Math.round(r.height)] }
const drag = async (label,dx,dy,cancel=false) => {
 const handle = page.getByRole('button',{name:`Resize ${label}`,exact:true})
 await handle.scrollIntoViewIfNeeded()
 const rect=await handle.boundingBox()
 await page.mouse.move(rect.x+12,rect.y+12)
 await page.mouse.down()
 await page.mouse.move(rect.x+12+dx,rect.y+12+dy,{steps:12})
 const feedback=page.locator('.embed-dimensions')
 await feedback.waitFor({state:'visible'})
 assert.match(await feedback.textContent(),/\d+ \u00d7 \d+ px/)
 if(cancel) await page.keyboard.press('Escape')
 await page.mouse.up()
 await feedback.waitFor({state:'detached'})
}
try {
 await page.goto(`${base}/?preview=true`)
 await page.waitForFunction(() => !!document.querySelector('iframe[title^="360"]'))
 for(const [width,expectedWidth] of [[1440,628],[834,381],[390,342]]) {
  await page.setViewportSize({width,height:1080})
  assert.deepEqual(await dimensions('mapLayout'),[expectedWidth,152],'Default map matches original browser measurements')
  assert.deepEqual(await dimensions('streetView360Layout'),[expectedWidth,152],'Default 360 matches original frame')
 }
 await page.setViewportSize({width:1920,height:1080})
 await page.goto(`${base}/admin/landing-editor`)
 await page.getByRole('button',{name:'Edit Map layout',exact:true}).click()
 assert.equal((await dimensions('mapLayout'))[1],152)
 assert.equal((await dimensions('streetView360Layout'))[1],152)
 for (const [device,width,mapHeight,streetHeight] of [['Desktop','70%','270px','310px'],['Tablet','65%','230px','250px'],['Mobile','80%','190px','210px']]) {
  await choose(device)
  for (const [key,label,height] of [['mapLayout','Map',mapHeight],['streetView360Layout','360°',streetHeight]]) {
   const before=await dimensions(key)
   await drag(label,-35,60)
   const resized=await dimensions(key)
   assert.ok(resized[1]>before[1],`${device} ${label}: height increased`)
   assert.equal(await page.getByRole('textbox',{name:`${label} height`,exact:true}).inputValue(),`${resized[1]}px`)
   await page.getByTitle('Undo',{exact:true}).click()
   assert.deepEqual(await dimensions(key),before,`${device} ${label}: one Undo restores both sizes`)
   await page.getByTitle('Redo',{exact:true}).click()
   assert.deepEqual(await dimensions(key),resized)
   await drag(label,-15,25,true)
   assert.deepEqual(await dimensions(key),resized,'Escape cancels without a commit')
   // Keyboard sizing and pointer cancellation share the same saved layout.
   const handle=page.getByRole('button',{name:`Resize ${label}`,exact:true})
   await handle.press('Shift+ArrowDown')
   assert.equal((await dimensions(key))[1],resized[1]+10)
   await page.getByTitle('Undo',{exact:true}).click()
   assert.deepEqual(await dimensions(key),resized)
   await fill(`${label} width`,width)
   await fill(`${label} height`,height)
   assert.equal((await dimensions(key))[1],parseInt(height))
   await fill(`${label} height`,'150%')
   assert.equal((await dimensions(key))[1],228,'Percentage height uses original frame')
   await fill(`${label} height`,height)
   const input=page.getByRole('textbox',{name:`${label} height`,exact:true})
   await input.fill('oops')
   await input.press('Tab')
   assert.equal((await dimensions(key))[1],parseInt(height),'invalid input does not change content')
   await input.press('Escape')
   const select=page.getByRole('combobox',{name:`${label} alignment`,exact:true})
   await select.selectOption('left'); const left=(await box(key)).x
   await select.selectOption('center'); const center=(await box(key)).x
   await select.selectOption('right'); const right=(await box(key)).x
   assert.ok(center>left && right>center,`${device} ${label}: all alignments visibly distinct`)
   for(const [margin,value] of [['top','12'],['bottom','16']]) {
    await page.getByRole('spinbutton',{name:`${label} margin ${margin}`,exact:true}).fill(value)
   }
   assert.equal(await block(key).evaluate(el=>getComputedStyle(el).marginTop),'12px')
  }
  await block('mapLayout').scrollIntoViewIfNeeded()
  await page.screenshot({path:`artifacts/footer-layout/editor-${device.toLowerCase()}.png`})
  console.log(`PASS: ${device} drag, feedback, numeric fields, alignment, margins, undo/redo, cancel (map + 360)`)
 }
 const saved=page.waitForResponse(r=>r.url().endsWith('/landing-page/content/draft') && r.request().method()==='PUT')
 await page.getByRole('button',{name:'Save Changes',exact:true}).click(); assert.equal((await saved).status(),200)
 const draft=await getContent('draft')
 for(const device of ['desktop','tablet','mobile']) assert.ok(draft.sections.footer.mapLayout.width[device])
 const [preview]=await Promise.all([context.waitForEvent('page'),page.getByRole('button',{name:'Preview',exact:true}).click()])
 await preview.waitForSelector('[data-layout-path]')
 assert.equal(new URL(preview.url()).searchParams.get('preview'),'true')
 await preview.close()
 const publishedResponse=page.waitForResponse(r=>r.url().endsWith('/landing-page/publish'))
 const [publicPage]=await Promise.all([context.waitForEvent('page'),page.getByRole('button',{name:'Publish',exact:true}).click()])
 assert.equal((await publishedResponse).status(),200)
 const published=await getContent('published')
 for(const field of ['instagramUrl','contactEmail','whatsappLink','mapEmbedUrl','streetView360EmbedUrl','address']) assert.deepEqual(published.sections.footer[field],seed.sections.footer[field])
 assert.deepEqual(published.sections.footer.mapLayout,draft.sections.footer.mapLayout)
 assert.deepEqual(published.sections.footer.streetView360Layout,draft.sections.footer.streetView360Layout)
 await publicPage.waitForSelector('[data-layout-path]')
 await publicPage.waitForFunction(() => document.querySelector('[data-layout-path]')?.style.getPropertyValue('--embed-desktop-height') === '270px')
 for(const [viewport,device] of [[1440,'desktop'],[1024,'desktop'],[1023,'tablet'],[834,'tablet'],[768,'tablet'],[767,'mobile'],[390,'mobile']]) {
  await publicPage.setViewportSize({width:viewport,height:1000})
  for(const key of ['mapLayout','streetView360Layout']) {
   const actual=await publicPage.locator(`[data-layout-path="sections.footer.${key}"]`).evaluate(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,parent:el.parentElement.clientWidth,margin:getComputedStyle(el).marginTop}))
   const expected=published.sections.footer[key]
   assert.equal(Math.round(actual.height),parseInt(expected.height[device]))
   assert.ok(Math.abs(actual.width-actual.parent*parseFloat(expected.width[device])/100)<1)
   assert.equal(actual.margin,'12px')
  }
  if([1440,834,390].includes(viewport)) {
   await publicPage.locator('footer').scrollIntoViewIfNeeded()
   await publicPage.screenshot({path:`artifacts/footer-layout/public-${device}.png`})
  }
 }
 await page.reload(); await block('mapLayout').waitFor()
 await choose('Tablet')
 assert.equal((await dimensions('mapLayout'))[1],230)
 assert.equal((await dimensions('streetView360Layout'))[1],250)
 assert.deepEqual(errors,[],'No page JavaScript errors')
 fs.writeFileSync('artifacts/footer-layout/published-layouts.json',JSON.stringify({map:published.sections.footer.mapLayout,streetView360:published.sections.footer.streetView360Layout},null,2))
 console.log('PASS: local backend Save/Publish, Preview, editor reload, public CSS at 7 widths, no runtime errors')
} finally { await browser.close() }
