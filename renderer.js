const SITES = ['danbooru', 'gelbooru', 'safebooru', 'yandere', 'konachan', 'sankaku', 'e621', 'rule34',
  'zerochan', 'animepictures', 'pixiv', 'twitter', 'deviantart', 'artstation', 'fanbox', 'fantia', 'bluesky']
const $ = s => document.querySelector(s)
const esc = s => String(s).replace(/"/g, '&quot;')
const stagger = ul => [...ul.children].forEach((li, i) => li.style.setProperty('--i', i))

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
  img.src = item.thumb || item.url
  img.loading = 'lazy'
  img.decoding = 'async'
  img.title = item.src
  img.style.setProperty('--i', front ? 0 : grid.children.length)
  img.onclick = () => preview(item, root)
  img.oncontextmenu = () => api.menu(item)
  decorate(img, item)
  grid[front ? 'prepend' : 'append'](img)
}
const decorate = (img, item) => {
  img.item = item
  img.dataset.file = item.file
  img.dataset.q = `${item.artist || ''} ${item.tags || ''}`.toLowerCase()
  img.dataset.site = item.site
  if (item.ai) img.dataset.ai = 1
  img.dataset.rating = item.rating || 'g'
  hide(img)
}

// View filters: never touch files, only what is shown. Kept per machine.
const F = JSON.parse(localStorage.filters || '{"ai":true,"rating":"","site":""}')
const filters = $('#filters')
const hide = img => img.hidden = !!((!F.ai && img.dataset.ai) || (F.rating && !F.rating.includes(img.dataset.rating)) || (F.site && img.dataset.site !== F.site) || (F.q && !img.dataset.q.includes(F.q)))
const applyFilters = () => {
  document.querySelectorAll('.grid img').forEach(hide)
  $('.filter-toggle').classList.toggle('on', !F.ai || !!F.rating || !!F.site || !!F.q)
}
const drawSites = () => {
  const sel = filters.querySelector('[name=site]')
  sel.innerHTML = '<option value="">All sources</option>' + [...new Set(items.map(i => i.site).filter(Boolean))].sort()
    .map(x => `<option ${x === F.site ? 'selected' : ''}>${x}</option>`).join('')
}
$('.filter-toggle').onclick = () => { filters.hidden = !filters.hidden; if (!filters.hidden) filters.querySelector('[name=q]').focus() }
filters.oninput = e => { if (e.target.name === 'q') { F.q = e.target.value.trim().toLowerCase().replace(/ /g, '_'); applyFilters() } }
filters.querySelectorAll('input').forEach(i => i.checked = F[i.name])
const seg = filters.querySelector('.seg')
const showSeg = () => seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.value === (F.rating || '')))
seg.onclick = e => { if (e.target.tagName === 'BUTTON') { F.rating = e.target.value; showSeg(); localStorage.filters = JSON.stringify(F); applyFilters() } }
showSeg()
filters.onchange = e => { F[e.target.name] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; localStorage.filters = JSON.stringify(F); applyFilters() }
const render = (root, list) => { root.innerHTML = ''; list.forEach(i => add(root, i)) }

// Projects: sidebar picks the active project (where pulls land) and shows its grid.
const plist = $('#plist'), pgrid = $('#pgrid')
const drawProjects = () => {
  plist.innerHTML = projects.map(p => `<a href="#projects" data-p="${esc(p)}" class="${p === s.project ? 'on' : ''}">${p}</a>`).join('')
    + '<input placeholder="new project">'
  render(pgrid, items.filter(i => i.project === s.project))
}
const openProject = p => { s.project = p; save(); drawProjects(); location.hash = '#projects' }
plist.onclick = e => { if (e.target.dataset.p) openProject(e.target.dataset.p) }
plist.onkeydown = e => {
  const v = e.target.value?.trim()
  if (e.key !== 'Enter' || !v || projects.includes(v)) return
  api.newProject(v).then(() => { projects.push(v); openProject(v) })
}

// Preview: big image + editable caption. Reusable for any item.
const dlg = $('#preview')
let cur // which grid the preview walks, and where it is
const siblings = () => {
  const imgs = [...cur.root.querySelectorAll('.grid img')].filter(i => !i.hidden)
  const i = imgs.findIndex(x => x.dataset.file === cur.file)
  return { prev: imgs[i - 1], next: imgs[i + 1] }
}
const step = d => { const n = d < 0 ? siblings().prev : siblings().next; if (n) preview(n.item) }
dlg.querySelector('.prev').onclick = () => step(-1)
dlg.querySelector('.next').onclick = () => step(1)
dlg.tabIndex = -1
dlg.onkeydown = e => {
  if (e.target.tagName === 'TEXTAREA') return
  if (e.key === 'ArrowLeft') step(-1)
  if (e.key === 'ArrowRight') step(1)
}
const preview = async (item, root) => {
  cur = { root: root ?? cur.root, file: item.file }
  const { prev, next } = siblings()
  dlg.querySelector('.prev').hidden = !prev
  dlg.querySelector('.next').hidden = !next
  dlg.querySelector('img').src = item.url
  dlg.querySelector('.name').textContent = item.file.split(/[\\/]/).pop()
  dlg.querySelector('.time').textContent = new Date(item.time).toLocaleString()
  dlg.querySelector('.rating').textContent = { g: 'general', s: 'sensitive', q: 'questionable', e: 'explicit' }[item.rating] ?? ''
  const proj = dlg.querySelector('.proj')
  proj.textContent = item.project
  proj.onclick = e => { e.preventDefault(); dlg.close(); openProject(item.project) }
  const src = dlg.querySelector('.src')
  const u = new URL(item.page)
  src.replaceChildren(u.protocol + '//', Object.assign(document.createElement('b'), { textContent: u.host }), u.pathname + u.search)
  src.onclick = e => { e.preventDefault(); api.open(item.page) }
  const ta = dlg.querySelector('textarea')
  ta.value = await api.getCaption(item.file)
  ta.onchange = () => api.setCaption(item.file, ta.value)
  if (!dlg.open) dlg.showModal()
  dlg.focus()
}
dlg.onclick = e => { if (e.target === dlg) dlg.close() }
// Right-click a tag in the caption: the selection, or the comma-delimited piece under the caret.
const tagAt = ta => {
  const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim()
  if (sel) return sel
  const a = ta.value.lastIndexOf(',', ta.selectionStart - 1) + 1
  const b = ta.value.indexOf(',', ta.selectionStart)
  return ta.value.slice(a, b < 0 ? undefined : b).trim()
}
dlg.querySelector('textarea').oncontextmenu = e => { const t = tagAt(e.target); if (t) api.tagMenu(t) }
api.onSearch(tag => {
  dlg.close()
  const q = filters.querySelector('[name=q]')
  q.value = tag
  q.dispatchEvent(new Event('input', { bubbles: true }))
  filters.hidden = false
})

const settingsUI = profiles => {
  const general = $('#general ul')
  api.quoteSources().then(names => {
    general.querySelector('[name=quote]').innerHTML = names.map(n => `<option ${n === s.quote ? 'selected' : ''}>${n}</option>`).join('')
  })
  general.querySelector('[name=lookup]').checked = s.lookup
  general.onchange = e => {
    s[e.target.name] = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    save()
    if (e.target.name === 'quote') { delete h1.dataset.quote; quote() }
  }
  stagger(general)

  const sites = $('#sites ul')
  sites.innerHTML = SITES.map(site =>
    `<li><label>${site}<input type="checkbox" value="${site}" ${s.sites.includes(site) ? 'checked' : ''}></label></li>`
  ).join('')
  stagger(sites)
  sites.onchange = () => { s.sites = [...sites.querySelectorAll(':checked')].map(c => c.value); save() }

  const sel = $('#profile select')
  const rows = $('#profile ul')
  sel.innerHTML = Object.keys(profiles).map(n => `<option ${n === s.profile ? 'selected' : ''}>${n}</option>`).join('')
  const draw = () => {
    rows.innerHTML = Object.entries(profiles[s.profile]).map(([k, v]) => {
      const cur = s.overrides[k] ?? v
      const reset = k in s.overrides ? ` <a href="#profile" data-reset="${k}">reset</a>` : ''
      const input = typeof v === 'boolean'
        ? `<input type="checkbox" name="${k}" ${cur ? 'checked' : ''}>`
        : `<input type="text" name="${k}" value="${esc(cur)}">`
      return `<li><span>${k}${reset}</span>${input}</li>`
    }).join('')
    stagger(rows)
  }
  draw()
  sel.onchange = () => { s.profile = sel.value; s.overrides = {}; save(); draw() }
  rows.onchange = e => { s.overrides[e.target.name] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; save(); draw() }
  rows.onclick = e => { if (e.target.dataset.reset) { delete s.overrides[e.target.dataset.reset]; save(); draw() } }
}

Promise.all([api.list(), api.projects(), api.getSettings(), api.profiles()]).then(([list, ps, settings, profiles]) => {
  items = list.sort((a, b) => b.time.localeCompare(a.time))
  projects = ps
  s = settings
  render($('#lobby'), items)
  drawProjects()
  drawSites()
  applyFilters()
  settingsUI(profiles)
})
api.onOpenProject(openProject)
const toastEl = $('#toast')
let toastTimer
api.onToast(t => { toastEl.textContent = t; toastEl.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.hidden = true, 2500) })
api.onRemoved(file => {
  items = items.filter(i => i.file !== file)
  document.querySelectorAll('.grid img').forEach(i => { if (i.dataset.file === file) i.remove() })
})
api.onSaved(i => {
  if (i.replace) { // same picture, fresher facts (tags looked up)
    items[items.findIndex(x => x.file === i.file)] = i
    document.querySelectorAll('.grid img').forEach(img => { if (img.dataset.file === i.file) { decorate(img, i); img.onclick = () => preview(i, img.closest('section')); img.oncontextmenu = () => api.menu(i) } })
    return
  }
  items.unshift(i)
  drawSites()
  add($('#lobby'), i, true)
  if (i.project === s.project) add(pgrid, i, true)
})

api.instruments().then(v => {
  const ul = $('#instruments ul')
  ul.innerHTML = Object.entries(v).map(([name, ver]) =>
    `<li><span>${name}</span><span class="status">${ver || 'not found'}</span></li>`
  ).join('')
  stagger(ul)
})

const h1 = $('h1')
const quote = () => api.quote().then(q => { if (q) h1.dataset.quote = q })
h1.onclick = e => { if (e.target === h1) quote() }
quote()

const mark = () => document.querySelectorAll('#settings aside a').forEach(a => a.classList.toggle('on', a.hash === location.hash))
addEventListener('hashchange', mark)
location.hash ||= '#lobby'
mark()
