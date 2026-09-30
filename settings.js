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

const settingsUI = profiles => {
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
  const rows = { Epiphany: { status: u.current, action: newer && u.how !== 'dev' ? `Update to ${u.latest}` : 'Check' }, ...v }
  ul.innerHTML = Object.entries(rows).map(([name, { status, action }]) =>
    `<li><span>${name}</span><span class="status">${status}</span><button data-act="${name}">${action}</button></li>`
  ).join('')
  ul.onclick = e => {
    const n = e.target.dataset.act
    if (n === 'gallery-dl') api.installGdl().then(drawInstruments)
    if (n === 'extension') api.exportExtension()
    if (n === 'tagger') (e.target.textContent === 'Remove' ? api.removeTagger() : api.installTagger()).then(drawInstruments)
    if (n === 'Epiphany') (newer && u.how !== 'dev' ? api.update() : Promise.resolve()).then(drawInstruments)
  }
})
drawInstruments()
