// Settings pages: General, Profile, Sites (with the credentials gallery-dl reads), Instruments.

const SITES = ['danbooru', 'gelbooru', 'safebooru', 'yandere', 'konachan', 'sankaku', 'e621', 'rule34',
  'zerochan', 'animepictures', 'ehentai', 'pixiv', 'twitter', 'deviantart', 'artstation', 'fanbox', 'fantia', 'bluesky']
// What gallery-dl needs per site. 'oauth' = a browser login flow, the rest are config fields.
// Field names are gallery-dl's keys, a dot for one inside another; danbooru and e621 take the API key as 'password'. ehentai: the
// browser's login cookies (Cloudflare stops gallery-dl's own login).
const CREDS = { danbooru: ['username', 'password'], gelbooru: ['api-key', 'user-id'], rule34: ['api-key', 'user-id'], e621: ['username', 'password'],
  sankaku: ['username', 'password'], twitter: ['username', 'password'], ehentai: ['cookies.ipb_member_id', 'cookies.ipb_pass_hash'], pixiv: 'oauth' }
const SECRET = /key|password|token|hash/
const HINT = { danbooru: { password: 'api-key' }, e621: { password: 'api-key' } } // what to paste, where the key's name says otherwise
const KEY = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M10.9 12.1 21 2m-3 3 3 3m-6 0 2 2"/></svg>'

let profs // the caption profiles, for Statistics' quality order
const settingsUI = profiles => {
  profs = profiles
  showStats()
  const general = $('#general ul')
  api.quoteSources().then(names => {
    general.querySelector('[name=quote]').innerHTML = names.map(n => `<option ${n === s.quote ? 'selected' : ''}>${n}</option>`).join('')
  })
  api.searchSites().then(names => {
    general.querySelector('[name=engine]').innerHTML = names.map(n => `<option ${n === s.engine ? 'selected' : ''}>${n}</option>`).join('')
  })
  general.querySelector('[name=theme]').value = localStorage.theme || 'system'
  general.querySelector('[name=lookup]').checked = s.lookup
  general.querySelector('[name=autotag]').checked = s.autotag
  general.querySelector('[name=aliases]').checked = s.aliases
  Object.assign(general.querySelector('[name=safe]'), { checked: !!s.safe || safeCli, disabled: safeCli })
  general.querySelector('[name=accept]').value = s.accept
  general.querySelector('[name=debug]').checked = !!s.debug
  general.querySelector('[name=slow]').value = localStorage.slow || '1'
  debug()
  general.onchange = e => {
    if (e.target.name === 'slow') { localStorage.slow = e.target.value; return debug() } // per machine, like the theme
    if (e.target.name === 'theme') return setTheme(e.target.value) // per machine, like the filters
    s[e.target.name] = e.target.type === 'checkbox' ? e.target.checked : e.target.name === 'accept' ? Number(e.target.value) : e.target.value
    save()
    if (e.target.name === 'quote') quote()
    if (e.target.name === 'engine') drawScope()
    if (e.target.name === 'debug') debug()
    if (e.target.name === 'safe') { setSafe(s.safe); applyFilters() }
  }

  const sites = $('#sites ul')
  api.getCreds().then(creds => {
    sites.innerHTML = SITES.map(site => {
      const c = CREDS[site]
      const fields = c === 'oauth' ? `<button data-oauth="${site}">Log in</button>`
        : (c || []).map(k => `<input name="${k}" placeholder="${HINT[site]?.[k] ?? k.split('.').pop()}" type="${SECRET.test(k) ? 'password' : 'text'}" value="${esc(k.split('.').reduce((o, p) => o?.[p], creds[site]) ?? '')}" spellcheck="false">`).join('')
      return `<li data-site="${site}"><label>${site}<input type="checkbox" value="${site}" ${s.sites.includes(site) ? 'checked' : ''}></label>${c ? `<button class="key" aria-label="Credentials">${KEY}</button><div class="creds" hidden>${fields}</div>` : ''}</li>`
    }).join('')
  })
  sites.onclick = e => {
    const key = e.target.closest('.key'), oauth = e.target.closest('[data-oauth]')
    if (key) { const d = key.nextElementSibling; d.hidden = !d.hidden }
    if (oauth) api.oauth(oauth.dataset.oauth)
  }
  sites.onchange = e => {
    if (e.target.type === 'checkbox') { s.sites = [...sites.querySelectorAll(':checked')].map(c => c.value); save(); drawScope() }
    else api.setCred(e.target.closest('li').dataset.site, e.target.name, e.target.value)
  }

  const sel = $('#profile select')
  const rows = $('#profile ul')
  sel.innerHTML = Object.keys(profiles).map(n => `<option ${n === s.profile ? 'selected' : ''}>${n}</option>`).join('')
  const draw = () => {
    rows.innerHTML = Object.entries(profiles[s.profile]).map(([k, v]) => {
      if (k === 'caption') return '<li><span>caption</span><button class="template" title="Edit in your text editor"><span></span>Edit</button></li>' // a long template is edited as a file, not in a one-line box
      const cur = s.overrides[k] ?? v
      const reset = k in s.overrides ? ` <a href="#profile" data-reset="${k}">reset</a>` : ''
      const input = typeof v === 'boolean'
        ? `<input type="checkbox" name="${k}" ${cur ? 'checked' : ''}>`
        : `<input type="text" name="${k}" value="${esc(cur)}">`
      return `<li><span>${k}${reset}</span>${input}</li>`
    }).join('')
    drawTemplate()
  }
  const drawTemplate = () => api.templateInfo().then(({ text, custom }) => {
    const b = rows.querySelector('.template')
    b.firstElementChild.textContent = text
    b.previousElementSibling.innerHTML = 'caption' + (custom ? ' <a href="#profile" data-reset="caption">reset</a>' : '')
  })
  addEventListener('focus', () => { if (location.hash === '#profile') drawTemplate() }) // back from the editor
  draw()
  sel.onchange = () => { s.profile = sel.value; s.overrides = {}; save(); draw() }
  rows.onchange = e => { // no redraw: it would drop the focus Tab just moved to the next field
    s.overrides[e.target.name] = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    save()
    const label = e.target.closest('li').firstElementChild
    if (!label.querySelector('a')) label.insertAdjacentHTML('beforeend', ` <a href="#profile" data-reset="${e.target.name}">reset</a>`)
  }
  rows.onclick = e => {
    if (e.target.closest('.template')) api.editTemplate()
    if (e.target.dataset.reset === 'caption') api.resetTemplate().then(drawTemplate)
    else if (e.target.dataset.reset) { delete s.overrides[e.target.dataset.reset]; save(); draw() }
  }
}

// Debug mode: the reload button (Shift restarts the app, for main.js), Ctrl+R / Ctrl+Shift+R, F12 for DevTools, the animation
// speed, and a DevTools port from the next start (main.js).
const debug = () => { document.body.classList.toggle('debug', !!s.debug); SLOW = s.debug ? +localStorage.slow || 1 : 1 }
const reload = restart => restart ? api.restart() : location.reload()
$('.fab .reload').onclick = e => reload(e.shiftKey)
addEventListener('keydown', e => {
  if (!s?.debug) return
  if (e.key === 'F12') api.devtools()
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') { e.preventDefault(); reload(e.shiftKey) }
})

// The fab's quick switch flips what shows now; Settings > General keeps the choice in step.
$('.fab .theme-toggle').onclick = () => {
  setTheme((root.dataset.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark' ? 'light' : 'dark')
  $('#general [name=theme]').value = localStorage.theme
}

const drawInstruments = () => Promise.all([api.instruments(), api.checkUpdate()]).then(([v, u]) => {
  const ul = $('#instruments ul')
  const newer = u.latest && u.latest !== u.current
  const rows = { Epiphany: { status: u.current, action: newer && u.how !== 'dev' ? `Update to ${u.latest}` : 'Check' }, ...v,
    statistics: s.statistics ? { status: 'installed', action: 'Remove' } : { status: 'not installed', action: 'Install' } }
  ul.innerHTML = Object.entries(rows).map(([name, { status, action }]) =>
    `<li><span>${name}</span><span class="status">${status}</span><button data-act="${name}">${action}</button></li>`
  ).join('')
  ul.onclick = e => {
    const n = e.target.dataset.act
    if (n === 'gallery-dl') api.installGdl().then(drawInstruments)
    if (n === 'extension') api.exportExtension()
    if (n === 'tagger') (e.target.textContent === 'Remove' ? api.removeTagger() : api.installTagger()).then(drawInstruments)
    if (n === 'statistics') { s.statistics = !s.statistics; save(); showStats() }
    if (n === 'Epiphany') (newer && u.how !== 'dev' ? api.update() : Promise.resolve()).then(drawInstruments)
  }
}) // first drawn by showStats, once settings are loaded

// Statistics: the pictures the filters let through (the filter button and the search work here as on the grid), counted a few
// ways; behind each bar, faint, the whole library: what the filters cut away. A bar with a filter of its own on the grid sets it
// (rating, tags, source; a name searches for it whole), and takes it off when clicked again; right-click: everything but it, as
// there. Ctrl adds it to what is chosen: one rating, source... or another (a picture has one of each); one name and another.
// Installed or not in Instruments, as a tagger is: removed, no page in Settings and nothing counted.
const showStats = () => {
  $('#settings aside a[href="#statistics"]').hidden = !s.statistics
  if (!s.statistics && location.hash === '#statistics') location.hash = '#instruments'
  drawStats(); drawInstruments()
}
const RATED = { g: 'General', s: 'Sensitive', q: 'Questionable', e: 'Explicit' }
const FROM = { booru: 'Booru', tagger: 'Tagger', unsure: 'Close matches', none: 'None' }
const LENGTHS = ['None', '1–9', '10–19', '20–29', '30–39', '40–49', '50+']
const tiers = () => { const p = { ...profs[s.profile], ...s.overrides }; return [...(p.qualities || '').split(',').map(t => t.trim()).filter(Boolean)].reverse().concat('None') }
const flip = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]))
// In two groups (style.css): where the pictures come from, to cut by; and what is in them.
// [title, the value(s) a picture counts under, their order (else by count), only the most common: names, the filter its bars set
// (q: the search) and a bar's value for it, a note on the title]
const STATS = {
  from: [
    ['Rating', i => RATED[i.rating || 'e'], () => Object.values(RATED), false, 'rating', k => flip(RATED)[k]], // unrated is explicit, as on the grid
    ['Tags from', i => FROM[i.tagged] ?? 'None', () => Object.values(FROM), false, 'tagged', k => flip(FROM)[k]],
    ['Source', i => source(i.site), null, false, 'site', k => k]
  ],
  in: [
    ['Quality', i => i.quality || 'None', tiers],
    ['Tags per picture', i => { const n = names(i.tags).length; return LENGTHS[Math.min(6, n && 1 + Math.floor(n / 10))] }, () => LENGTHS, false, null, null,
      l => `average ${(l.reduce((a, i) => a + names(i.tags).length, 0) / (l.length || 1)).toFixed(1)}`],
    ['Series', i => names(i.copyright), null, true, 'q', k => k],
    ['Characters', i => names(i.character), null, true, 'q', k => k],
    ['Artists', i => names(i.artist), null, true, 'q', k => k],
    ['Tags', i => names(i.tags), null, true, 'q', k => k]
  ]
}
const count = (list, key) => { const n = new Map(); for (const i of list) for (const k of [key(i)].flat()) n.set(k, (n.get(k) ?? 0) + 1); return n }
const asQ = v => v.toLowerCase().replace(/ /g, '_') // as the search box keeps it
const SEP = { rating: '' } // rating's choices are letters (gs), the others' comma-separated (renderer.js)
const chosen = (f, neg) => { const c = F[f] || ''; return c.startsWith('!') === neg ? c.replace(/^!/, '').split(SEP[f] ?? ',').filter(Boolean) : [] }
const drawStats = () => {
  const box = $('#statistics .charts')
  if (!profs || !s.statistics || !box.checkVisibility()) return // profs: the startup's first draw comes before settingsUI
  const on = shown($('#lobby')).map(i => i.item), ai = on.filter(i => i.ai).length
  $('#statistics p').textContent = `${plural(on.length, 'picture')} of ${items.length.toLocaleString()}${ai ? `, ${ai.toLocaleString()} AI-generated` : ''}`
  const chart = ([title, key, order, top, f, value, note]) => {
    const n = count(on, key), all = count(items, key), by = (a, b) => (n.get(b) ?? 0) - (n.get(a) ?? 0) || all.get(b) - all.get(a)
    const keys = order ? order().filter(k => all.has(k)) : top ? [...n.keys()].sort(by).slice(0, 12) : [...all.keys()].sort(by) // a name the filters cut away entirely isn't worth a line
    if (!keys.length) return ''
    const max = Math.max(...keys.map(k => all.get(k)))
    return `<div class="chart"><h3>${title}${note ? ` <small>${note(on)}${on.length < items.length ? `, library ${note(items).replace(/^\D+/, '')}` : ''}</small>` : ''}</h3>` + keys.map(k => {
      const v = f && value(k), now = f === 'q' ? Q().names.includes(asQ(k)) : v && chosen(f, false).includes(v)
      return `<div${v ? ` data-f="${f}" data-v="${esc(v)}"` : ''}${now ? ' class="on"' : v && chosen(f, true).includes(v) ? ' class="not"' : ''} title="${(n.get(k) ?? 0).toLocaleString()} of ${plural(on.length, 'picture')} on show; ${all.get(k).toLocaleString()} in the library">`
        + `<i class="all" data-w="${all.get(k) / max}"></i><i data-w="${(n.get(k) ?? 0) / max}"></i><span>${esc(k)}</span><b>${(n.get(k) ?? 0).toLocaleString()}</b></div>`
    }).join('') + '</div>'
  }
  box.innerHTML = Object.entries(STATS).map(([group, list]) => `<div class="${group}">${list.map(chart).join('')}</div>`).join('')
    + (items.length ? `<div class="saved">${saved(on)}</div>` : '')
  box.querySelectorAll('i').forEach(i => i.style.setProperty('--w', i.dataset.w)) // the page's CSP refuses style attributes
}
// Under the lists, across: pictures saved in the last month by the day, or the last week or day by the hour; the library faint
// behind what is on show, as on the bars. A column's tooltip gives its counts.
const SPANS = { Month: [30, false], Week: [7, true], Day: [1, true] } // days back, by the hour
const saved = on => {
  const span = SPANS[localStorage.savedSpan] ? localStorage.savedSpan : 'Month', [back, hour] = SPANS[span], now = Date.now()
  const bin = t => { const d = new Date(t); hour ? d.setMinutes(0, 0, 0) : d.setHours(0, 0, 0, 0); return +d }
  const keys = []
  for (const d = new Date(bin(now - back * 864e5)); +d <= now; hour ? d.setHours(d.getHours() + 1) : d.setDate(d.getDate() + 1)) keys.push(+d)
  const n = count(on, i => bin(i.time)), all = count(items, i => bin(i.time)), peak = Math.max(...keys.map(k => all.get(k) ?? 0))
  const x = j => j / (keys.length - 1) * 1000, w = 1000 / (keys.length - 1), y = v => 100 - (v ?? 0) / (peak || 1) * 96
  const line = m => { // smoothed: curves through the midpoints, each count a control point, so it never dips below 0 or tops the peak
    const p = keys.map((k, j) => [x(j), y(m.get(k))]), mid = (a, b) => `${(a[0] + b[0]) / 2},${(a[1] + b[1]) / 2}`
    return `${p[0]} L${mid(p[0], p[1])} ${p.slice(1, -1).map((q, j) => `Q${q} ${mid(q, p[j + 2])}`).join(' ')} L${p.at(-1)}`
  }
  const label = k => hour ? `${day(k)} ${new Date(k).getHours()}:00` : day(k)
  return `<div class="chart"><h3>Saved per ${hour ? 'hour' : 'day'} <small>peak ${peak.toLocaleString()}</small>`
    + `<div class="seg">${Object.keys(SPANS).map(k => `<button data-span="${k}"${k === span ? ' class="on"' : ''}>${k}</button>`).join('')}</div></h3>`
    + `<svg viewBox="0 0 1000 100" preserveAspectRatio="none"><path class="all" d="M0,100 L${line(all)} L1000,100Z"/><path d="M0,100 L${line(n)} L1000,100Z"/><path class="line" d="M${line(n)}"/>`
    + keys.map((k, j) => `<rect x="${x(j) - w / 2}" width="${w}" height="100"><title>${label(k)}: ${(n.get(k) ?? 0).toLocaleString()} on show, ${(all.get(k) ?? 0).toLocaleString()} in the library</title></rect>`).join('')
    + `</svg><p><span>${label(keys[0])}</span><span>${label(keys.at(-1))}</span></p></div>`
}
const cut = (e, not) => {
  const bar = e.target.closest('[data-f]')
  if (!bar) return
  e.preventDefault()
  const { f, v } = bar.dataset, add = e.ctrlKey || e.metaKey
  if (f === 'q') { // whole names; Ctrl keeps the others, and what is typed besides
    const was = Q().names, n = asQ(v)
    const to = add ? (was.includes(n) ? was.filter(x => x !== n) : [...was, n]) : was.length === 1 && was[0] === n && !Q().text.length ? [] : [n]
    scope.value = ''; search.value = [...to, ...add ? Q().text : []].map(x => x.replace(/_/g, ' ')).join(', ')
    return search.dispatchEvent(new Event('input'))
  }
  if (f === 'rating' && safe !== null) return // safe mode: Rating locked
  if (f === 'site') not = false // a source has no "everything but" on the grid either
  const sign = not ? '!' : '', was = chosen(f, !!not)
  const to = add ? (was.includes(v) ? was.filter(x => x !== v) : [...was, v]) : F[f] === sign + v ? [] : [v]
  swap(() => { F[f] = to.length ? sign + to.join(SEP[f] ?? ',') : ''; saveF(); applyFilters(); explain() })
}
$('#statistics .charts').onclick = e => {
  const b = e.target.closest('[data-span]')
  if (!b) return cut(e)
  localStorage.savedSpan = b.dataset.span
  $('#statistics .saved').innerHTML = saved(shown($('#lobby')).map(i => i.item))
}
$('#statistics .charts').oncontextmenu = e => cut(e, true)
addEventListener('hashchange', () => { if (location.hash === '#statistics') s.statistics ? drawStats() : location.replace('#instruments') }) // removed: no page
