// Pull, on the listed sites: a pill like the app's toolbar, in a shadow root (the site's CSS can't reach it). While it pulls, dots
// from looks.js, the same the app's task line then plays (the pull carries their name), how far it is, and ✕ stops it; behind
// another pull, or while Epiphany is away, Queued, and ✕ drops it; then what came of it: how many, failed (why, on hover), or
// stopped. While another page's pull is out, its dots beside Pull (which pulls this one, into Next). Dragged, it stays where it
// was put on that site. Built with DOM calls and a constructed sheet: a site's CSP can refuse inline <style> and innerHTML.
const host = document.createElement('div'), root = host.attachShadow({ mode: 'closed' }), sheet = new CSSStyleSheet()
sheet.replaceSync(`
  button { all: initial; position: fixed; top: 20px; right: 20px; z-index: 2147483647; display: flex; align-items: center; gap: 8px;
    height: 34px; padding: 0 16px; width: auto; interpolate-size: allow-keywords; overflow: hidden; white-space: nowrap; box-sizing: border-box;
    font: 500 13px/1 'Segoe UI Variable Text', 'Segoe UI', -apple-system, system-ui, sans-serif; font-variant-numeric: tabular-nums;
    cursor: pointer; touch-action: none; user-select: none;
    color: #1E1F2A; background: rgb(248 248 246 / .82); backdrop-filter: blur(12px) saturate(1.4); border-radius: 999px;
    box-shadow: 0 6px 18px rgb(0 0 0 / .14), 0 1px 3px rgb(0 0 0 / .1), inset 0 0 0 1px rgb(0 0 0 / .06);
    transition: width .25s cubic-bezier(.2, 0, 0, 1), scale .15s, color .15s }
  button:hover { color: #3552D9 }
  button:active { scale: .96 }
  button.held { cursor: grabbing; scale: 1.04 }
  @media (prefers-color-scheme: dark) {
    button { color: #E6E6EA; background: rgb(28 28 32 / .82); box-shadow: 0 6px 18px rgb(0 0 0 / .3), inset 0 0 0 1px rgb(255 255 255 / .08) }
    button:hover { color: #8FA1FF } }
  .dots { display: none; grid: repeat(4, var(--dot)) / repeat(4, var(--dot)); gap: var(--dot) }
  .dots i { border-radius: 50%; background: currentColor; opacity: .25; transition: opacity var(--frame) }
  .dots i.on { opacity: 1 }
  .x { display: none; margin-right: -6px; padding: 4px; border-radius: 4px; opacity: .55 }
  .x:hover { opacity: 1; background: rgb(128 128 128 / .18) }
  [data-state=busy] :is(.dots, .x), [data-state=elsewhere] .dots, [data-state=queued] .x { display: grid }
  [data-state=failed] { color: #D9354B }
  [data-state=stopped] { opacity: .7 }
  @media (prefers-reduced-motion: reduce) { button { transition: none } }`)
root.adoptedStyleSheets = [sheet]
const el = (tag, cls, ...kids) => { const e = document.createElement(tag); if (cls) e.className = cls; e.append(...kids); return e }
const dots = el('span', 'dots'), text = el('span', 'text', 'Pull'), x = el('span', 'x', cross())
const btn = root.appendChild(el('button', '', dots, text, x))
const show = (state, label, why = '') => { btn.dataset.state = state; text.textContent = label; btn.title = why }
// The button follows the pull it started (id) in the worker's storage (background.js: out, waiting, done), not in an answer to its
// message: back to a page the back/forward cache kept, Chrome has closed that line; loaded anew, there is none. Either way it finds
// the pull again, by its page, and shows where it is. On a site that moves between posts without loading a page (x.com, pixiv), the
// one it follows stays with the post it was asked for.
let back, id, page, spinning, other // page: where the pull it follows was asked for; other: the pull from another page whose dots it plays
const still = () => { spinning?.(); spinning = other = undefined }
const idle = o => {
  if (o?.id !== other) { still(); spinning = o ? spinner(dots, o.anim) : null; other = o?.id }
  show(o ? 'elsewhere' : 'idle', 'Pull', o ? `Pulling ${o.page} ${far(o)}`.trim() : '')
}
const busy = q => { clearTimeout(back); if (other) still(); show('busy', `Pulling ${far(q)}`.trim()); spinning ??= spinner(dots, q.anim) }
const end = (state, label, why) => {
  still(); id = null
  clearTimeout(back); show(state, label, why)
  back = setTimeout(() => { show('idle', 'Pull'); follow() }, 2500)
}
const gone = () => !chrome.runtime?.id // the extension reloaded under this page: this old script has no line left to it
const follow = async () => {
  if (gone()) return
  const [{ out = [], done = {} }, { waiting = [] }] = await Promise.all([chrome.storage.session.get(['out', 'done']), chrome.storage.local.get('waiting')])
    .catch(() => [{}, {}]) // session storage not open to pages yet: the worker hasn't started since the browser did
  if (page !== location.href) { if (id) { still(); id = null; show('idle', 'Pull') } page = location.href } // on to another post
  id ??= [...out, ...waiting].findLast(q => q.page === location.href && !q.src)?.id
  if (!id) return void (['done', 'failed', 'stopped'].includes(btn.dataset.state) || idle(out[0])) // none of its own; a result keeps its moment
  const now = out.find(q => q.id === id), got = done[id]
  if (now) busy(now)
  else if (waiting.some(q => q.id === id)) { // in Next: behind the one out, or, nothing out, Epiphany is away
    clearTimeout(back); still()
    show('queued', 'Queued', out.length ? '' : "Epiphany's away. It goes with the next pull.")
  }
  else if (!got) return // sent, not out yet: Pulling holds
  else if (got.why?.startsWith('Stopped')) end('stopped', 'Stopped')
  else if (got.why !== undefined) end('failed', 'Failed', got.why)
  else end('done', got.n === 1 ? 'Done' : `${got.n} pulled`)
}
chrome.storage.onChanged.addListener(follow)
addEventListener('pageshow', e => e.persisted && follow())
globalThis.navigation?.addEventListener('navigatesuccess', follow) // a site's own move to another post
follow()
const pull = () => {
  const anim = anyOf(Object.keys(SPINNERS))
  id = Math.random().toString(36).slice(2), page = location.href // not crypto.randomUUID: that needs https, and a page may not be
  busy({ anim })
  if (gone()) return end('failed', 'Failed', 'Extension reloaded: refresh the page')
  chrome.runtime.sendMessage({ page: location.href, anim, id }).catch(() => {}) // its answer is follow's; a line closed by the cache is no matter
}

// Where it sits: from the top and the right edge (a window made narrower keeps it in view), per site.
const at = 'pullAt:' + location.host
const place = ({ top, right }) => {
  const r = btn.getBoundingClientRect()
  btn.style.top = Math.max(0, Math.min(innerHeight - r.height, top)) + 'px'
  btn.style.right = Math.max(0, Math.min(innerWidth - r.width, right)) + 'px'
}
chrome.storage.local.get(at).then(s => s[at] && place(s[at]))
addEventListener('resize', () => place({ top: parseFloat(btn.style.top) || 20, right: parseFloat(btn.style.right) || 20 }))
// A press that moves past a few pixels drags it (no pointer capture: a click must still find the ✕ under it); one that doesn't is a
// click: Pull, or ✕ while it pulls.
let dragged = false
btn.onpointerdown = e => {
  if (e.button) return
  const r = btn.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top, x0 = e.clientX, y0 = e.clientY
  dragged = false
  const move = m => {
    if (!dragged && Math.hypot(m.clientX - x0, m.clientY - y0) < 4) return
    dragged = true
    btn.classList.add('held')
    place({ top: m.clientY - dy, right: innerWidth - (m.clientX - dx) - r.width })
  }
  const up = () => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up)
    btn.classList.remove('held')
    if (dragged) chrome.storage.local.set({ [at]: { top: parseFloat(btn.style.top), right: parseFloat(btn.style.right) } })
  }
  addEventListener('pointermove', move); addEventListener('pointerup', up)
}
btn.onclick = e => {
  if (dragged) return void (dragged = false) // the click a drag ends with
  if (!['busy', 'queued'].includes(btn.dataset.state)) pull()
  else if (e.composedPath().includes(x) && !gone()) chrome.runtime.sendMessage({ stop: id })
}
document.body.append(host)
