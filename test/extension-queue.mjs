// The extension's waiting list, against a fake chrome and fetch: node test/extension-queue.mjs
import fs from 'fs'
import assert from 'assert'
let store = {}, badge = { global: '' }, up = false, fail = new Set(), sent = []
const on = () => { const l = []; return { addListener: f => l.push(f), fire: (...a) => Promise.all(l.map(f => f(...a))) } }
globalThis.chrome = {
  storage: { local: { get: async d => ({ ...d, ...store }), set: async o => { store = { ...store, ...o } } } },
  action: { setBadgeText: ({ tabId, text }) => tabId ? (badge[tabId] = text) : (badge.global = text), onClicked: on() },
  runtime: { onStartup: on(), onInstalled: on(), onMessage: on() },
  contextMenus: { create() {}, onClicked: on() },
}
globalThis.fetch = async (_, { body }) => { if (!up) throw new TypeError('refused'); sent.push(JSON.parse(body).page); return { ok: !fail.has(JSON.parse(body).page) } }
eval(fs.readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8'))
const click = page => new Promise(r => chrome.runtime.onMessage.fire({ page }, { tab: { id: 1 } }, r))

assert.equal(await click('a'), true); assert.equal(await click('b'), true)
assert.deepEqual(store.waiting.map(x => x.page), ['a', 'b']); assert.equal(badge.global, '2')
up = true; fail.add('b')
assert.equal(await click('x'), true); await new Promise(r => setTimeout(r, 50)) // back: this click, then the waiting ones in order; a failed one is dropped
assert.deepEqual(sent, ['x', 'a', 'b']); assert.deepEqual(store.waiting, []); assert.equal(badge.global, '')
fail.add('c'); assert.equal(await click('c'), false)                 // Epiphany up but failed: shown, not queued
assert.deepEqual(store.waiting, [])
up = false; await click('d'); up = true; await click('e'); await new Promise(r => setTimeout(r, 50)) // a click that gets through takes the waiting ones along
assert.deepEqual(sent.slice(-2).sort(), ['d', 'e']); assert.deepEqual(store.waiting, [])
console.log('ok')
