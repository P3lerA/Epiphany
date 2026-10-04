// The extension's waiting list, against a fake chrome and fetch: node test/extension-queue.mjs
import fs from 'fs'
import assert from 'assert'
let store = {}, session = {}, badge = { global: '' }, up = false, fail = new Set(), sent = []
const on = () => { const l = []; return { addListener: f => l.push(f), fire: (...a) => Promise.all(l.map(f => f(...a))) } }
globalThis.chrome = {
  storage: { local: { get: async d => ({ ...d, ...store }), set: async o => { store = { ...store, ...o } } }, session: { set: async o => { session = { ...session, ...o } }, setAccessLevel() {} } },
  action: { setBadgeText: ({ tabId, text }) => tabId ? (badge[tabId] = text) : (badge.global = text), setBadgeBackgroundColor() {}, onClicked: on() },
  runtime: { onStartup: on(), onInstalled: on(), onMessage: on() },
  contextMenus: { create() {}, removeAll() {}, onClicked: on() },
  commands: { onCommand: on() },
}
let stopped = [], hold // hold: a pull Epiphany is still on, until called
globalThis.fetch = async (_, { body }) => {
  if (!up) throw new TypeError('refused')
  const q = JSON.parse(body)
  if (q.stop) return void stopped.push(q.stop)
  sent.push(q.page)
  if (q.page === 'slow') await new Promise(r => hold = r)
  return { ok: !fail.has(q.page), json: async () => [{}, {}], text: async () => 'nope' } // a pull of two
}
globalThis.importScripts = f => (0, eval)(fs.readFileSync(new URL('../extension/' + f, import.meta.url), 'utf8')) // the worker's
eval(fs.readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8'))
const click = page => new Promise(r => chrome.runtime.onMessage.fire({ page }, { tab: { id: 1 } }, r))

assert.deepEqual(await click('a'), { queued: true }); assert.deepEqual(await click('b'), { queued: true })
assert.deepEqual(store.waiting.map(x => x.page), ['a', 'b']); assert.equal(badge.global, '2')
up = true; fail.add('b')
assert.deepEqual(await click('x'), { n: 2 }) // back: the waiting ones in order, then this click; a failed one is dropped
assert.deepEqual(sent, ['a', 'b', 'x']); assert.deepEqual(store.waiting, []); assert.equal(badge.global, '✓') // the last one landed
fail.add('c'); assert.deepEqual(await click('c'), { why: 'nope' })               // Epiphany up but failed: shown, not queued
assert.deepEqual(store.waiting, [])
up = false; await click('d'); up = true; await click('e') // a click that gets through sends the waiting ones ahead of it
assert.deepEqual(sent.slice(-2), ['d', 'e']); assert.deepEqual(store.waiting, []); assert.deepEqual(session.out, []) // nothing left out
await new Promise(r => setTimeout(r, 2100)); assert.equal(badge.global, '') // ✓ a moment, then the count: none
up = false; await click('f'); await click('g'); await chrome.runtime.onMessage.fire({ drop: JSON.stringify({ page: 'f' }) }, {}, () => {}); await new Promise(r => setTimeout(r, 20))
assert.deepEqual(store.waiting.map(x => x.page), ['g']); assert.equal(badge.global, '1') // the panel drops one
await chrome.runtime.onMessage.fire({ drop: 'all' }, {}, () => {}); await new Promise(r => setTimeout(r, 20)); assert.deepEqual(store.waiting, [])
const ask = q => new Promise(r => chrome.runtime.onMessage.fire(q, { tab: { id: 1 } }, r)), tick = () => new Promise(r => setTimeout(r, 20))
up = true; await chrome.runtime.onMessage.fire({ stop: 'z1' }, {}, () => {}) // stopped before it went: it never goes
assert.deepEqual(await ask({ page: 'z', id: 'z1' }), { why: 'Stopped' }); assert.ok(!sent.includes('z'))
const slow = ask({ page: 'slow', id: 's1' }); await tick(); await chrome.runtime.onMessage.fire({ stop: 's1' }, {}, () => {}); await tick()
assert.deepEqual(stopped, ['s1']); hold(); await slow // out already: Epiphany is told to stop it
assert.deepEqual(session.done.z1, { why: 'Stopped' }); assert.deepEqual(session.done.s1, { n: 2 }) // what became of each, for a Pull button coming back
console.log('ok')
