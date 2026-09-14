const SITES = ['danbooru', 'gelbooru', 'safebooru', 'yandere', 'konachan', 'sankaku', 'e621', 'rule34',
  'zerochan', 'animepictures', 'pixiv', 'twitter', 'deviantart', 'artstation', 'fanbox', 'fantia', 'bluesky']
const $ = s => document.querySelector(s)
const esc = s => String(s).replace(/"/g, '&quot;')
// What gallery-dl needs per site. 'oauth' = a browser login flow, the rest are config fields.
const CREDS = { danbooru: ['username', 'api-key'], gelbooru: ['api-key', 'user-id'], e621: ['username', 'api-key'],
  sankaku: ['username', 'password'], twitter: ['username', 'password'], pixiv: 'oauth' }
const SECRET = /key|password|token/
const KEY = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M10.9 12.1 21 2m-3 3 3 3m-6 0 2 2"/></svg>'
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
  img.onload = () => { img.style.animationDelay = 100 + Math.random() * 200 + 'ms'; img.classList.add('in') } // cached thumbs all land in the same frame; a little scatter reads as one-by-one
  img.src = item.thumb || item.url
  img.loading = 'lazy'
  img.decoding = 'async'
  img.title = item.src
  decorate(img, item)
  grid[front ? 'prepend' : 'append'](img)
}
const decorate = (img, item) => {
  img.item = item
  img.onclick = e => e.ctrlKey || e.metaKey || e.shiftKey ? select(img, e) : preview(item, img.closest('section'))
  img.oncontextmenu = () => api.menu(item)
  img.dataset.file = item.file
  img.dataset.q = `${item.artist || ''} ${item.tags || ''}`.toLowerCase()
  img.dataset.site = item.site
  if (item.ai) img.dataset.ai = 1
  img.dataset.rating = item.rating || 'g'
  img.dataset.tagged = item.tagged || 'none'
  hide(img)
}

// Selection: Ctrl-click toggles, Shift-click extends from the last toggle, Ctrl+A takes every visible picture, Esc clears.
const sel = new Set()
let anchor
const selUI = $('#selection')
const visible = () => [...(location.hash === '#projects' ? pgrid : $('#lobby')).querySelectorAll('.grid img')].filter(i => !i.hidden)
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
addEventListener('keydown', e => {
  if (dlg.open || e.target.matches?.('input, textarea')) return
  if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); visible().forEach(i => sel.add(i.dataset.file)); drawSel() }
  if (e.key === 'Escape' && sel.size) { sel.clear(); drawSel() }
})
selUI.querySelector('.clear').onclick = () => { sel.clear(); drawSel() }
selUI.querySelector('.export').onclick = () => api.export(items.filter(i => sel.has(i.file)))

// View filters: never touch files, only what is shown. Kept per machine.
const F = JSON.parse(localStorage.filters || '{"ai":true,"rating":"","tagged":"","site":"","q":""}')
const filters = $('#filters')
const saveF = () => localStorage.filters = JSON.stringify({ ...F, q: '' }) // the search box is not remembered
const hide = img => img.hidden = !!((!F.ai && img.dataset.ai) || (F.rating && !F.rating.includes(img.dataset.rating)) || (F.tagged && img.dataset.tagged !== F.tagged) || (F.site && img.dataset.site !== F.site) || (F.q && !img.dataset.q.includes(F.q)))
const applyFilters = () => {
  document.querySelectorAll('.grid img').forEach(hide)
  $('.filter-toggle').classList.toggle('on', Object.entries(F).some(([k, v]) => k === 'ai' ? !v : v))
}
const drawSites = () => {
  const sel = filters.querySelector('[name=site]')
  sel.innerHTML = '<option value="">All sources</option>' + [...new Set(items.map(i => i.site).filter(Boolean))].sort()
    .map(x => `<option ${x === F.site ? 'selected' : ''}>${x}</option>`).join('')
}
// Search box: local scope filters the grid as you type; a site scope pulls that site's tag search on Enter.
const search = $('.search input'), scope = $('.search select')
const localQ = () => { F.q = scope.value ? '' : search.value.trim().toLowerCase().replace(/ /g, '_'); applyFilters() }
search.oninput = localQ
scope.onchange = localQ
search.onkeydown = e => { if (e.key === 'Enter' && scope.value && search.value.trim()) api.search(scope.value, search.value.trim()).catch(() => {}) }
filters.querySelectorAll('input').forEach(i => i.checked = F[i.name])
filters.querySelectorAll('.seg').forEach(seg => {
  const name = seg.dataset.name
  const show = () => seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.value === (F[name] || '')))
  seg.onclick = e => { if (e.target.tagName === 'BUTTON') { F[name] = e.target.value; show(); saveF(); applyFilters() } }
  show()
})
filters.onchange = e => { F[e.target.name] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; saveF(); applyFilters() }
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
plist.oncontextmenu = e => { if (e.target.dataset.p) api.projectMenu(e.target.dataset.p) }
api.onProjectRemoved(async name => {
  items = items.filter(i => i.project !== name)
  document.querySelectorAll('.grid img').forEach(i => { if (i.item.project === name) { sel.delete(i.dataset.file); i.remove() } })
  drawSel()
  ;[projects, s] = await Promise.all([api.projects(), api.getSettings()])
  drawProjects()
  drawSites()
})
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
  dlg.querySelector('.time').textContent = new Date(item.time).toLocaleString()
  dlg.querySelector('.rating').textContent = { g: 'general', s: 'sensitive', q: 'questionable', e: 'explicit' }[item.rating] ?? ''
  const tagged = dlg.querySelector('.tagged')
  tagged.textContent = { booru: 'Tags: booru', none: 'Tags: none', unsure: 'Tags: pick a match' }[item.tagged]
  if (item.tagged !== 'booru') tagged.append(' ', Object.assign(document.createElement('a'), { href: '#', textContent: 'Look up', onclick: e => { e.preventDefault(); api.lookup(item) } }))
  // Close IQDB matches: click one to see its caption in the box, Use to keep it.
  const picks = dlg.querySelector('.picks'), use = dlg.querySelector('.use')
  use.hidden = true
  picks.replaceChildren(...(item.candidates ?? []).map((c, i) => {
    const b = document.createElement('button')
    b.innerHTML = `<img src="${esc(c.url ?? '')}"><span>${c.score}% · +${c.plus.length}</span>`
    b.title = c.plus.join(', ') || 'no tags of its own'
    b.onclick = () => {
      picks.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b))
      dlg.querySelector('textarea').value = c.caption
      use.hidden = false
      use.onclick = () => api.pick(item, i)
    }
    return b
  }))
  const proj = dlg.querySelector('.proj')
  proj.textContent = item.project
  proj.onclick = e => { e.preventDefault(); dlg.close(); openProject(item.project) }
  const from = dlg.querySelector('.from')
  from.hidden = !item.from
  if (item.from) { from.replaceChildren('caption from ', Object.assign(document.createElement('b'), { textContent: new URL(item.from).host })); from.onclick = e => { e.preventDefault(); api.open(item.from) } }
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
api.onSearch(tag => { dlg.close(); scope.value = ''; search.value = tag; localQ(); search.focus() })

const settingsUI = profiles => {
  const general = $('#general ul')
  api.quoteSources().then(names => {
    general.querySelector('[name=quote]').innerHTML = names.map(n => `<option ${n === s.quote ? 'selected' : ''}>${n}</option>`).join('')
  })
  general.querySelector('[name=lookup]').checked = s.lookup
  general.querySelector('[name=accept]').value = s.accept
  general.onchange = e => {
    s[e.target.name] = e.target.type === 'checkbox' ? e.target.checked : e.target.name === 'accept' ? Number(e.target.value) : e.target.value
    save()
    if (e.target.name === 'quote') quote()
  }
  stagger(general)

  const sites = $('#sites ul')
  api.getCreds().then(creds => {
    sites.innerHTML = SITES.map(site => {
      const c = CREDS[site]
      const fields = c === 'oauth' ? `<button data-oauth="${site}">Log in</button>`
        : (c || []).map(k => `<input name="${k}" placeholder="${k}" type="${SECRET.test(k) ? 'password' : 'text'}" value="${esc(creds[site]?.[k] ?? '')}" spellcheck="false">`).join('')
      return `<li data-site="${site}"><label>${site}<input type="checkbox" value="${site}" ${s.sites.includes(site) ? 'checked' : ''}></label>${c ? `<button class="key" aria-label="Credentials">${KEY}</button><div class="creds" hidden>${fields}</div>` : ''}</li>`
    }).join('')
    stagger(sites)
  })
  sites.onclick = e => {
    const key = e.target.closest('.key'), oauth = e.target.closest('[data-oauth]')
    if (key) { const d = key.nextElementSibling; d.hidden = !d.hidden }
    if (oauth) api.oauth(oauth.dataset.oauth)
  }
  sites.onchange = e => {
    if (e.target.type === 'checkbox') { s.sites = [...sites.querySelectorAll(':checked')].map(c => c.value); save() }
    else api.setCred(e.target.closest('li').dataset.site, e.target.name, e.target.value)
  }

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
  api.searchSites().then(names => scope.innerHTML = '<option value="">local</option>' + names.filter(n => s.sites.includes(n)).map(n => `<option>${n}</option>`).join(''))
  applyFilters()
  settingsUI(profiles)
})
api.onOpenProject(openProject)
const toastEl = $('#toast')
let toastTimer
api.onToast(t => { toastEl.textContent = t; toastEl.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.hidden = true, 2500) })
api.onRemoved(file => {
  items = items.filter(i => i.file !== file)
  if (sel.delete(file)) drawSel()
  document.querySelectorAll('.grid img').forEach(i => { if (i.dataset.file === file) i.remove() })
})
api.onSaved(i => {
  if (i.replace) { // same picture, fresher facts (tags looked up)
    items[items.findIndex(x => x.file === i.file)] = i
    document.querySelectorAll('.grid img').forEach(img => { if (img.dataset.file === i.file) decorate(img, i) })
    if (dlg.open && cur.file === i.file) preview(i)
    return
  }
  items.unshift(i)
  drawSites()
  add($('#lobby'), i, true)
  if (i.project === s.project) add(pgrid, i, true)
})

const drawInstruments = () => Promise.all([api.instruments(), api.checkUpdate()]).then(([v, u]) => {
  const ul = $('#instruments ul')
  const newer = u.latest && u.latest !== u.current
  const rows = { Epiphany: { status: u.current, action: newer && u.how !== 'dev' ? `Update to ${u.latest}` : 'Check' }, ...v }
  ul.innerHTML = Object.entries(rows).map(([name, { status, action }]) =>
    `<li><span>${name}</span><span class="status">${status}</span><button data-act="${name}">${action}</button></li>`
  ).join('')
  stagger(ul)
  ul.onclick = e => {
    const n = e.target.dataset.act
    if (n === 'gallery-dl') api.installGdl().then(drawInstruments)
    if (n === 'extension') api.exportExtension()
    if (n === 'Epiphany') (newer && u.how !== 'dev' ? api.update() : Promise.resolve()).then(drawInstruments)
  }
})
drawInstruments()

const h1 = $('h1 .t-lobby')
const quote = () => api.quote().then(q => { h1.textContent = q || 'Lobby'; h1.classList.toggle('quote', !!q) })
h1.onclick = quote
quote()

const mark = () => document.querySelectorAll('#settings aside a').forEach(a => a.classList.toggle('on', a.hash === location.hash))
addEventListener('hashchange', mark)
location.hash ||= '#lobby'
mark()
