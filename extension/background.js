try { importScripts('looks.js') } catch {} // the spinner names a pull carries (anim): the panel and the app's task line play that one. Not
// there, the worker runs on all the same: such a pull carries none, and the app picks one
const anim = () => typeof SPINNERS === 'object' ? anyOf(Object.keys(SPINNERS)) : undefined

// The badge: how many pulls there are, out and next alike; ✓ a moment as one lands (a red ! if it failed); nothing with none.
const INK = '#1E1F2A'
let flashing
const tally = () => {
  if (flashing) return
  const n = out.length + next.length
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

// One pull at a time is out to Epiphany (it pulls one at a time): out, in session storage for the toolbar icon's panel (popup.js)
// and the Pull button (content.js), with how far it is ({ n, total }) as Epiphany says. One left there by a worker Chrome stopped
// mid-pull is lost to the extension (Epiphany may well have finished it), and says so. done: what became of the last ones, by id,
// for a Pull button that comes back to one (content.js follow); kept as workers come and go, for the browser's session.
let out = [], done = {}
chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }) // content scripts read it too
chrome.runtime.onStartup.addListener(() => {}) // the worker runs as the browser starts: the badge, and the access above
const ended = (body, got) => chrome.storage.session.set({ done: done = Object.fromEntries([...Object.entries(done), [body.id, got]].slice(-100)) })
const lines = async function* (body) { let rest = ''; for await (const c of body.pipeThrough(new TextDecoderStream())) { const l = (rest + c).split('\n'); rest = l.pop(); yield* l } }
// What Epiphany said: { n } pictures it took, or { why } it failed there; null: Epiphany isn't running (or quit mid-pull).
const post = async body => {
  chrome.storage.session.set({ out: out = [body] }); tally()
  try {
    const r = await fetch('http://127.0.0.1:7676/', { method: 'POST', body: JSON.stringify(body) })
    let got = null
    for await (const l of lines(r.body)) {
      const m = JSON.parse(l)
      if ('n' in m) chrome.storage.session.set({ out: out = [{ ...body, ...m }] })
      else got = 'why' in m ? m : { n: m.got }
    }
    if (got) flash(got)
    return got
  } catch { return null } finally { chrome.storage.session.set({ out: out = [] }); tally() }
}

// Next: the pulls behind the one out, and all of them while Epiphany isn't running (kept across browser restarts: they go with the
// next pull Epiphany takes). Held here too, so a change is never lost between a read and a write of storage.
// ponytail: a right-click save waits as a URL; an image URL that expires (signed CDN links) can 404 by then. Keep the bytes if that bites.
let next = [], going
const ready = Promise.all([chrome.storage.local.get({ waiting: [] }), chrome.storage.session.get({ out: [], done: {} })]).then(([l, s]) => {
  next = l.waiting; done = s.done
  s.out.forEach(b => ended(b, { why: 'Lost track of it: see Epiphany' }))
  chrome.storage.session.set({ out: [] }); tally()
})
const keep = list => { chrome.storage.local.set({ waiting: next = list }); tally() }
const go = async () => {
  await ready
  if (going) return
  going = true
  // Chrome stops a worker 30 s without an event or a call, and a pull can go quiet longer: a big file, a wait behind the app's own.
  const awake = setInterval(chrome.runtime.getPlatformInfo, 20000)
  try {
    while (next.length) {
      const [body, ...rest] = next
      keep(rest) // out before it is sent: a worker stopped mid-pull must not pull it twice
      const got = await post(body)
      if (got === null) return keep([body, ...next]) // Epiphany's away: first in line again
      ended(body, got)
    }
  } finally { going = false; clearInterval(awake) }
}
const send = async body => { await ready; keep([...next, body]); go() }

// Stopped by its ✕ (the Pull button's, or the panel's): out, Epiphany stops it as its task line's ✕ would; next, it never goes.
// Each request has an id for this. Clear: all of Next.
const stop = async id => {
  await ready
  if (out.some(b => b.id === id)) return fetch('http://127.0.0.1:7676/', { method: 'POST', body: JSON.stringify({ stop: id }) }).catch(() => {})
  next.filter(b => b.id === id).forEach(b => ended(b, { why: 'Stopped' }))
  keep(next.filter(b => b.id !== id))
}
const clear = async () => { await ready; next.forEach(b => ended(b, { why: 'Stopped' })); keep([]) }

chrome.runtime.onInstalled.addListener(() => chrome.contextMenus.removeAll(() => chrome.contextMenus.create({ id: 'save', title: 'Save to Epiphany', contexts: ['image'] })))

// The Pull button on listed sites (content.js) -> gallery-dl; its ✕ or the panel's stops one ({ stop }: its id), Clear all of Next.
chrome.runtime.onMessage.addListener(msg => void ('stop' in msg ? stop(msg.stop) : 'clear' in msg ? clear() : send(msg)))

// Alt+S (its own command: the icon opens the panel) on any site -> gallery-dl. activeTab lends it the tab's URL off the listed sites.
chrome.commands.onCommand.addListener((name, tab) => name === 'pull' && send({ page: tab.url, anim: anim(), id: crypto.randomUUID() }))

// Right-click on an image -> fetch that image directly.
chrome.contextMenus.onClicked.addListener(info => send({ src: info.srcUrl, page: info.pageUrl, anim: anim(), id: crypto.randomUUID() }))
