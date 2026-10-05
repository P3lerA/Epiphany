// Smoke test of the extension in a real Chromium, headless, on a throwaway profile, driven over DevTools. No network needed:
// Epiphany is faked here (whatever goes to 127.0.0.1:7676 is answered here, never reaching a running app), and so is a listed
// site (danbooru's pages are served here).
//   npm run smoke:extension           Playwright's Chromium (branded Chrome no longer loads an unpacked extension from the command line)
//   CHROMIUM=<path> npm run smoke:extension
import { spawn } from 'child_process'
import assert from 'assert'
import fs from 'fs'
import os from 'os'
import path from 'path'

const ext = path.join(import.meta.dirname, '..', 'extension'), sleep = ms => new Promise(r => setTimeout(r, ms))
const find = () => {
  const dir = path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : 'AppData/Local/ms-playwright')
  const builds = fs.existsSync(dir) ? fs.readdirSync(dir).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => b.split('-')[1] - a.split('-')[1]) : []
  const inside = ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']
  return builds.flatMap(b => inside.map(i => path.join(dir, b, i))).find(fs.existsSync)
}
const chromium = process.env.CHROMIUM ?? find()
if (!chromium) { console.log('smoke-extension: no Chromium (npx playwright install chromium, or CHROMIUM=<path>)'); process.exit(1) }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'epiphany-ext-')), port = 9520
const browser = spawn(chromium, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--load-extension=${ext}`,
  `--disable-extensions-except=${ext}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })

// One connection to the browser; a session per target (flatten). Every target is attached as it starts, paused, and gets its
// requests to Epiphany and danbooru answered here before it runs a line: a worker started again later too. Nothing reaches the
// app running on this machine (an earlier version attached to another extension's worker, and a pull went through to it).
let ws, n = 0
const waits = new Map(), handlers = new Map(), errors = []
const send = (method, params = {}, sessionId) => new Promise((ok, no) => {
  const id = ++n
  waits.set(id, m => m.error ? no(new Error(`${method}: ${m.error.message}`)) : ok(m.result))
  ws.send(JSON.stringify({ id, method, params, sessionId }))
})
const on = (method, f) => handlers.set(method, [...handlers.get(method) ?? [], f])
const until = async (what, f, ms = 5000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) { const v = await f(); if (v) return v } throw new Error(`timed out: ${what}`) }
const sessions = new Map() // targetId -> sessionId
const ours = async (sessionId, info) => {
  sessions.set(info.targetId, sessionId)
  await send('Runtime.enable', {}, sessionId)
  await send('Fetch.enable', { patterns: [{ urlPattern: 'http://127.0.0.1:7676/*' }, { urlPattern: 'https://danbooru.donmai.us/*' }] }, sessionId).catch(() => {})
  await send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {})
}
on('Target.attachedToTarget', p => ours(p.sessionId, p.targetInfo))
const session = targetId => until('attached', () => sessions.get(targetId))
on('Runtime.exceptionThrown', p => errors.push(p.exceptionDetails.exception?.description?.split('\n')[0] ?? p.exceptionDetails.text))
const value = async (expression, sessionId, contextId) => {
  const r = await send('Runtime.evaluate', { expression, contextId, awaitPromise: true, returnByValue: true }, sessionId)
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] ?? r.exceptionDetails.text)
  return r.result.value
}

// Epiphany, faked, answering in lines: a pull of a page with "slow" in it holds until it is stopped (or let go, held); any other
// gets two pictures. (An answer is sent whole here: how far a pull is, line by line, is extension-queue.mjs's.)
const posts = [], held = new Map()
const answer = (sessionId, requestId, code, body) => send('Fetch.fulfillRequest', { requestId, responseCode: code,
  responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(body).toString('base64') }, sessionId)
const app = (p, s) => {
  if (p.request.method === 'GET') return answer(s, p.requestId, 200, '{"project":"smoke"}') // where a pull goes, as the app says to anyone
  if (p.request.method !== 'POST') return answer(s, p.requestId, 404, '')
  const q = JSON.parse(p.request.postData)
  posts.push(q)
  if (q.stop) { const h = held.get(q.stop); held.delete(q.stop); h?.(); return answer(s, p.requestId, 200, '{}') }
  const say = (...l) => answer(s, p.requestId, 200, l.map(o => JSON.stringify(o) + '\n').join(''))
  if (q.page.includes('slow')) return held.set(q.id, (got = { why: 'Stopped' }) => say(got))
  return say({ n: 1, total: 2 }, { n: 2, total: 2 }, { got: 2 })
}
const site = (p, s) => send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html' }],
  body: Buffer.from('<!doctype html><title>post</title><p>a picture').toString('base64') }, s)
on('Fetch.requestPaused', (p, s) => (p.request.url.startsWith('http://127.0.0.1:7676') ? app : site)(p, s))

let failed = false, worker, id
const contexts = new Map() // a page's session -> the extension's isolated world in it
on('Runtime.executionContextCreated', (p, s) => p.context.auxData?.type === 'isolated' && p.context.name === 'Epiphany' && contexts.set(s, p.context.id))
const open = async url => {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }), s = await session(targetId)
  await send('Page.navigate', { url }, s)
  return s
}
const button = async s => { const c = await until('the Pull button', () => contexts.get(s)); return expr => value(expr, s, c) }
const steps = [
  ['the worker starts, looks.js with it', async () => {
    const name = s => value('chrome.runtime.getManifest().name', s).catch(() => null) // other extensions run a background.js too
    worker = await until("Epiphany's worker", async () => { for (const s of sessions.values()) if (await name(s) === 'Epiphany') return s })
    id = new URL(await value('location.href', worker)).host
    assert.deepEqual(await value('[typeof SPINNERS, typeof spinner, typeof FACES]', worker), ['object', 'function', 'object'])
  }],
  ['Pull pulls, with its spinner and id, then says how many', async () => {
    const b = await button(await open('https://danbooru.donmai.us/posts/1'))
    assert.equal(await b('btn.dataset.state ?? "idle"'), 'idle')
    await b('btn.click()')
    await until('Pulling', async () => await b('btn.dataset.state') === 'busy')
    await until('2 pulled', async () => await b('text.textContent') === '2 pulled')
    const q = posts.at(-1)
    assert.equal(q.page, 'https://danbooru.donmai.us/posts/1')
    assert.ok(await value(`Object.hasOwn(SPINNERS, ${JSON.stringify(q.anim)})`, worker), `anim: ${q.anim}`)
    assert.ok(q.id)
  }],
  ['the badge: ✓ as it lands, then nothing', async () => {
    assert.equal(await value('chrome.action.getBadgeText({})', worker), '✓')
    await until('no badge', async () => await value('chrome.action.getBadgeText({})', worker) === '', 3000)
  }],
  ['✕ stops a pull Epiphany is on', async () => {
    const b = await button(await open('https://danbooru.donmai.us/posts/slow'))
    await b('btn.click()')
    await until('it went out', () => posts.some(q => q.page?.includes('slow')))
    await until('Pulling', async () => await b('btn.dataset.state') === 'busy')
    await b('x.click()')
    await until('Stopped', async () => await b('text.textContent') === 'Stopped')
    assert.equal(posts.at(-1).stop, posts.findLast(q => q.page?.includes('slow')).id)
  }],
  ['back to a page whose pull landed while it was away: how many', async () => {
    const s = await open('https://danbooru.donmai.us/posts/slow-2')
    let b = await button(s)
    await b('btn.click()')
    await until('Pulling', async () => await b('btn.dataset.state') === 'busy')
    await b('window.kept = 1')
    const q = await until('it went out', () => posts.findLast(q => q.page?.endsWith('slow-2')))
    contexts.delete(s)
    await send('Page.navigate', { url: 'https://danbooru.donmai.us/posts/3' }, s)
    await button(s)
    held.get(q.id)({ got: 3 })
    await until('it landed', async () => !(await value('chrome.storage.session.get("out")', worker)).out.length)
    contexts.delete(s)
    const h = await send('Page.getNavigationHistory', {}, s)
    await send('Page.navigateToHistoryEntry', { entryId: h.entries[h.currentIndex - 1].id }, s)
    b = await button(s)
    assert.ok(await b('window.kept'), 'kept by the back/forward cache')
    await until('3 pulled', async () => await b('text.textContent') === '3 pulled')
  }],
  ['back to the page before while the pull is out: its dots beside Pull', async () => {
    const s = await open('https://danbooru.donmai.us/posts?tags=list')
    await button(s)
    contexts.delete(s)
    await send('Page.navigate', { url: 'https://danbooru.donmai.us/posts/slow-4' }, s)
    let b = await button(s)
    await b('btn.click()')
    const q = await until('it went out', () => posts.findLast(q => q.page?.endsWith('slow-4')))
    contexts.delete(s)
    const h = await send('Page.getNavigationHistory', {}, s)
    await send('Page.navigateToHistoryEntry', { entryId: h.entries[h.currentIndex - 1].id }, s)
    b = await button(s)
    await until('its dots', async () => await b('btn.dataset.state') === 'elsewhere')
    assert.equal(await b('text.textContent'), 'Pull')
    held.get(q.id)({ got: 1 })
    await until('Pull, still', async () => await b('btn.dataset.state') === 'idle')
  }],
  ['a site that moves to another post itself (x.com, pixiv): the button follows the page, not the pull', async () => {
    const s = await open('https://danbooru.donmai.us/posts/slow-5')
    const b = await button(s)
    await b('btn.click()')
    const q = await until('it went out', () => posts.findLast(q => q.page?.endsWith('slow-5')))
    await value("history.pushState({}, '', '/posts/6')", s)
    await until('its dots, as another page', async () => await b('btn.dataset.state') === 'elsewhere')
    await value('history.back()', s)
    await until('Pulling again', async () => await b('btn.dataset.state') === 'busy')
    held.get(q.id)({ got: 1 })
    await until('Done', async () => await b('text.textContent') === 'Done')
  }],
  ['Pull while another is out: Queued, then it goes', async () => {
    const a = await button(await open('https://danbooru.donmai.us/posts/slow-3'))
    await a('btn.click()')
    const q = await until('it went out', () => posts.findLast(q => q.page?.endsWith('slow-3')))
    const b = await button(await open('https://danbooru.donmai.us/posts/4'))
    await until('its dots', async () => await b('btn.dataset.state') === 'elsewhere')
    await b('btn.click()')
    await until('Queued', async () => await b('btn.dataset.state') === 'queued')
    held.get(q.id)({ got: 1 })
    await until('2 pulled', async () => await b('text.textContent') === '2 pulled')
  }],
  ['the panel opens: a face, Epiphany in reach', async () => {
    const { targetId } = await send('Target.createTarget', { url: `chrome-extension://${id}/popup.html` }), s = await session(targetId)
    await until('the panel drawn', () => value('document.querySelector("main")?.childElementCount', s))
    await sleep(300) // its reach check
    assert.ok(await value('document.querySelector(".face")?.textContent', s))
    assert.equal(await value('!!document.querySelector(".away")', s), false)
    assert.equal(await value('document.querySelector(".here")?.textContent', s), 'Current project: smoke')
  }],
  ['nothing threw', async () => assert.deepEqual(errors, [])]
]

try {
  const { webSocketDebuggerUrl } = await until('Chromium', () => fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.json(), () => null), 15000)
  ws = new WebSocket(webSocketDebuggerUrl)
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no })
  ws.onmessage = e => {
    const m = JSON.parse(e.data)
    if (m.id) { waits.get(m.id)?.(m); waits.delete(m.id) }
    else handlers.get(m.method)?.forEach(f => f(m.params, m.sessionId))
  }
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true })
  for (const t of (await send('Target.getTargets')).targetInfos) if (t.type === 'service_worker' && !sessions.has(t.targetId)) ours((await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).sessionId, t) // already running
  for (const [name, f] of steps) {
    try { await f(); console.log('ok  ', name) }
    catch (e) { failed = true; console.log('FAIL', name, '\n    ', e.message) }
  }
} catch (e) { failed = true; console.log('FAIL', e.message) }
await send('Browser.close').catch(() => {})
ws?.close()
await new Promise(r => browser.exitCode === null ? browser.once('exit', r) : r())
fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 })
console.log(failed ? 'smoke-extension: failed' : 'smoke-extension: ok')
process.exit(failed ? 1 : 0)
