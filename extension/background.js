try { importScripts('looks.js') } catch {} // the spinner names a pull carries (anim): the panel and the app's task line play that one. Not
// there, the worker runs on all the same: such a pull carries none, and the app picks one
const anim = () => typeof SPINNERS === 'object' ? anyOf(Object.keys(SPINNERS)) : undefined

// The badge: how many pulls there are, out and waiting alike; ✓ a moment as one lands (a red ! if it failed); nothing with none.
const INK = '#1E1F2A'
let flashing
const tally = async () => {
  if (flashing) return
  const n = out.length + (await waiting()).length
  chrome.action.setBadgeBackgroundColor({ color: INK })
  chrome.action.setBadgeText({ text: n ? String(n) : '' })
}
const flash = got => {
  if (got.why?.startsWith('Stopped')) return
  clearTimeout(flashing)
  flashing = setTimeout(() => { flashing = null; tally() }, 2000)
  chrome.action.setBadgeBackgroundColor({ color: got.why === undefined ? INK : '#D9354B' })
  chrome.action.setBadgeText({ text: got.why === undefined ? '✓' : '!' })
}

// What Epiphany said: { n } pictures it took, or { why } it failed there; null: Epiphany isn't running. What is out now is in
// session storage for the toolbar icon's panel (popup.js) and the Pull button (content.js); a worker that starts again has nothing
// out. done: what became of the last few, by id, for a Pull button that comes back to one (content.js follow).
let out = [], done = {}
chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }) // content scripts read it too
chrome.storage.session.set({ out, done })
const ended = (body, got) => chrome.storage.session.set({ done: done = Object.fromEntries([...Object.entries(done), [body.id, got]].slice(-20)) })
const post = async body => {
  chrome.storage.session.set({ out: out = [...out, body] }); tally()
  try {
    const got = await fetch('http://127.0.0.1:7676/', { method: 'POST', body: JSON.stringify(body) })
      .then(r => r.ok ? r.json().then(got => ({ n: [got].flat().length }), () => ({ n: 1 })) : r.text().then(why => ({ why })), () => null)
    if (got) flash(got)
    return got
  } finally { chrome.storage.session.set({ out: out = out.filter(b => b !== body) }); tally() }
}

// Epiphany isn't running: the request waits in storage (kept across browser restarts) and goes out with the next pull Epiphany takes.
// ponytail: a right-click save waits as a URL; an image URL that expires (signed CDN links) can 404 by then. Keep the bytes if that bites.
let chain = Promise.resolve()
const locked = f => chain = chain.catch(() => {}).then(f)
const waiting = async () => (await chrome.storage.local.get({ waiting: [] })).waiting
const keep = list => chrome.storage.local.set({ waiting: list }).then(tally)
const flush = () => locked(async () => {
  for (let list = await waiting(); list.length; list = await waiting()) {
    await keep(list.slice(1)) // out before it is sent: a worker stopped mid-pull must not pull it twice
    const got = await post(list[0])
    if (got === null) return keep(list)
    ended(list[0], got)
  }
})
chrome.runtime.onStartup.addListener(tally) // the badge doesn't survive a browser restart, the list does

// Stopped by its ✕ (the Pull button's, or the panel's): out already, Epiphany stops it as its task line's ✕ would; not out yet, it
// never goes. Each request has an id for this.
const stopping = new Set()
const stop = id => out.some(b => b.id === id) ? fetch('http://127.0.0.1:7676/', { method: 'POST', body: JSON.stringify({ stop: id }) }).catch(() => {}) : stopping.add(id)
// { n } or { why } as Epiphany said, or { queued }: Epiphany is away, and it waits.
const send = async body => {
  await flush() // the waiting ones first: the click that found Epiphany back went first, and sat under them in the grid (newest first)
  const got = stopping.delete(body.id) ? { why: 'Stopped' } : (await waiting()).length ? null : await post(body) // still waiting: Epiphany is still away; else the post is the liveness check
  if (!got) await locked(async () => keep([...await waiting(), body]))
  else ended(body, got)
  return got ?? { queued: true }
}

chrome.runtime.onInstalled.addListener(() => chrome.contextMenus.removeAll(() => chrome.contextMenus.create({ id: 'save', title: 'Save to Epiphany', contexts: ['image'] })))

// The Pull button on listed sites (content.js) -> gallery-dl; its ✕ or the panel's stops one ({ stop }: its id); the panel drops a
// waiting one ({ drop }: its JSON), or all.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if ('stop' in msg) return void stop(msg.stop)
  if ('drop' in msg) return void locked(async () => { const list = await waiting(), i = list.findIndex(b => JSON.stringify(b) === msg.drop); return keep(msg.drop === 'all' ? [] : list.toSpliced(i, i < 0 ? 0 : 1)) })
  send(msg).then(reply, e => reply({ why: e.message })) // the page's button says Failed rather than hang
  return true
})

// Alt+S (its own command: the icon opens the panel) on any site -> gallery-dl. activeTab lends it the tab's URL off the listed sites.
chrome.commands.onCommand.addListener((name, tab) => name === 'pull' && send({ page: tab.url, anim: anim(), id: crypto.randomUUID() }))

// Right-click on an image -> fetch that image directly.
chrome.contextMenus.onClicked.addListener(info => send({ src: info.srcUrl, page: info.pageUrl, anim: anim(), id: crypto.randomUUID() }))
