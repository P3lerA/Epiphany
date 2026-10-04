// The toolbar icon's panel: Now, what Epiphany is pulling, and Next, what waits for it (background.js keeps both in storage), live;
// ✕ stops one now or drops one next (or Clear, all of them). Epiphany out of reach: a line under them says so. Built with DOM calls:
// the URLs are any site's, never markup.
const el = (tag, props, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e }
let stops = [] // the spinners on show, stopped as the panel draws again
const dots = anim => { const d = el('span', { className: 'dots' }); stops.push(spinner(d, anim)); return d } // the one the app's task line plays (looks.js)
let seen = new Set(), now // what was on show: only a new line rises in
// A request as a line: the site, and the page's path (a right-click save: the image's file name).
const row = (q, next) => {
  const key = (next ? 'n' : 'o') + JSON.stringify(q)
  now.add(key)
  let site = q.page, rest = ''
  try { const u = new URL(q.src ?? q.page); site = new URL(q.page).host || u.protocol; rest = q.src ? decodeURIComponent(u.pathname.split('/').pop()) : decodeURIComponent(u.pathname + u.search) } catch {}
  const x = next ? { title: 'Drop it', onclick: () => chrome.runtime.sendMessage({ drop: JSON.stringify(q) }) } : { title: 'Stop it', onclick: () => chrome.runtime.sendMessage({ stop: q.id }) }
  return el('li', { title: q.src ?? q.page, className: seen.has(key) ? '' : 'new' }, next ? '' : dots(q.anim),
    el('span', {}, el('b', { textContent: site }), el('small', { textContent: rest || '/' })), el('button', { textContent: '✕', ...x }))
}
let away = false, face = anyOf(FACES) // Epiphany out of reach, as the panel opened; the face it shows when empty, one per opening
const draw = async () => {
  const [{ out = [] }, { waiting = [] }] = await Promise.all([chrome.storage.session.get('out'), chrome.storage.local.get('waiting')])
  now = new Set(); stops.forEach(stop => stop()); stops = []
  document.querySelector('main').replaceChildren(
    ...out.length ? [el('h2', { textContent: 'Now' }), el('ul', {}, ...out.map(q => row(q, false)))] : [],
    ...waiting.length ? [el('h2', {}, `Next ${waiting.length}`, el('button', { textContent: 'Clear', onclick: () => chrome.runtime.sendMessage({ drop: 'all' }) })),
      el('ul', {}, ...waiting.map(q => row(q, true)))] : [],
    ...out.length || waiting.length ? [] : [el('p', { className: 'face', textContent: face })],
    ...away ? [el('p', { className: 'away', textContent: "Can't reach Epiphany. Pulls wait for it." })] : [])
  seen = now
}
chrome.storage.onChanged.addListener(draw)
draw()
// Any answer is Epiphany there (a GET is turned away, harmlessly); a refused connection is it away.
fetch('http://127.0.0.1:7676/').then(() => false, () => true).then(a => { away = a; draw() })
