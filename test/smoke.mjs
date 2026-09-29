// Smoke test: the whole app on a throwaway library, driven over DevTools, then closed and deleted. No network needed.
//   npm run smoke                     the source
//   npm run smoke -- dist             the packaged build (npm run dist first)
//   npm run smoke -- <models dir>     also run the tagger (the folder holding pixai-tagger-v1.0-fp16; linked, never touched)
//   EPIPHANY_SMOKE_AT=x,y             where the window goes (a second screen), else where Windows puts it
import { spawn } from 'child_process'
import { createRequire } from 'module'
import assert from 'assert'
import fs from 'fs'
import os from 'os'
import path from 'path'

const root = path.join(import.meta.dirname, '..'), args = process.argv.slice(2)
const packed = args.includes('dist'), models = args.find(a => a !== 'dist')
const sleep = ms => new Promise(r => setTimeout(r, ms))

// The library: two danbooru pictures sharing tags (so piles form), a right-click save without a sidecar, one whose sidecar was cut off.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'epiphany-smoke-')), data = path.join(home, 'project', 'default', 'dataset')
fs.mkdirSync(data, { recursive: true })
const booru = { category: 'danbooru', id: 1, tag_string_general: '1girl solo', tag_string_character: 'hatsune_miku', tag_string_copyright: 'vocaloid', tag_string_artist: 'someone', rating: 'g' }
const pics = { 'booru1.webp': booru, 'booru2.webp': booru, 'saved.webp': null, 'broken.webp': '{' }
for (const [f, j] of Object.entries(pics)) {
  fs.copyFileSync(path.join(import.meta.dirname, 'half.webp'), path.join(data, f))
  if (j) fs.writeFileSync(path.join(data, f + '.json'), typeof j === 'string' ? j : JSON.stringify(j))
  if (j?.id) fs.writeFileSync(path.join(data, f.replace('.webp', '.txt')), '1girl, solo')
  fs.appendFileSync(path.join(data, 'meta.jsonl'), JSON.stringify({ file: path.join(data, f), src: 'https://example.com/a.webp', page: 'https://example.com/post', time: new Date().toISOString() }) + '\n')
}
fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ lookup: false, autotag: false, quote: 'none', sites: [] }))
fs.mkdirSync(path.join(home, 'cache'))
fs.writeFileSync(path.join(home, 'cache', 'tag-wiki.json'), JSON.stringify({ '': 'smoke', solo: 'Only one character.' })) // '': the first-start pull is done
if (process.env.EPIPHANY_SMOKE_AT) { const [x, y] = process.env.EPIPHANY_SMOKE_AT.split(',').map(Number); fs.writeFileSync(path.join(home, 'window.json'), JSON.stringify({ bounds: { x, y, width: 1200, height: 800 } })) }
if (models) fs.symlinkSync(path.resolve(models), path.join(home, 'models'), 'junction') // rmSync below unlinks it, the model stays

const devtools = 9300 + Math.floor(Math.random() * 300), server = devtools + 1
const exe = packed ? path.join(root, 'dist', 'win-unpacked', 'Epiphany.exe') : createRequire(import.meta.url)('electron')
const app = spawn(exe, [...packed ? [] : [root], `--remote-debugging-port=${devtools}`, `--user-data-dir=${path.join(home, 'ud')}`],
  { env: { ...process.env, EPIPHANY_HOME: home, EPIPHANY_PORT: String(server) }, stdio: ['ignore', 'ignore', 'pipe'] })
let log = ''
app.stderr.on('data', d => log += d)

// The page over DevTools: js(body) runs body in an async function there and returns its value; its errors are collected.
const errors = []
let ws, id = 0
const pending = {}
const send = (method, params = {}) => new Promise(r => { pending[++id] = r; ws.send(JSON.stringify({ id, method, params })) })
const js = async body => {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true, userGesture: true })
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text)
  return r.result.result.value
}
const until = async (cond, what, ms = 10000) => { const t = Date.now(); while (!await js(`return ${cond}`)) { if (Date.now() - t > ms) throw new Error('timed out: ' + what); await sleep(100) } }

const steps = []
const step = (name, f) => steps.push([name, f])
step('library loads, a cut-off sidecar with it', async () => {
  await until('typeof items !== "undefined" && items?.length === 4', 'items')
  assert.equal(await js(`return $('#lobby').dataset.tally`), '4 images, 2 tags')
})
step('pending pill filters and lets go', async () => {
  assert.equal(await js('return pendingUI.textContent'), '2 pending')
  await js('pendingUI.click()'); await until('shown(page()).length === 2', 'pending shown')
  await js('pendingUI.click()'); await until('shown(page()).length === 4', 'all shown')
})
step('right-click: everything but a choice; on the filter button, all off', async () => {
  const rc = sel => js(`${sel}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))`)
  await rc(`filters.querySelector('[data-name=tagged] [value=pending]')`); await until(`shown(page()).length === 2 && F.tagged === '!pending'`, 'all but pending')
  await rc(`$('.filter-toggle')`); await until(`shown(page()).length === 4 && !F.tagged`, 'all off')
})
step('search filters, a tag gets its wiki in the title', async () => {
  await js(`search.value = 'solo'; search.dispatchEvent(new Event('input'))`)
  await until('shown(page()).length === 2', 'search result')
  await until(`h1.title === 'Only one character.'`, 'wiki in the title')
  await js(`$('.search .clear-q').click()`); await until('shown(page()).length === 4', 'search cleared')
})
step('piles by tags and by characters', async () => {
  await js('pilesUI.click()'); await until(`page().querySelectorAll('.pile').length === 2`, 'tag piles')
  await js(`filters.querySelector('[data-name=piles] [value=character]').click()`)
  await until(`[...page().querySelectorAll('.pile')].map(p => p.textContent).join() === 'hatsune miku2'`, 'character pile')
  await js(`filters.querySelector('[data-name=piles] [value=character]').click(); pilesUI.click()`)
  await until(`!page().querySelector('.piles') && !flight`, 'back to the grid')
})
step('preview shows the tags, the head from the sidecar under them', async () => {
  await js(`shown(page()).find(i => i.dataset.file.endsWith('booru1.webp')).click()`); await until('dlg.open', 'preview open')
  await until(`dlg.querySelector('textarea').value === '1girl, solo'`, 'tags')
  assert.equal(await js(`return dlg.querySelector('.head').textContent`), 'general, hatsune miku, vocaloid, @someone')
  assert.equal(await js(`return dlg.querySelector('.tagged').textContent`), 'Tags from danbooruLook up / Tag')
  await js('dlg.close()')
})
step('tags written by hand stay in the .txt, the sidecar untouched', async () => {
  await js(`await api.setCaption(items.find(i => i.file.endsWith('booru1.webp')), 'solo, smile')`)
  assert.equal(fs.readFileSync(path.join(data, 'booru1.txt'), 'utf8'), 'solo, smile')
  assert.equal(await js('return pendingUI.textContent'), '2 pending')
})
step('a field written by hand for several: the page and the heads follow, the tags stay', async () => {
  await js(`await api.setField(items.filter(i => i.file.includes('booru')), 'character', 'kagamine rin, hatsune miku')`)
  await until(`items.filter(i => i.character === 'kagamine_rin, hatsune_miku').length === 2`, 'characters on the page')
  const c = await js(`return api.getCaption(items.find(i => i.file.endsWith('booru1.webp')))`)
  assert.match(c.head, /kagamine rin, hatsune miku/)
  assert.equal(c.tags, 'solo, smile')
})
step('settings pages draw, Instruments lists the tools', async () => {
  for (const h of ['general', 'profile', 'sites']) { await js(`location.hash = '#${h}'`); await until(`$('#${h} ul').children.length > 1`, h) }
  await js(`location.hash = '#instruments'`); await until(`$('#instruments ul').children.length === 4`, 'instruments', 20000)
  await js(`location.hash = '#lobby'`)
})
step('local server: only the extension, only web URLs', async () => {
  const post = (body, headers = {}) => fetch(`http://127.0.0.1:${server}/`, { method: 'POST', body: JSON.stringify(body), headers })
  assert.equal((await post({ page: 'https://example.com' })).status, 403)
  const r = await post({ page: 'file:///C:/Windows' }, { Origin: 'chrome-extension://smoke' })
  assert.equal(r.status, 500); assert.match(await r.text(), /Not a web URL/)
})
if (models) step('tagger tags a WebP', async () => {
  await js(`await api.tag([items.find(i => i.file.endsWith('saved.webp'))])`)
  await until(`items.find(i => i.file.endsWith('saved.webp')).tagged === 'tagger'`, 'tagged')
})
step('nothing left running, no page errors', async () => {
  await until('running.length === 0', 'tasks done')
  assert.deepEqual(errors, [])
})

let failed = false
try {
  for (let t = Date.now(); !ws; await sleep(200)) {
    if (Date.now() - t > 30000) throw new Error('no page over DevTools')
    const page = await fetch(`http://127.0.0.1:${devtools}/json/list`).then(r => r.json()).then(l => l.find(p => p.url.endsWith('index.html')), () => null)
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no }) }
  }
  ws.onmessage = e => {
    const m = JSON.parse(e.data)
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description?.split('\n')[0] ?? m.params.exceptionDetails.text)
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '))
    pending[m.id]?.(m)
  }
  await send('Runtime.enable')
  for (const [name, f] of steps) {
    try { await f(); console.log('ok  ', name) }
    catch (e) { failed = true; console.log('FAIL', name, '\n    ', e.message) }
  }
} catch (e) { failed = true; console.log('FAIL', e.message) }
ws?.close()
app.kill()
await new Promise(r => app.once('exit', r))
if (failed && log.trim()) console.log('\nmain process:\n' + log.trim().split('\n').slice(-15).join('\n'))
await sleep(500) // the renderer lets go of the thumbs
fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 })
console.log(failed ? 'smoke: failed' : `smoke: ok (${packed ? 'packaged' : 'source'}${models ? ', with the tagger' : ''})`)
process.exit(failed ? 1 : 0)
