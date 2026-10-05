// The toolbar icon's panel: Now, what Epiphany is pulling and how far it is, and Next, what waits for it (background.js keeps both
// in storage), live; ✕ stops one now or drops one next (or Clear, all of them). Epiphany out of reach: a line under them says so.
// Built with DOM calls: the URLs are any site's, never markup.
const el = (tag, props, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e }
// The one the app's task line plays (looks.js), kept by id as the panel draws again (how far it is redraws it often).
const spins = new Map()
const dots = q => {
  if (!spins.has(q.id)) { const d = el('span', { className: 'dots' }); d.stop = spinner(d, q.anim); spins.set(q.id, d) }
  return spins.get(q.id)
}
let seen = new Set(), now // what was on show: only a new line rises in
// A request as a line: the site, and the page's path (a right-click save: the image's file name).
const row = (q, next) => {
  const key = (next ? 'n' : 'o') + q.id
  now.add(key)
  let site = q.page, rest = ''
  try { const u = new URL(q.src ?? q.page); site = new URL(q.page).host || u.protocol; rest = q.src ? decodeURIComponent(u.pathname.split('/').pop()) : decodeURIComponent(u.pathname + u.search) } catch {}
  return el('li', { title: q.src ?? q.page, className: seen.has(key) ? '' : 'new' }, next ? '' : dots(q),
    el('span', {}, el('b', { textContent: site }), el('small', { textContent: rest || '/' })),
    el('span', { className: 'end' }, q.total || q.n > 1 ? el('em', { textContent: q.total ? `${q.n}/${q.total}` : q.n }) : '', // how far (no total: from 2); ✕ over it on hover
      el('button', { title: next ? 'Drop it' : 'Stop it', onclick: () => chrome.runtime.sendMessage({ stop: q.id }) }, cross())))
}
let away = false, face = anyOf(FACES) // Epiphany out of reach, as the panel opened; the face it shows when empty, one per opening
const draw = async () => {
  const [{ out = [] }, { waiting = [] }] = await Promise.all([chrome.storage.session.get('out'), chrome.storage.local.get('waiting')])
  now = new Set()
  for (const [id, d] of spins) if (!out.some(q => q.id === id)) { d.stop(); spins.delete(id) }
  document.querySelector('main').replaceChildren(
    ...out.length ? [el('h2', { textContent: 'Now' }), el('ul', {}, ...out.map(q => row(q, false)))] : [],
    ...waiting.length ? [el('h2', {}, `Next ${waiting.length}`, el('button', { textContent: 'Clear', onclick: () => chrome.runtime.sendMessage({ clear: true }) })),
      el('ul', {}, ...waiting.map(q => row(q, true)))] : [],
    ...out.length || waiting.length ? [] : [el('p', { className: 'face', textContent: face })],
    ...away ? [el('p', { className: 'away', textContent: "Can't reach Epiphany." })] : [])
  seen = now
}
chrome.storage.onChanged.addListener(draw)
draw()
// Any answer is Epiphany there (a GET is turned away, harmlessly); a refused connection is it away. There: what waits for it goes.
fetch('http://127.0.0.1:7676/').then(() => false, () => true).then(a => { away = a; draw(); if (!a) chrome.runtime.sendMessage({ go: true }) })
