// Shared state and helpers, the picture grid and its selection, filters and search, projects; starts the page. Loaded first:
// motion.js, piles.js, preview.js, settings.js follow and share its globals.

const $ = s => document.querySelector(s)
const esc = s => String(s).replace(/"/g, '&quot;')
let s, projects, items
const save = () => api.setSettings(s)

// Day-grouped image grid, newest first. Used by Lobby (all projects) and Projects (one).
const day = t => new Date(t).toLocaleDateString()
const groupIn = (root, t, front) => {
  const d = day(t)
  let g = root.querySelector(`[data-day="${d}"]`)
  if (!g) {
    g = document.createElement('div')
    g.dataset.day = d
    g.innerHTML = `<h3>${d}</h3><div class="grid"></div>`
    root[front ? 'prepend' : 'append'](g)
  }
  return g.lastElementChild
}
const add = (root, item, front) => {
  const grid = groupIn(root, item.time, front)
  const img = new Image()
  img.onload = () => { // rises in once; a CSS animation would replay whenever a filter or the piles hide and show it again
    img.classList.add('in')
    if (!calm.matches && !img.getAnimations().length) play(img, [{ opacity: 0, transform: 'translateY(8px) scale(.98)' }, {}], { duration: 350, delay: 100 + Math.random() * 200, easing: EASE, fill: 'backwards' }) // cached thumbs all land in the same frame; a little scatter reads as one-by-one. Not while a swap moves or holds it: a print landing on it already shows it
  }
  img.src = item.thumb || item.url
  img.loading = 'lazy'
  img.decoding = 'async'
  img.title = item.src
  decorate(img, item)
  grid[front ? 'prepend' : 'append'](img)
}
const decorate = (img, item) => {
  img.item = item
  img.onclick = e => e.shiftKey ? select(img, e) : e.ctrlKey || e.metaKey ? null : preview(item, img.closest('section')) // Ctrl toggles on press, see paint
  img.oncontextmenu = () => api.menu(item)
  img.dataset.file = item.file
  img.dataset.q = `${item.artist || ''} ${item.tags || ''}`.toLowerCase()
  img.dataset.site = item.site
  if (item.ai) img.dataset.ai = 1
  img.dataset.rating = item.rating || 'e' // unrated (no booru match yet) is treated as explicit by the filter
  img.dataset.tagged = item.tagged || 'none'
  hide(img)
}

// Selection: Ctrl-click toggles, Ctrl-drag paints, Shift-click extends from the last toggle, Ctrl+A takes every visible picture, Esc clears.
const sel = new Set()
let anchor
const selUI = $('#selection')
const page = () => location.hash === '#projects' ? pgrid : $('#lobby')
const scroller = () => page().closest('section')
const shown = root => [...root.querySelectorAll('.grid img')].filter(i => !i.hidden)
const visible = () => shown(page())
const drawSel = () => {
  document.querySelectorAll('.grid img').forEach(i => i.classList.toggle('sel', sel.has(i.dataset.file)))
  selUI.hidden = !sel.size
  selUI.firstElementChild.textContent = sel.size + ' selected'
}
const select = (img, e) => {
  const f = img.dataset.file
  if (e.shiftKey && anchor) {
    const imgs = visible(), a = imgs.findIndex(i => i.dataset.file === anchor), b = imgs.indexOf(img)
    imgs.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(i => sel.add(i.dataset.file))
  } else { sel.has(f) ? sel.delete(f) : sel.add(f); anchor = f }
  drawSel()
}
// Ctrl-drag: every picture the pointer passes over takes the state the first one got.
let paint = null
addEventListener('mousedown', e => {
  const img = e.target.closest?.('.grid img')
  if (!img || e.button || e.shiftKey || !(e.ctrlKey || e.metaKey)) return
  e.preventDefault() // no image drag-out while painting
  select(img, e)
  paint = sel.has(img.dataset.file)
})
addEventListener('mouseover', e => {
  const img = e.target.closest?.('.grid img')
  if (paint === null || !img) return
  if (!(e.buttons & 1)) return paint = null // released outside the window
  paint ? sel.add(img.dataset.file) : sel.delete(img.dataset.file)
  drawSel()
})
addEventListener('keydown', e => {
  if (dlg.open || e.target.matches?.('input, textarea')) return
  if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); if (!piling) { visible().forEach(i => sel.add(i.dataset.file)); drawSel() } } // the piles hide the grid it would select
  if (e.key === 'Escape' && sel.size) { sel.clear(); drawSel() }
})
selUI.querySelector('.clear').onclick = () => { sel.clear(); drawSel() }
selUI.querySelector('.export').onclick = () => api.export(items.filter(i => sel.has(i.file)))
selUI.querySelector('.lookup').onclick = () => api.lookupAll(items.filter(i => sel.has(i.file))) // booru-pulled ones just re-render their caption
// Pictures waiting for a pick: a pill that toggles the unsure filter.
const unsureUI = $('#unsure')
const drawUnsure = () => {
  const n = items.filter(i => i.tagged === 'unsure').length
  unsureUI.hidden = !n
  unsureUI.textContent = n + ' to pick'
  unsureUI.classList.toggle('on', F.tagged === 'unsure')
}
unsureUI.onclick = () => swap(() => { F.tagged = F.tagged === 'unsure' ? '' : 'unsure'; saveF(); applyFilters() })

// View filters: never touch files, only what is shown. Kept per machine.
const F = JSON.parse(localStorage.filters || '{"ai":true,"rating":"","tagged":"","site":"","q":""}')
const filters = $('#filters')
const saveF = () => localStorage.filters = JSON.stringify({ ...F, q: '' }) // the search box is not remembered
const hide = img => img.hidden = !!((!F.ai && img.dataset.ai) || (F.rating && !F.rating.includes(img.dataset.rating)) || (F.tagged && img.dataset.tagged !== F.tagged) || (F.site && img.dataset.site !== F.site) || (F.q && !img.dataset.q.includes(F.q)))
const applyFilters = () => {
  document.querySelectorAll('.grid img').forEach(hide)
  filters.querySelectorAll('.seg').forEach(seg => seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.value === (F[seg.dataset.name] || ''))))
  if (items) drawUnsure()
  if (piling) drawPiles(page())
  $('.filter-toggle').classList.toggle('on', Object.entries(F).some(([k, v]) => k === 'ai' ? !v : v))
}
const drawSites = () => {
  const sel = filters.querySelector('[name=site]')
  sel.innerHTML = '<option value="">All sources</option>' + [...new Set(items.map(i => i.site).filter(Boolean))].sort()
    .map(x => `<option ${x === F.site ? 'selected' : ''}>${x}</option>`).join('')
}
// Search box: local scope filters the grid as you type; a site scope pulls that site's tag search on Enter.
const search = $('.search input'), scope = $('.search select')
const localQ = () => { F.q = scope.value ? '' : search.value.trim().toLowerCase().replace(/ /g, '_'); applyFilters(); explain() }
search.oninput = scope.onchange = () => swap(() => { localQ(); backToPiles() }) // filter changes move the pictures, see swap
$('.search .clear-q').onclick = () => { search.value = ''; search.dispatchEvent(new Event('input')) }
search.onkeydown = e => { if (e.key === 'Enter' && scope.value && search.value.trim()) api.search(scope.value, search.value.trim()).catch(() => {}) }
filters.querySelectorAll('input').forEach(i => i.checked = F[i.name])
filters.querySelectorAll('.seg').forEach(seg => { seg.onclick = e => { if (e.target.tagName === 'BUTTON') swap(() => { F[seg.dataset.name] = e.target.value; saveF(); applyFilters() }) } })
filters.onchange = e => swap(() => { F[e.target.name] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; saveF(); applyFilters() })
const render = (root, list) => { root.innerHTML = ''; list.forEach(i => add(root, i)); if (root.classList.contains('piling')) drawPiles(root) }

// Projects: sidebar picks the active project (where pulls land) and shows its grid.
const plist = $('#plist'), pgrid = $('#pgrid')
const drawProjects = force => {
  plist.innerHTML = projects.map(p => `<a href="#projects" data-p="${esc(p)}"${p === s.project ? ' class="on" title="New pictures land here"' : ''}>${p}</a>`).join('')
    + '<input placeholder="+ New project" spellcheck="false">'
  if (force || pgrid.dataset.p !== s.project) { pgrid.dataset.p = s.project; render(pgrid, items.filter(i => i.project === s.project)) } // redrawing the same grid would only replay the fade-in
}
const openProject = p => { s.project = p; save(); drawProjects(); location.hash = '#projects' }
plist.onclick = e => { if (e.target.dataset.p) openProject(e.target.dataset.p) }
plist.oncontextmenu = e => { if (e.target.dataset.p) api.projectMenu(e.target.dataset.p) }
api.onProjectRemoved(async name => {
  items = items.filter(i => i.project !== name)
  document.querySelectorAll('.grid img').forEach(i => { if (i.item.project === name) { sel.delete(i.dataset.file); i.remove() } })
  drawSel(); drawUnsure()
  ;[projects, s] = await Promise.all([api.projects(), api.getSettings()])
  drawProjects(true)
  drawSites()
  refreshPiles()
})
plist.onkeydown = e => {
  const v = e.target.value?.trim()
  if (e.key !== 'Enter' || !v || projects.includes(v)) return
  api.newProject(v).then(() => { projects.push(v); openProject(v) })
}

// Once every script is in: an IPC answer can land between two of them, before piles.js has run.
addEventListener('DOMContentLoaded', () => Promise.all([api.list(), api.projects(), api.getSettings(), api.profiles()]).then(([list, ps, settings, profiles]) => {
  items = list.sort((a, b) => b.time.localeCompare(a.time))
  projects = ps
  s = settings
  render($('#lobby'), items)
  drawProjects()
  drawSites()
  api.searchSites().then(names => scope.innerHTML = '<option value="">local</option>' + names.filter(n => s.sites.includes(n)).map(n => `<option>${n}</option>`).join(''))
  applyFilters()
  settingsUI(profiles)
}))
api.onOpenProject(openProject)
const toastEl = $('#toast')
let toastTimer
api.onToast(t => { toastEl.textContent = t; toastEl.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.hidden = true, 2500) })
api.onRemoved(file => {
  items = items.filter(i => i.file !== file)
  if (sel.delete(file)) drawSel()
  drawUnsure()
  document.querySelectorAll('.grid img').forEach(i => { if (i.dataset.file === file) i.remove() })
  refreshPiles()
})
api.onSaved(i => {
  if (i.replace) { // same picture, fresher facts (tags looked up)
    items[items.findIndex(x => x.file === i.file)] = i
    document.querySelectorAll('.grid img').forEach(img => { if (img.dataset.file === i.file) decorate(img, i) })
    if (dlg.open && cur.file === i.file) preview(i)
    drawUnsure()
    return refreshPiles()
  }
  items.unshift(i)
  drawSites()
  add($('#lobby'), i, true)
  if (i.project === s.project) add(pgrid, i, true)
  refreshPiles()
})

// Lobby has no title of its own: a random line is the title. Click for another. While the search is one tag of the library, its
// danbooru explanation is the title instead, and a click opens its wiki.
const h1 = $('h1 .t-lobby')
let line = '', explained = '', asked = ''
const title = text => {
  if (h1.textContent === text) return
  h1.getAnimations().forEach(a => a.cancel())
  if (calm.matches) return h1.textContent = h1.title = text
  h1.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'ease-in' }).onfinish = () => { // not play(): a swap would take it for one of its fliers
    h1.textContent = h1.title = text
    h1.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: EASE })
  }
}
const explain = () => {
  const t = F.q
  if (t === explained) return
  asked = t
  if (!t || !items?.some(i => `, ${i.tags}, `.includes(`, ${t}, `))) { explained = ''; return title(line) } // a word being typed is not a tag
  api.tagWiki(t).then(text => { if (asked !== t) return; explained = text ? t : ''; title(text || line) })
}
const quote = () => api.quote().then(q => { line = q || ''; if (!explained) title(line) })
h1.onclick = () => explained ? api.open(`https://danbooru.donmai.us/wiki_pages/${encodeURIComponent(explained)}`) : quote()
quote()

const mark = () => document.querySelectorAll('#settings aside a').forEach(a => a.classList.toggle('on', a.hash === location.hash))
addEventListener('hashchange', mark)
// A page keeps its scroll while another shows: display:none drops it.
const tops = new Map()
for (const sec of document.querySelectorAll('main > section')) sec.addEventListener('scroll', () => tops.set(sec, sec.scrollTop), { passive: true })
addEventListener('hashchange', () => { for (const [sec, top] of tops) if (sec.checkVisibility()) sec.scrollTop = top })
location.hash ||= '#lobby'
mark()
