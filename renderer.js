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
  img.oncontextmenu = () => api.menu(sel.has(item.file) ? items.filter(i => sel.has(i.file)) : [item]) // the selection it is in, or itself
  img.dataset.file = item.file
  img.dataset.q = `${item.artist || ''} ${item.character || ''} ${item.copyright || ''} ${item.tags || ''}`.toLowerCase()
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
let grid // the grid page on show; while Settings is up, the one shown last: piles, filters and pulls still act on it
const page = () => grid = location.hash === '#projects' ? pgrid : location.hash === '#lobby' || !grid ? $('#lobby') : grid
addEventListener('hashchange', page) // noted as it shows, asked or not
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
  paint = null
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
  if ((e.ctrlKey || e.metaKey) && e.key === 'v') api.paste() // the clipboard's links, pulled (main.js)
})
selUI.querySelector('.clear').onclick = () => { sel.clear(); drawSel() }
selUI.querySelector('.lookup').onclick = () => api.lookupAll(items.filter(i => sel.has(i.file))) // booru-pulled ones just re-render their caption
selUI.querySelector('.tag').onclick = () => api.tag(items.filter(i => sel.has(i.file)))
// Right-click > Edit > a field: one line where the menu was, what they all share filled in, the library's names to pick from.
// Enter writes it to every one of them; Esc or a click away leaves them be.
const editUI = $('#edit'), editIn = editUI.querySelector('input'), hints = editUI.querySelector('ul')
let menuAt = [0, 0], editing, choices = [], hi = -1
addEventListener('contextmenu', e => menuAt = [e.clientX, e.clientY])
const names = v => (v || '').split(', ').map(t => t.replace(/^@/, '').replace(/_/g, ' ')).filter(Boolean)
api.onEdit(e => {
  editing = e
  const now = new Set(e.items.map(i => names(i[e.field]).join(', ')))
  editIn.value = now.size === 1 ? [...now][0] : ''
  editIn.placeholder = e.options ? e.label : `${e.label}, comma-separated`
  choices = e.options ?? [...new Set(items.flatMap(i => names(i[e.field])))].sort()
  editUI.style.left = Math.min(menuAt[0], innerWidth - 340) + 'px'
  editUI.style.top = Math.min(menuAt[1], innerHeight - 56) + 'px'
  editUI.classList.toggle('up', menuAt[1] > innerHeight / 2)
  editUI.showPopover()
  editIn.select()
  suggest(!editIn.value) // an empty box offers them all
})
// The names the piece being typed (after the last comma) could be, not yet in the box. Our list: a datalist's can't be styled.
const suggest = (all = true) => {
  const typed = editIn.value.split(',').map(t => t.trim()), piece = typed.pop().toLowerCase()
  const list = all ? choices.filter(c => c.toLowerCase().includes(piece) && c.toLowerCase() !== piece && !typed.includes(c)).slice(0, 8) : []
  hi = -1
  hints.replaceChildren(...list.map(c => Object.assign(document.createElement('li'), { textContent: c, onmousedown: e => { e.preventDefault(); take(c) } })))
}
const take = c => { editIn.value = [...editIn.value.split(',').slice(0, -1).map(t => t.trim()), c].join(', '); suggest() }
editIn.oninput = () => suggest()
editIn.onkeydown = e => {
  const li = hints.children
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && li.length) {
    e.preventDefault()
    hi = e.key === 'ArrowDown' ? Math.min(hi + 1, li.length - 1) : Math.max(hi - 1, -1)
    ;[...li].forEach((x, i) => x.classList.toggle('on', i === hi))
  } else if (e.key === 'Enter' && hi >= 0) { e.preventDefault(); take(li[hi].textContent) } // Enter on a name picks it; otherwise it writes
}
editUI.onsubmit = e => { e.preventDefault(); api.setField(editing.items, editing.field, editIn.value); editUI.hidePopover() }
// Pending: no tags yet (none), or close matches waiting for a pick (unsure). A pill that toggles the pending filter.
const pending = t => t === 'none' || t === 'unsure'
const pendingUI = $('#pending')
const drawPending = () => {
  const n = items.filter(i => pending(i.tagged)).length
  pendingUI.hidden = !n
  pendingUI.textContent = n + ' pending'
  pendingUI.classList.toggle('on', F.tagged === 'pending')
  // Nothing left pending (the last one tagged or picked): the empty page says so for a moment, in the face's place, then the
  // filter lets go. After this redraw, not inside it: it may run within a swap.
  if (!n && F.tagged === 'pending') setTimeout(() => {
    if (F.tagged !== 'pending' || items.some(i => pending(i.tagged))) return
    Object.assign(page().dataset, { face: 'No pending!', say: '' }) // face() picks a face again once pictures show
    setTimeout(() => { if (F.tagged === 'pending') swap(() => { pendingOff(); saveF(); applyFilters(); explain() }) }, 800)
  })
}
// The pill shows every pending picture: the search and the other filters step aside, and come back when it goes off (a click,
// or none left). Safe mode keeps Rating.
let aside = null
const pendingOn = () => {
  aside = { F: { ...F }, q: search.value, scope: scope.value }
  Object.assign(F, { ai: true, site: '', q: '', tagged: 'pending' }, safe === null && { rating: '' })
  search.value = ''
  drawInputs()
}
const pendingOff = () => {
  if (aside) { Object.assign(F, aside.F); search.value = aside.q; scope.value = aside.scope; aside = null } else F.tagged = ''
  drawInputs()
}
pendingUI.onclick = () => swap(() => { F.tagged === 'pending' ? pendingOff() : pendingOn(); saveF(); applyFilters(); explain() })

// View filters: never touch files, only what is shown. Kept per machine.
const F = JSON.parse(localStorage.filters || '{"ai":true,"rating":"","tagged":"","site":"","q":""}')
if (pending(F.tagged)) F.tagged = 'pending' // saved before none and unsure were one
const filters = $('#filters')
// Safe mode (Settings > General, or -safe at launch): Rating locked on General; the rating saved before stays saved for when it's off.
let safe = null, safeCli = false // that saved rating, while locked; launched with -safe (Settings can't turn it off)
const ratingUI = filters.querySelector('[data-name=rating]'), ratingTip = ratingUI.title
const setSafe = on => {
  if (on === (safe !== null)) return
  if (on) { safe = F.rating; F.rating = 'g' } else { F.rating = safe; safe = null }
  ratingUI.inert = on
  ratingUI.title = on ? 'Safe mode' : ratingTip
}
const saveF = () => localStorage.filters = JSON.stringify({ ...F, q: '', ...safe !== null && { rating: safe } }) // the search box is not remembered
// A segment's filter: its choice, or '!' and the choice for everything but (right-click). A picture of no known rating is in none.
const passes = (f, is) => !f || (f[0] === '!' ? !is(f.slice(1)) : is(f))
const hide = img => img.hidden = !!((!F.ai && img.dataset.ai) || !passes(F.rating, v => !!img.dataset.rating && v.includes(img.dataset.rating)) || !passes(F.tagged, v => v === 'pending' ? pending(img.dataset.tagged) : img.dataset.tagged === v) || (F.site && source(img.dataset.site) !== source(F.site)) || (F.q && !img.dataset.q.includes(F.q)))
const applyFilters = () => {
  document.querySelectorAll('.grid img').forEach(hide)
  filters.querySelectorAll('.seg').forEach(seg => seg.querySelectorAll('button').forEach(b => { const f = F[seg.dataset.name] || ''; b.classList.toggle('on', b.value === f); b.classList.toggle('not', f === '!' + b.value) }))
  if (piling) drawPiles(page())
  changed()
  if (!F.ai || F.site) filters.querySelector('details').open = true // a filter at work is never folded away
  $('.filter-toggle').classList.toggle('on', Object.entries(F).some(([k, v]) => k === 'ai' ? !v : k !== 'piles' && v)) // piles hides nothing
}
// A source is one of the sites Settings lists (settings.js); any other (a right-click save's host) is 'other', listed last.
const source = site => SITES.includes(site) ? site : 'other'
const drawSites = () => {
  const sel = filters.querySelector('[name=site]')
  sel.innerHTML = '<option value="">All sources</option>' + [...new Set(items.map(i => i.site).filter(Boolean).map(source))].sort((a, b) => (a === 'other') - (b === 'other') || a.localeCompare(b))
    .map(x => `<option ${F.site && x === source(F.site) ? 'selected' : ''}>${x}</option>`).join('')
}
// Search box: local scope filters the grid as you type; a site scope opens that site's search in the browser on Enter.
const search = $('.search input'), scope = $('.search select')
const localQ = () => { F.q = scope.value ? '' : search.value.trim().toLowerCase().replace(/ /g, '_'); applyFilters(); explain() }
let typing
search.oninput = scope.onchange = () => { clearTimeout(typing); typing = setTimeout(() => swap(() => { localQ(); backToPiles() }), 120) } // filter changes move the pictures, see swap; one move once typing pauses, not one per key
$('.search .clear-q').onclick = () => { search.value = ''; search.dispatchEvent(new Event('input')); search.focus() }
// local, the search engine (Settings > General), More: the other sites in use.
const drawScope = () => api.searchSites().then(names => {
  const more = names.filter(n => s.sites.includes(n) && n !== s.engine).map(n => `<option>${n}</option>`).join('')
  scope.innerHTML = `<option value="">local</option><option>${s.engine}</option>` + (more && `<optgroup label="More">${more}</optgroup>`)
})
search.onkeydown = e => { if (e.key === 'Enter' && scope.value && search.value.trim()) api.search(scope.value, search.value.trim()).catch(() => {}) }
const drawInputs = () => filters.querySelectorAll('input').forEach(i => i.checked = F[i.name])
drawInputs()
// A segment's choice clicked again goes off: none chosen means any (piles: by tags). Choosing a kind of pile shows the piles.
// Right-click on Rating or Tags: everything but it (General: s, q, e; Sensitive, which reaches down to General: q, e).
filters.querySelectorAll('.seg').forEach(seg => {
  const choose = (e, v) => { if (e.target.tagName === 'BUTTON' && !seg.inert) swap(() => {
    const k = seg.dataset.name
    F[k] = F[k] === v ? '' : v
    saveF(); applyFilters()
    if (k === 'piles' && F.piles && !piling) setPiling(true)
  }) }
  seg.onclick = e => choose(e, e.target.value)
  if (seg.dataset.name !== 'piles') seg.oncontextmenu = e => choose(e, '!' + e.target.value)
})
// Right-click the filter button: everything it lights up for goes off, the search too (Safe mode keeps Rating).
$('.filter-toggle').oncontextmenu = () => swap(() => {
  Object.assign(F, { ai: true, tagged: '', site: '', q: '' })
  if (safe === null) F.rating = ''; else safe = ''
  search.value = ''
  drawInputs()
  saveF(); applyFilters(); explain()
})
filters.onchange = e => swap(() => { F[e.target.name] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; saveF(); applyFilters() })
const render = (root, list) => { root.innerHTML = ''; list.forEach(i => add(root, i)); if (root.classList.contains('piling')) drawPiles(root); changed() }
// Everything drawn from the library or from what is on show, redrawn after any change to either: the pending pill, the source list,
// the empty face, the foot. New ones go here. (The piles follow through applyFilters in a swap, or refreshPiles after a pull.)
const changed = () => { if (!items) return; drawPending(); drawSites(); face(); tally(); buildAhead() }
// The Lobby's foot (style.css): what is on show, every filter applied. The grid: its pictures and the distinct tags they carry;
// piles: the pictures in them (one with no tag is in none) and the piles.
const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`
const tally = () => {
  const lobby = $('#lobby'), piles = lobby.classList.contains('piling') && lobby.querySelector(':scope > .piles')
  const imgs = piles ? [...piles.shows] : shown(lobby)
  const tags = piles ? piles.children.length : new Set(imgs.flatMap(i => i.item.tags?.split(', ') ?? []).filter(Boolean)).size
  if (imgs.length) lobby.dataset.tally = `${plural(imgs.length, 'image')}, ${plural(tags, 'tag')}`
  else delete lobby.dataset.tally
}
// Nothing on show (no pictures yet, a search that finds none, no piles): a face in the middle, no words (style.css). Picked anew
// while it is hidden, so each time it comes up it is another one.
const FACES = ['(・_・)', '(´・ω・`)', '(・∀・)', '(￣▽￣)', '(°ー°〃)', '(´-ω-`)', '(・ε・)', '(o_O)', '(>_<)', '( ˘ω˘ )', 'ヽ(・∀・)ﾉ', '(ﾟДﾟ)', '(=^・ω・^=)', '¯\\_(ツ)_/¯', '(っ´ω`c)', '(・・?)']
const face = () => { for (const r of [$('#lobby'), pgrid]) if (!r.dataset.face || r.querySelector(r.classList.contains('piling') ? '.pile' : '.grid img:not([hidden])')) { r.dataset.face = FACES[Math.random() * FACES.length | 0]; delete r.dataset.say } }

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
  drawSel(); changed()
  ;[projects, s] = await Promise.all([api.projects(), api.getSettings()])
  drawProjects(true)
  refreshPiles()
})
plist.onkeydown = e => {
  const v = e.target.value?.trim()
  if (e.key !== 'Enter' || !v || projects.includes(v)) return
  api.newProject(v).then(() => { projects.push(v); openProject(v) })
}

// Once every script is in: an IPC answer can land between two of them, before piles.js has run.
addEventListener('DOMContentLoaded', () => Promise.all([api.list(), api.projects(), api.getSettings(), api.profiles(), api.safe()]).then(([list, ps, settings, profiles, cli]) => {
  safeCli = cli
  setSafe(cli || !!settings.safe) // before anything shows
  items = list.sort((a, b) => b.time.localeCompare(a.time))
  projects = ps
  s = settings
  render($('#lobby'), items)
  drawProjects()
  drawScope()
  applyFilters()
  settingsUI(profiles)
}))
api.onOpenProject(openProject)
api.onRemoved(file => {
  items = items.filter(i => i.file !== file)
  if (sel.delete(file)) drawSel()
  document.querySelectorAll('.grid img').forEach(i => { if (i.dataset.file === file) i.remove() })
  changed()
  refreshPiles()
})
api.onSaved(i => {
  if (i.replace) { // same picture, fresher facts (tags looked up)
    items[items.findIndex(x => x.file === i.file)] = i
    document.querySelectorAll('.grid img').forEach(img => { if (img.dataset.file === i.file) decorate(img, i) })
    if (dlg.open && cur.file === i.file) preview(i)
  } else {
    items.unshift(i)
    add($('#lobby'), i, true)
    if (i.project === s.project) add(pgrid, i, true)
  }
  changed()
  refreshPiles()
})

// Lobby has no title of its own: a random line is the title. Click for another. While the search is one tag of the library, its
// danbooru explanation is the title instead, and a click opens its wiki.
const h1 = $('h1 .t-lobby')
let line = '', explained = '', asked = '', showing = ''
const title = text => {
  if (showing === text) return // what it is fading to: mid-fade the old text still shows
  showing = text
  h1.getAnimations().forEach(a => a.cancel())
  if (calm.matches) return h1.textContent = h1.title = text
  h1.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'ease-in' }).onfinish = () => { // not play(): a swap would take it for one of its fliers
    h1.textContent = h1.title = text
    h1.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: EASE })
  }
}
const explain = () => {
  const t = F.q
  asked = t // before any return: a late answer for the last tag must not land
  if (t === explained) return
  if (!t || !items?.some(i => `, ${i.tags}, ${i.character}, ${i.copyright}, ${i.artist?.replace(/@/g, '')}, `.includes(`, ${t}, `))) { explained = ''; return title(line) } // a word being typed is not a tag
  api.tagWiki(t).then(text => { if (asked !== t) return; explained = text ? t : ''; title(text || line) })
}
const quote = () => api.quote().then(q => { if (q === null) return; line = q; if (!explained) title(line) }) // null: unreachable, the last one stays
h1.onclick = () => explained ? api.open(`https://danbooru.donmai.us/wiki_pages/${encodeURIComponent(explained)}`) : quote()
addEventListener('DOMContentLoaded', quote) // title() needs motion.js

const mark = () => document.querySelectorAll('#settings aside a').forEach(a => a.classList.toggle('on', a.hash === location.hash))
addEventListener('hashchange', mark)
// A page keeps its scroll while another shows: display:none drops it.
const tops = new Map()
for (const sec of document.querySelectorAll('main > section')) sec.addEventListener('scroll', () => tops.set(sec, sec.scrollTop), { passive: true })
addEventListener('hashchange', () => { for (const [sec, top] of tops) if (sec.checkVisibility()) sec.scrollTop = top })
location.hash ||= '#lobby'
mark()
