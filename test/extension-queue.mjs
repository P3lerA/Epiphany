// The extension's queue, against a fake chrome and a fake Epiphany: node test/extension-queue.mjs
import fs from 'fs'
import assert from 'assert'
let store = {}, session = {}, badge = '', up = false
const fail = new Set(), sent = [], stopped = [], held = {}
const on = () => { const l = []; return { addListener: f => l.push(f), fire: (...a) => Promise.all(l.map(f => f(...a))) } }
globalThis.chrome = {
  storage: { local: { get: async d => ({ ...d, ...store }), set: async o => { store = { ...store, ...o } } }, session: { get: async d => ({ ...d, ...session }), set: async o => { session = { ...session, ...o } }, setAccessLevel() {} } },
  action: { setBadgeText: ({ text }) => badge = text, setBadgeBackgroundColor() {} },
  runtime: { onInstalled: on(), onStartup: on(), onMessage: on(), getPlatformInfo() {} },
  contextMenus: { create() {}, removeAll() {}, onClicked: on() },
  commands: { onCommand: on() },
}
// Epiphany, faked: its answer in lines, a pull of two; a page named slow… keeps its answer open for the test (held[page]).
const enc = new TextEncoder()
globalThis.fetch = async (_, { body }) => {
  if (!up) throw new TypeError('refused')
  const q = JSON.parse(body)
  if (q.stop) { stopped.push(q.stop); return new Response('{}') }
  sent.push(q.page)
  return new Response(new ReadableStream({ start(c) {
    const say = o => c.enqueue(enc.encode(JSON.stringify(o) + '\n'))
    if (q.page.startsWith('slow')) return void (held[q.page] = { say, end: o => { say(o); c.close() }, cut: () => c.error(new TypeError('reset')) })
    say({ n: 1, total: 2 }); say({ n: 2, total: 2 }); say(fail.has(q.page) ? { why: 'nope' } : { got: 2 }); c.close()
  } }))
}
globalThis.importScripts = f => (0, eval)(fs.readFileSync(new URL('../extension/' + f, import.meta.url), 'utf8')) // the worker's
const worker = fs.readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8')
eval(worker)
const tick = () => new Promise(r => setTimeout(r, 50))
const msg = async m => { chrome.runtime.onMessage.fire(m, { tab: { id: 1 } }, () => {}); await tick() }
const pull = page => msg({ page, id: page })
const next = () => store.waiting.map(q => q.page)

await pull('a'); await pull('b') // Epiphany away: they wait in Next
assert.deepEqual(next(), ['a', 'b']); assert.equal(badge, '2'); assert.deepEqual(sent, [])
up = true; fail.add('b'); await pull('x') // back: the waiting ones first, one at a time, then this one; a failed one is said, and gone
assert.deepEqual(sent, ['a', 'b', 'x']); assert.deepEqual(next(), []); assert.deepEqual(session.out, []); assert.equal(badge, '✓')
assert.deepEqual([session.done.a, session.done.b], [{ n: 2 }, { why: 'nope' }])
await pull('slow'); await pull('c') // one out at a time: the next waits behind it
assert.deepEqual(sent.slice(3), ['slow']); assert.deepEqual(next(), ['c'])
held.slow.say({ n: 3, total: 9 }); await tick() // how far the one out is, as Epiphany says
assert.deepEqual(session.out.map(q => [q.page, q.n, q.total]), [['slow', 3, 9]])
await new Promise(r => setTimeout(r, 2000)); assert.equal(badge, '2') // ✓ a moment, then the count: out and next
await pull('d'); await msg({ stop: 'c' }) // ✕ on one in Next: it never goes
assert.deepEqual(next(), ['d']); assert.deepEqual(session.done.c, { why: 'Stopped' })
await msg({ stop: 'slow' }); assert.deepEqual(stopped, ['slow']) // ✕ on the one out: Epiphany is told
held.slow.end({ why: 'Stopped' }); await tick()
assert.deepEqual(session.done.slow, { why: 'Stopped' }); assert.deepEqual(sent.slice(3), ['slow', 'd']) // then the next goes
up = false; await pull('e'); await pull('f'); await msg({ clear: true }) // Clear: all of Next
assert.deepEqual(next(), []); assert.deepEqual(session.done.f, { why: 'Stopped' })
await pull('g'); up = true; await msg({ go: true }) // the panel opened with Epiphany back: Next goes, no pull needed
assert.deepEqual(next(), []); assert.equal(sent.at(-1), 'g')
up = true; await pull('slow2'); held.slow2.cut(); await tick() // Epiphany quit mid-pull: first in Next again
assert.deepEqual(next(), ['slow2']); assert.deepEqual(session.out, [])
session.out = [{ page: 'lost', id: 'lost' }]; eval(worker); await tick() // a worker Chrome stopped mid-pull, started again
assert.deepEqual(session.done.lost, { why: 'Lost track of it: see Epiphany' }); assert.deepEqual(session.out, [])
assert.deepEqual(session.done.slow, { why: 'Stopped' }); assert.deepEqual(next(), ['slow2']) // what became of the others is kept, and Next
console.log('ok')
