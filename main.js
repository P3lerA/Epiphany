const { app, BrowserWindow, ipcMain, Menu, shell, nativeImage, dialog, nativeTheme, Tray, net, clipboard } = require('electron')
const http = require('http')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const crypto = require('crypto')
const { PROFILES, caption, exported, tagLine, quality } = require('./profiles')
const Tagger = require('./tagger')
const share = require('./share')
const { BOORU, EH, gdlName, postUrl, SEARCH, own, range } = require('./sites')
const { thumbnail } = require('./thumbnail')
const quotes = require('./quotes')

const PORT = Number(process.env.EPIPHANY_PORT) || 7676 // 7777 collides with AIRI, 67xx is a Windows reserved range; env override keeps test runs off the real app
const HOME = process.env.EPIPHANY_HOME || (app.isPackaged ? app.getPath('userData') : __dirname)
const SETTINGS = path.join(HOME, 'settings.json')
const WIN = path.join(HOME, 'window.json') // last window bounds; separate file so renderer settings saves never clobber it
const DEFAULTS = { project: 'default', quote: 'advice', lookup: true, sites: ['danbooru', 'gelbooru'], profile: 'anima', overrides: {}, accept: 90, autotag: true, engine: 'danbooru', statistics: false, aliases: false }
let win
const MAC = process.platform === 'darwin'
// From source the icon's blue square is red (red and blue swapped): a dev instance stands apart in the Dock or taskbar.
const icon = file => {
  const i = nativeImage.createFromPath(path.join(__dirname, 'build', file))
  if (app.isPackaged) return i
  const b = i.toBitmap()
  for (let k = 0; k < b.length; k += 4) [b[k], b[k + 2]] = [b[k + 2], b[k]]
  return nativeImage.createFromBitmap(b, i.getSize())
}
// macOS keeps its reflexes in the menu bar, so it gets the stock menus: Cmd+C/V/X/A, Cmd+W (closing parks the window), Cmd+M, Cmd+Q,
// and Cmd+, for Settings. Windows has none.
const openSettings = { label: 'Settings…', accelerator: 'Cmd+,', click: () => { win.show(); win.webContents.executeJavaScript("$('#settings :target') || $('.fab a').click()") } }
Menu.setApplicationMenu(MAC ? Menu.buildFromTemplate([
  { label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, openSettings, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
  { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }
]) : null)
if (!app.requestSingleInstanceLock()) app.exit() // quit() is async and whenReady would still open a window; a second launch (tray-parked app, double-clicked exe) just raises the first
app.on('second-instance', () => { win?.show(); win?.focus() })

const readJson = (f, fallback) => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : fallback
const writeJson = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 2))
const settings = () => ({ ...DEFAULTS, ...readJson(SETTINGS, {}) })
// Debug mode opens a DevTools port at start, so the running app can be driven from outside (Claude's tests) without a relaunch.
if (settings().debug && !app.commandLine.hasSwitch('remote-debugging-port')) app.commandLine.appendSwitch('remote-debugging-port', '9231') // one given wins: two instances, one port
// A profile's caption template can live in captions/<profile>.md, edited in the user's editor: one piece per line, <!-- notes --> ignored.
const templateFile = () => path.join(HOME, 'captions', settings().profile + '.md')
const template = () => fs.existsSync(templateFile()) ? fs.readFileSync(templateFile(), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/\r?\n/g, ',') : null
const profile = () => { const s = settings(), t = template(); return { ...PROFILES[s.profile], ...s.overrides, ...(t != null && { caption: t }) } }
const editTemplate = () => {
  const f = templateFile()
  if (!fs.existsSync(f)) {
    fs.mkdirSync(path.dirname(f), { recursive: true })
    const note = `<!-- Caption template for the "${settings().profile}" profile. One piece per line. {{tags}} {{artist}} {{character}} {{copyright}} {{rating}} {{quality}} are filled in per picture. Delete this file (or Reset in Settings) to go back to the default. -->`
    fs.writeFileSync(f, [note, ...profile().caption.split(',').map(x => x.trim())].join('\n') + '\n')
  }
  return shell.openPath(f)
}
const templateInfo = () => ({ text: profile().caption.split(',').map(x => x.trim()).filter(Boolean).join(', '), custom: template() != null })
const resetTemplate = () => fs.existsSync(templateFile()) && shell.trashItem(templateFile())
const gallery = require('./gdl')(HOME), { gdl, kill, oauth } = gallery
const { UA, pullWikis, tagWiki, useAliases, renamed, aliasing, artistOf, tagsFor } = require('./danbooru')({ home: HOME, readJson, settings })
const GDL = gallery.CONFIG // site credentials live here, where gallery-dl reads them
const PROJ = path.join(HOME, 'project')

const dir = (p = settings().project) => {
  const d = path.join(PROJ, p, 'dataset')
  fs.mkdirSync(d, { recursive: true })
  return d
}

const projects = () => {
  fs.mkdirSync(PROJ, { recursive: true })
  return fs.readdirSync(PROJ, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
}

const words = v => (Array.isArray(v) ? v : String(v ?? '').split(' ')).filter(Boolean) // booru tag strings are space-separated
const withUrl = item => ({ ...item, url: pathToFileURL(item.file).href })

// View-side facts from the gallery-dl sidecar: source site, AI-tagged, rating normalized to g/s/q/e.
const rating = j => {
  const r = String(j.rating ?? '').toLowerCase()
  const four = j.category === 'danbooru' || j.category === 'gelbooru' // elsewhere s = safe
  return r.startsWith('safe') || (!four && r === 's') ? 'g' : r.startsWith('r-18') ? 'e' : (r[0] ?? '') // pixiv: General, R-18, R-18G
}

// Where a picture's tags come from: a booru match looked up for a non-booru source, the booru it was pulled from, or the tagger's guess.
const source = j => j.booru ?? (j.tagger && !BOORU.has(j.category) ? tagger.post(j.tagger) : j)
// Its caption fields: the source's; no booru post, the artist danbooru knows its account as (j.account), over the tagger's guess;
// series, characters and artists written by hand over them (j.edit, booru-style strings).
const facts = j => ({ ...meta(source(j)), ...!j.booru && j.account && { artist: meta({ tag_string_artist: j.account.artist }).artist },
  ...Object.fromEntries(Object.entries(j.edit ?? {}).map(([k, v]) => [k, words(v).join(k === 'artist' ? ', @' : ', ')])) })
// Rebuilds the .txt, the general tags, from the sidecar; what was written there by hand goes.
const recaption = (item, j) => fs.writeFileSync(txt(item.file), tagLine(facts(j).tags))
const info = (item, prof = profile()) => {
  const j = sidecar(item, null)
  if (!j) return { site: new URL(item.page).host, ai: false, rating: '', tagged: 'none' }
  const b = source(j)
  const tags = [b.tag_string, b.tags, b.tag_string_meta, b.tags_metadata].flatMap(words)
  // booru: booru-vocabulary tags (pulled from one, or matched); unsure: close matches await a pick; tagger: no booru has it, the
  // tagger guessed; none: no tags.
  const tagged = j.booru ? 'booru' : j.candidates ? 'unsure' : BOORU.has(j.category) ? 'booru' : j.tagger ? 'tagger' : 'none'
  // Each candidate with the tags only it has, so look-alike variants can be told apart.
  const sets = j.candidates?.map(c => new Set(words(c.post.tag_string_general)))
  const candidates = j.candidates?.map((c, i) => ({ score: c.score, url: c.thumb && fs.existsSync(c.thumb) ? pathToFileURL(c.thumb).href : c.post.preview_file_url ?? c.post.preview_url, head: caption(prof, meta(c.post)), tags: tagLine(meta(c.post).tags), post: postUrl(c.post), plus: [...sets[i]].filter(t => !sets.some((o, k) => k !== i && o.has(t))) }))
  // The post the caption's tags came from: the matched one for lookups, the pulled one for booru pulls (a tag search's page URL isn't it).
  const p = j.booru ?? (BOORU.has(j.category) ? j : null), from = p && { site: p.category, url: postUrl(p) }
  const m = facts(j)
  return { site: j.category === 'exhentai' ? 'ehentai' : j.category, ai: tags.some(t => /^ai[-_]generated$/.test(t)), rating: rating(b), artist: m.artist, character: m.character, copyright: m.copyright, tags: m.tags, quality: quality(prof, m), tagged, candidates, from }
}

// Grid thumbnails live beside the dataset, never inside it: the square the grid shows (the middle), 400 px, cached as JPEG. A
// long picture's short side is 400 too (it came back thin, blurred in the square; on macOS squashed), no other is any bigger.
// One made before (name.jpg, not name.sq.jpg) is shown until its square is made, one at a time behind the load, then removed.
const thumbs = p => { const d = path.join(PROJ, p, 'thumbs'); fs.mkdirSync(d, { recursive: true }); return d }
const thumbPath = item => path.join(thumbs(item.project), path.basename(item.file) + '.sq.jpg')
const square = async (file, t) => {
  const img = await thumbnail(file, { short: 400 }), { width: w, height: h } = img.getSize(), side = Math.min(w, h)
  fs.writeFileSync(t, img.crop({ x: (w - side) >> 1, y: (h - side) >> 1, width: side, height: side }).toJPEG(82))
}
let redoing = Promise.resolve()
const thumb = async item => {
  const t = thumbPath(item), old = t.replace(/\.sq\.jpg$/, '.jpg')
  if (!fs.existsSync(t)) {
    if (fs.existsSync(old)) { redoing = redoing.then(() => square(item.file, t)).then(() => fs.rmSync(old, { force: true }), () => {}); return pathToFileURL(old).href }
    try { await square(item.file, t) } catch { return item.url }
  }
  return pathToFileURL(t).href
}

// A picture's sidecar; a right-click save has none until a lookup writes one, and one cut off mid-write reads as none (the
// library still loads; the next lookup writes it afresh).
const sidecar = (item, none = { category: new URL(item.page).host, page: item.page }) => { try { return readJson(item.file + '.json', none) } catch { return none } }
const enrich = async (item, prof) => { const e = withUrl({ ...item, ...info(item, prof) }); e.thumb = await thumb(e); return e }

const record = (item, p = settings().project) => { // p: a pull's own project, though another be opened before its files land
  fs.appendFileSync(path.join(dir(p), 'meta.jsonl'), JSON.stringify(item) + '\n')
  item = { ...item, project: p }
  enrich(item).then(e => send('saved', e))
  return item
}

const send = (ch, ...a) => win?.webContents.send(ch, ...a)
// What the app is doing, in the header's task line (tasks.js). task(): shown while it runs, its line updated as it goes, ending
// with a result; note(): a result or error on its own. A result stays there a few seconds.
const running = new Map()
let taskN = 0
// stop: how to cut it short, for the ✕ beside the line (tasks.js); work without one runs to its end.
const task = (text, stop, from) => { // from: the extension's request, its spinner (anim: the task line plays the one it shows) and id (to stop it from there)
  const id = ++taskN, show = () => send('tasks', [...running].map(([id, t]) => ({ id, text: t.text, stop: !!t.stop, anim: t.anim })))
  running.set(id, { text, stop, anim: from?.anim, req: from?.id }); show()
  return { set: t => { running.get(id).text = t; show() }, end: result => { running.delete(id); show(); if (result) note(result) } }
}
const stopTask = id => running.get(id)?.stop?.()
const stopRequest = req => [...running.values()].find(t => t.req === req)?.stop?.()
const note = (text, error) => send('note', { text, error: !!error })


function createWindow() {
  const saved = readJson(WIN, {})
  win = new BrowserWindow({
    width: 1000,
    height: 700,
    ...saved.bounds,
    show: false,
    titleBarStyle: 'hidden', // the renderer's header is the title bar; Windows keeps only its caption buttons
    titleBarOverlay: { height: 56 },
    trafficLightPosition: { x: 20, y: 21 }, // macOS: its buttons centred in the header
    icon: icon('icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false }
  })
  win.once('ready-to-show', () => { win.show(); if (saved.maximized) win.maximize() })
  win.on('close', e => {
    writeJson(WIN, { bounds: win.getNormalBounds(), maximized: win.isMaximized() })
    if (!app.quitting) { e.preventDefault(); win.hide() } // closing parks it in the tray; the extension keeps a listener
  })
  win.loadFile('index.html')
}

// Only web URLs reach fetch/gallery-dl; anything else (file:, "--exec=...") is refused.
const web = u => { if (!URL.canParse(u) || !/^https?:$/.test(new URL(u).protocol)) throw new Error(`Not a web URL: ${u}`) }

// Debug's ethereal mode: a pull or a save lands, is counted, and is gone, never in the library (the same page pulls again).
const ethereal = () => !!(settings().debug && settings().ethereal)
// Right-click: one image URL, fetched directly. On E-Hentai's viewer that is a resample: gallery-dl pulls the original instead.
async function save({ src, page, anim, id }) {
  web(src); web(page)
  if (EH.test(new URL(page).host) && new URL(page).pathname.startsWith('/s/')) return pull({ page, anim, id })
  const res = await fetch(src, { headers: { Referer: page, 'User-Agent': 'Mozilla/5.0 Epiphany/0.1' } })
  if (!res.ok) throw new Error(`${res.status} ${src}`)
  let name = decodeURIComponent(path.basename(new URL(src).pathname)).replace(/[<>:"/\\|?*]/g, '_') || 'image'
  if (!path.extname(name)) name += '.' + (res.headers.get('content-type')?.split('/')[1]?.split(';')[0] || 'bin')
  if (fs.existsSync(path.join(dir(), name))) name = `${Date.now()}_${name}`
  const file = path.join(dir(), name), buf = Buffer.from(await res.arrayBuffer())
  if (ethereal()) return { file }
  fs.writeFileSync(file, buf)
  const item = record({ file, src, page, time: new Date().toISOString() })
  // Same matching as a pull, after the reply; it reports its own errors. Not a field: the item is spread into every 'saved' after
  // this, and IPC can't clone a Promise (importShared awaits it).
  Object.defineProperty(item, 'looked', { value: settings().lookup && relookup(item).catch(() => {}) })
  return item
}

// gallery-dl metadata -> caption fields, old names renamed (aliases, below).
const first = (j, kind, ...ks) => [...new Set(words(ks.map(k => j[k]).find(v => v && v.length)).map(t => renamed(kind, t)))]

const meta = j => ({
  tags: first(j, 'tags', 'tag_string_general', 'tags_general', 'tags').join(', '),
  artist: first(j, 'artist', 'tag_string_artist', 'tags_artist').join(', @'), // ponytail: "a, @b" so "@{{artist}}" reads right
  character: first(j, 'character', 'tag_string_character', 'tags_character').join(', '),
  copyright: first(j, 'copyright', 'tag_string_copyright', 'tags_copyright').join(', '),
  rating: rating(j),
  score: j.score ?? ''
})


// Similarity search per site, each answering with whole posts. Danbooru's IQDB needs an account (anonymous uploads are denied;
// API-key auth also skips Rails CSRF; net.fetch because Cloudflare accepts Chromium's TLS, not Node's).
const SIMILAR = {
  danbooru: form => !danAuth() ? [] : net.fetch('https://danbooru.donmai.us/iqdb_queries.json', { method: 'POST', body: form('search[file]'), signal: AbortSignal.timeout(30000), headers: { Authorization: danAuth() } })
    .then(r => r.ok ? r.json() : (note(`IQDB: ${r.status}`, true), [])).catch(e => (note(`IQDB: ${e.message}`, true), [])).then(c => c.filter(x => x.post))
}
// iqdb.org: one upload covers every booru it indexes, and the tags ride along in each thumbnail's alt text. It is HTML, but the
// template has not changed since 2008; if it ever does, the regex finds nothing and we get no candidates, never wrong ones.
// Hits on yande.re (not booru words) and konachan (fewer tags, no artist told apart) are left out.
const IQDB_HOST = { 'danbooru.donmai.us': 'danbooru', 'gelbooru.com': 'gelbooru',
  'chan.sankakucomplex.com': 'sankaku', 'anime-pictures.net': 'animepictures', 'www.zerochan.net': 'zerochan' }
const IQDB_ONLY = ['gelbooru', 'sankaku', 'zerochan', 'animepictures'] // enabling one of these is what turns iqdb.org on
const iqdbOrg = form => fetch('https://iqdb.org/', { method: 'POST', body: form('file'), signal: AbortSignal.timeout(30000), ...UA })
  .then(r => r.ok ? r.text() : '').catch(() => '').then(html => html.split('<table>').flatMap(t => {
    const m = t.match(/href="\/\/([^/"]+)([^"]*)"[^>]*>\s*<img src='([^']+)' alt="Rating: (\w+)(?: Score: (\S+))? Tags: ([^"]*)"[\s\S]*?(\d+)% similarity/)
    const category = m && IQDB_HOST[m[1]], id = m && m[2].match(/\d+(?!.*\d)/)?.[0]
    return category && id ? [{ score: Number(m[7]), post: { id: Number(id), category, tags: m[6], rating: m[4], score: Number(m[5]) || '', preview_url: 'https://iqdb.org' + m[3] } }] : []
  }))
const canSimilar = () => settings().sites.some(site => (SIMILAR[site] && (site !== 'danbooru' || danAuth())) || IQDB_ONLY.includes(site))
const danAuth = () => { const d = readJson(GDL, {}).extractor?.danbooru ?? {}; return d.username && d.password ? 'Basic ' + Buffer.from(`${d.username}:${d.password}`).toString('base64') : null } // password: the API key, as gallery-dl reads it
const lookup = async (j, file, say = () => {}) => { // say: the step it is on, for the task line
  const get = (url, pick) => fetch(url, { signal: AbortSignal.timeout(8000), ...UA })
    .then(r => r.ok ? r.json() : null).then(pick, () => null)
  // one: the tags must name exactly one post (a multi-page pixiv work is several posts; the wrong page would get the wrong tags)
  const dan = (tags, one) => get(`https://danbooru.donmai.us/posts.json?limit=2&tags=${encodeURIComponent(tags)}`, r => r?.[0] && !(one && r[1]) ? { ...r[0], category: 'danbooru' } : null)
  const md5 = crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex')
  // The source id: from gallery-dl's metadata, or from the page a right-click save came from.
  const pix = j.category === 'pixiv' ? j.id : j.page?.match(/pixiv\.net\/(?:en\/)?artworks\/(\d+)/)?.[1]
  const tw = j.category === 'twitter' ? j.tweet_id : j.page?.match(/(?:twitter|x)\.com\/\w+\/status\/(\d+)/)?.[1]
  const key = pix ? `pixiv_id:${pix}` : tw ? `source:*status/${tw}*` : null
  const gel = () => get(`https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1&limit=1&tags=md5:${md5}${gelCreds()}`, r => r?.post?.[0] ? { ...r.post[0], category: 'gelbooru' } : null)
  // Exact bytes first, then the source id, then similarity. The search engine's booru (Settings > General) first, as close ones go.
  const engine = settings().engine, before = (a, b) => (b === engine) - (a === engine)
  const same = { danbooru: () => dan(`md5:${md5}`), gelbooru: gel }
  let hit
  for (const site of Object.keys(same).sort(before)) if (!hit) { say(`same file on ${site}`); hit = await same[site]() }
  if (!hit && key) { say('source on danbooru'); hit = await dan(key, true) }
  if (!hit) {
    // Same picture, different bytes (watermark, rescale, scan): ask every enabled site that can search by similarity.
    const bytes = fs.readFileSync(file)
    const form = (field, b = bytes) => { const d = new FormData(); d.append(field, new Blob([b]), path.basename(file)); return d }
    const found = []
    const sites = settings().sites
    for (const site of sites) if (SIMILAR[site]) { say(`similar on ${site}`); for (const c of await SIMILAR[site](form)) found.push({ score: Math.round(c.score), post: { ...c.post, category: site } }) }
    if (sites.some(s => IQDB_ONLY.includes(s))) {
      say('similar on iqdb.org')
      // It refuses over 8 MB: a bigger picture goes as a 1000px JPEG (its scores barely move; danbooru's drop a few, so only here).
      const b = bytes.length > 8e6 ? (await thumbnail(file, { long: 1000 })).toJPEG(90) : bytes
      for (const c of await iqdbOrg(field => form(field, b))) if (!found.some(f => f.post.category === c.post.category && f.post.id === c.post.id)) found.push(c)
    }
    const near = found.filter(x => x.score >= 70).sort((a, b) => b.score - a.score || before(a.post.category, b.post.category)).slice(0, 4)
    // Settings decide how sure a similarity match must be to skip the human; exact id/md5 hits above never ask.
    if (near.length && near[0].score >= settings().accept && (near.length === 1 || near[0].score - near[1].score >= 15)) hit = near[0].post
    else if (near.length) {
      j.candidates = near
      // Their preview thumbnails, fetched here (Chromium's stack, proven against the CDN) and kept beside our own thumbs; one that
      // doesn't save shows from its site instead (info).
      const p = path.basename(path.dirname(path.dirname(file)))
      for (const c of near) {
        const t = path.join(thumbs(p), `cand-${c.post.category}-${c.post.id}.jpg`) // ids collide across sites
        if (!fs.existsSync(t)) await net.fetch(c.post.preview_file_url ?? c.post.preview_url, { signal: AbortSignal.timeout(15000) }).then(async r => r.ok && fs.writeFileSync(t, Buffer.from(await r.arrayBuffer()))).catch(() => {})
        if (fs.existsSync(t)) c.thumb = t
      }
    }
  }
  return hit
}

// Toolbar button: a page URL, handed to gallery-dl. Pulls go one at a time, in the order they came (the extension sends one at a
// time too: the rest wait in its Next).
let pulling = Promise.resolve()
// Ctrl+V on the page, or text dropped on it ({ text, html }): every web address in it is pulled, as the extension's button would; a
// share line is imported. A copied image carries its own. Electron's clipboard is the W3C one: async, and HTML only through read().
const paste = async dropped => {
  const text = dropped?.text ?? await clipboard.readText(), shared = share.read(text)
  if (shared.length) return shared.forEach(s => importShared(s).catch(e => note(e.message, !e.quiet)))
  const html = async () => dropped ? dropped.html : (await (await clipboard.read()).find(i => i.types.includes('text/html'))?.getType('text/html'))?.text() ?? ''
  const urls = text.match(/https?:\/\/[^\s"'<>，。、；！？）]+/g)?.map(u => u.replace(/[.,;:!?)]+$/, '')) ?? (await html()).match(/(?<=<img[^>]+src=")[^"]+/g)?.map(u => u.replace(/&amp;/g, '&'))
  if (!urls) return note('No link to pull')
  for (const page of new Set(urls)) pull({ page }).catch(e => note(e.message, !e.quiet))
}
// Pictures dropped from the file manager, or the pictures in a dropped folder (not its subfolders): copied into the project, then
// as a right-click save is (save), each looked up as it lands. Its page: where it was, as a file: URL.
const PICTURE = /\.(jpe?g|png|webp|gif|avif|bmp)$/i
const importFiles = paths => {
  const d = dir(), s = settings()
  const files = paths.flatMap(p => fs.statSync(p).isDirectory() ? fs.readdirSync(p).map(f => path.join(p, f)) : [p])
    .filter(f => PICTURE.test(f) && fs.statSync(f).isFile() && path.dirname(f) !== d) // one of the project's own: there already
  if (!files.length) return note('No pictures there')
  if (!ethereal()) for (const f of files) {
    let name = path.basename(f)
    for (let k = 1; fs.existsSync(path.join(d, name)); k++) name = `${k}_${path.basename(f)}`
    fs.copyFileSync(f, path.join(d, name))
    const item = record({ file: path.join(d, name), src: pathToFileURL(f).href, page: pathToFileURL(f).href, time: new Date().toISOString() }, s.project)
    if (s.lookup) lookSoon(item)
  }
  note(`${files.length} imported`)
}
// A shared picture (share.js): pulled as its sharer got it, then what they wrote by hand, over what the lookups found.
const importShared = async s => {
  const got = s.src ? await save({ src: s.src, page: s.page }) : await pull({ page: s.page, range: s.range }), list = [got].flat()
  await Promise.all([got.looked, ...list.map(i => i.looked)])
  const item = list.find(i => path.basename(i.file) === s.name) ?? list[0], j = sidecar(item)
  if (Object.keys(s.edit).length) { j.edit = { ...j.edit, ...s.edit }; writeJson(item.file + '.json', j) }
  if (s.tags !== undefined) fs.writeFileSync(txt(item.file), s.tags)
  enrich(item).then(e => send('saved', { ...e, replace: true }))
}
// Preview > More > Share: the line on the clipboard; the tags only if they were written by hand. Its source: the picture's own page
// (sites.js), else where it came from: a right-click save's image, or the page it was pulled from (maybe several: the name finds it).
const shareItem = async item => {
  const j = sidecar(item), t = tagsOf(item.file)
  const at = own(j, item.page) ?? { page: item.page, ...item.src !== item.page && { src: item.src }, name: path.basename(item.file) }
  await clipboard.writeText(share.make(at, j.edit, fs.existsSync(txt(item.file)) && t !== tagLine(facts(j).tags) ? t : undefined))
  note('Share line copied')
}
const pull = q => {
  const host = URL.canParse(q.page) ? new URL(q.page).host : q.page, stop = {}
  const t = task(`Waiting to pull from ${host}`, () => { stop.asked = true; stop.child ? kill(stop.child) : t.end() }, q) // still waiting: gone now
  const tick = (n, total) => { t.set(`Pulling from ${host}${total ? ` ${n}/${total}` : n > 1 ? ` ${n}` : ''}`); q.tick?.(n, total) } // no total: a count from 2
  const run = () => { if (stop.asked) throw Object.assign(new Error('Stopped'), { quiet: true }); t.set(`Pulling from ${host}`); return pullOne(q, stop, tick) }
  pulling = pulling.then(run, run)
  return pulling.then(items => { t.end(`${items.length} from ${host}`); return items }, e => { t.end(); throw e })
}
async function pullOne({ page, range: r }, stop = {}, tick = () => {}) { // r: which of the page's pictures (a shared one)
  web(page)
  r ??= range(page)
  // Signed out, E-Hentai hands gallery-dl resamples without a word; with too few GP, gp=stop makes it say so.
  if (EH.test(new URL(page).host) && !readJson(GDL, {}).extractor?.exhentai?.cookies?.ipb_pass_hash) throw new Error('ehentai cookies needed in Sites')
  const d = dir(), s = settings(), gone = ethereal()
  const before = new Set(fs.readdirSync(d))
  // output.stdout: file names in UTF-8 (Windows' code page would garble a Japanese one); output.mode, skip: the lines below as
  // gallery-dl prints them by default, whatever the user's own config of it says; post: the + line below.
  const g = gdl(['--write-metadata', '-o', 'tags=true', '-o', 'gp=stop', '-o', 'output.stdout=utf-8', '-o', 'output.mode=pipe', '-o', 'skip=true',
    '--Print', 'post:+{count|filecount|page_count}',
    '--range', r, '-D', d, '--', page])
  stop.child = g.child
  // gallery-dl's lines as it goes: a file it fetched (its path, its sidecar written by then), one already there (# path), a post
  // (+ how many files it has). A new picture goes into the grid and the lookups as it lands. Out of how many: when the page is one
  // post that says (a gallery, a pixiv work, a tweet), as many as the range takes of them; a page of posts doesn't say.
  const [a, b] = r.split('-'), most = b === undefined ? 1 : b === '' ? Infinity : b - a + 1
  const items = []
  const land = file => {
    const j = readJson(file + '.json', {})
    const item = gone ? { file } : record({ file, src: page, page, time: new Date().toISOString() }, s.project)
    items.push(item)
    if (gone) return
    // The site's own tags caption it right away; a booru match (lookSoon) replaces that.
    if (BOORU.has(j.category) || s.sites.includes(j.category)) fs.writeFileSync(txt(file), tagLine(meta(j).tags))
    if (s.lookup && !BOORU.has(j.category)) lookSoon(item)
  }
  let n = 0, posts = 0, total, rest = '', broke // broke: a file that couldn't be recorded (a locked meta.jsonl): the pull fails, not the app
  g.child.stdout.on('data', c => {
    const lines = (rest + c).split('\n'); rest = lines.pop()
    for (const l of lines.map(l => l.trim()).filter(Boolean)) try {
      if (l.startsWith('+')) total = ++posts === 1 && parseInt(l.slice(1)) ? Math.min(parseInt(l.slice(1)), most) : undefined
      else { if (!l.startsWith('# ')) land(path.join(d, path.basename(l))); tick(++n, total) }
    } catch (e) { broke ??= e }
  })
  const failed = await g.then(() => broke, e => e) // what arrived before a failure or a stop is kept all the same
  for (const f of fs.readdirSync(d)) if (!before.has(f) && f.endsWith('.part')) fs.rmSync(path.join(d, f), { force: true })
  if (gone) for (const i of items) for (const f of [i.file, i.file + '.json']) fs.rmSync(f, { force: true })
  if (looking?.stopped) looking = null // lookups stopped by their ✕ stay so to the end of the pull (lookSoon)
  items.looked = lookups // a shared picture's own fields go on once these are done
  if (stop.asked) throw Object.assign(new Error(items.length ? `Stopped, ${items.length} kept` : 'Stopped'), { quiet: true })
  if (failed && !items.length && /Unsupported URL/.test(failed.message)) throw new Error(`Can't pull from ${new URL(page).host}`) // no site gallery-dl knows
  if (failed) throw items.length ? new Error(`${items.length} kept, then: ${failed.message}`) : failed
  if (!items.length) throw new Error('Nothing new from ' + new URL(page).host)
  return items
}

const list = () => Promise.all(projects().flatMap(p => {
  const f = path.join(dir(p), 'meta.jsonl'), prof = profile()
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => enrich({ ...JSON.parse(l), project: p }, prof)) : []
}))

const newProject = name => { if (/^[\w-]+$/.test(name)) dir(name) }
const txt = f => f.replace(/\.[^.]+$/, '.txt')
// The .txt, its old names read as the current ones while aliases are on (below), so its tags agree with the names above them.
const tagsOf = file => {
  const t = fs.existsSync(txt(file)) ? fs.readFileSync(txt(file), 'utf8') : ''
  return aliasing() ? [...new Set(t.split(',').map(x => x.trim()).filter(Boolean).map(x => {
    const k = x.replace(/ /g, '_'), to = renamed('tags', k)
    return to === k ? x : to.replace(/_/g, ' ')
  }))].join(', ') : t
}
// The head from the sidecar under the current profile, then the .txt.
const getCaption = item => ({ head: caption(profile(), facts(sidecar(item))), tags: tagsOf(item.file) })
// The sidecar is the record; a caption written by hand lives in the .txt only, until the next rebuild from the sidecar.
const setCaption = (item, text) => fs.writeFileSync(txt(item.file), text)
const open = url => shell.openExternal(url)
const capybara = () => { const l = readJson(path.join(__dirname, 'capybara_s_playlist.json'), []); if (l.length) open(l[Math.random() * l.length | 0]) }

// Right-click on a picture. Delete goes to the Recycle Bin, so no confirm.
const remove = async item => {
  for (const f of [item.file, item.file + '.json', txt(item.file)]) if (fs.existsSync(f)) await shell.trashItem(f)
  const m = path.join(dir(item.project), 'meta.jsonl')
  fs.writeFileSync(m, fs.readFileSync(m, 'utf8').split('\n').filter(l => l && JSON.parse(l).file !== item.file).join('\n') + '\n')
  fs.rmSync(thumbPath(item), { force: true })
  send('removed', item.file)
}

// Manual lookup for any picture, including right-click saves that have no sidecar.
// The post as the site has it now: iqdb.org's index lags, and a similarity hit may carry an old tag list.
const gelCreds = () => { const g = readJson(GDL, {}).extractor?.gelbooru ?? {}; return `&api_key=${g['api-key'] ?? ''}&user_id=${g['user-id'] ?? ''}` }
const live = p => {
  if (p.category === 'danbooru') return fetch(`https://danbooru.donmai.us/posts/${p.id}.json`, UA).then(r => r.ok ? r.json() : null, () => null)
  if (p.category === 'gelbooru') return fetch(`https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1&id=${p.id}${gelCreds()}`, UA).then(r => r.json()).then(r => r?.post?.[0] ?? null, () => null)
  return null
}
// A flat tag string becomes tags by kind, so @artist can be written: danbooru answers by post id; gelbooru types a batch of names.
const categorize = async p => {
  p = { ...(await live(p) ?? p), category: p.category }
  if (p.tag_string_general != null) return p
  const tags = words(p.tags), kind = {}
  if (p.category === 'gelbooru') {
    const r = await fetch(`https://gelbooru.com/index.php?page=dapi&s=tag&q=index&json=1&limit=1000&names=${encodeURIComponent(tags.join(' '))}${gelCreds()}`, UA).then(r => r.json(), () => null)
    for (const t of r?.tag ?? []) kind[t.name] = { 1: 'artist', 3: 'copyright', 4: 'character' }[t.type]
  }
  const of = k => tags.filter(t => kind[t] === k).join(' ')
  return { ...p, tag_string_artist: of('artist'), tag_string_copyright: of('copyright'), tag_string_character: of('character'), tag_string_general: tags.filter(t => !kind[t]).join(' ') }
}
const adopt = async (item, j, hit) => {
  j.booru = await categorize(hit)
  delete j.candidates
  writeJson(item.file + '.json', j)
  recaption(item, j)
  enrich(item).then(e => send('saved', { ...e, replace: true }))
}
// A non-booru picture: its booru post by exact ids/md5, then by similarity; close calls become candidates.
const resolve = async (item, j, say) => {
  delete j.candidates
  // Pulled from a booru: its own tags are the caption, nothing to look up (this re-renders it under the current profile).
  if (BOORU.has(j.category)) { recaption(item, j); enrich(item).then(e => send('saved', { ...e, replace: true })); return j }
  const hit = await lookup(j, item.file, say)
  if (hit) { await adopt(item, j, hit); return hit }
  // No booru post: whose the account it came from is, if danbooru knows (facts puts it over the tagger's guess).
  const at = ACCOUNT[j.category]?.(j), who = at && await artistOf(at)
  if (who) j.account = { url: at, artist: who }
  if (!j.candidates && !j.booru && !j.tagger && settings().autotag && tagger.has()) { say?.(tagger.onCpu() ? 'tagging on CPU' : 'tagging with the tagger'); await tagIt(item, j).catch(e => note(`Tagger: ${e.message}`, true)) } // no booru has it
  else if (j.candidates || who) { writeJson(item.file + '.json', j); enrich(item).then(e => send('saved', { ...e, replace: true })) }
  return hit
}
// The account a picture was posted from, as a page of it danbooru's artist entries list (gallery-dl's fields per site).
const ACCOUNT = {
  pixiv: j => j.user?.id && `https://www.pixiv.net/users/${j.user.id}`,
  twitter: j => j.author?.name && `https://x.com/${j.author.name}`,
  fanbox: j => j.creatorId && `https://${j.creatorId}.fanbox.cc`,
  bluesky: j => j.author?.handle && `https://bsky.app/profile/${j.author.handle}`,
  deviantart: j => j.author?.username && `https://www.deviantart.com/${j.author.username}`
}
const relookup = async item => {
  const t = task('Looking up'), j = sidecar(item)
  const hit = await resolve(item, j, s => t.set(`Looking up: ${s}`)).catch(e => { t.end(); note(e.message, true); throw e })
  t.end(hit ? `Tags from ${hit.category}` : j.candidates ? `${j.candidates.length} close matches` : j.tagger ? 'No match, tagged' : canSimilar() ? 'No match' : 'No exact match')
  return hit
}

// The tagger (tagger.js), for pictures no booru has. What it guesses goes into the sidecar (j.tagger) and the caption.
const tagger = Tagger(path.join(HOME, 'models'))
const tagIt = async (item, j = sidecar(item)) => {
  j.tagger = await tagger.guess(item.file)
  delete j.booru // a match the tagger replaces: likely a look-alike variant; Look up finds it again
  delete j.candidates
  writeJson(item.file + '.json', j)
  recaption(item, j)
  enrich(item).then(e => send('saved', { ...e, replace: true }))
}
// A picture pulled from a booru keeps its own tags; a booru match can be replaced (a variant taken for it).
const tag = async items => {
  if (!tagger.has()) return note('Install tagger in Instruments')
  let stopped
  const t = task('Tagging', () => stopped = true)
  let done = 0, kept = 0
  for (const [k, item] of items.entries()) {
    if (stopped) break
    t.set(`Tagging${tagger.onCpu() ? ' on CPU' : ''}${items.length > 1 ? ` ${k + 1}/${items.length}` : ''}`)
    try {
      const j = sidecar(item)
      if (BOORU.has(j.category)) kept++
      else { await tagIt(item, j); done++ }
    } catch (e) { note(`Tagger: ${e.message}`, true) }
  }
  t.end((stopped ? 'Stopped: ' : '') + (items.length > 1 ? `${done} tagged${kept ? `, ${kept} from boorus kept` : ''}` : done ? 'Tagged' : kept ? 'From a booru, kept' : ''))
}
let installing
const installTagger = () => installing ??= (async () => {
  const t = task('Downloading tagger')
  try { await tagger.install(p => t.set(`Downloading tagger ${p}%`)); t.end('Tagger installed') }
  catch (e) { t.end(); note(`Tagger: ${e.message}`, true) }
  finally { installing = null }
})()
// Projects: right-click. Delete goes to the Recycle Bin; the active project falls back to the first one left.
const removeProject = async name => {
  await shell.trashItem(path.join(PROJ, name))
  const s = settings()
  if (s.project === name) { s.project = projects()[0] ?? 'default'; writeJson(SETTINGS, s); dir(s.project) }
  send('projectRemoved', name)
}
const projectMenu = name => void Menu.buildFromTemplate([
  { label: MAC ? 'Open in Finder' : 'Open in Explorer', click: () => shell.openPath(path.join(PROJ, name)) },
  { type: 'separator' },
  { label: 'Delete project', click: () => removeProject(name) }
]).popup({ window: win })
// Export: pictures and their captions into a folder of the user's choosing, which is all a trainer reads. Same names; a clash gets the project as prefix.
// A caption: the profile's head from the sidecar, then the .txt's tags.
const exportItems = async items => {
  const { filePaths: [d] } = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
  if (!d) return
  let captions = 0
  const name = settings().profile, prof = profile()
  for (const it of items) {
    let to = path.join(d, path.basename(it.file))
    if (fs.existsSync(to)) to = path.join(d, it.project + '_' + path.basename(it.file))
    fs.copyFileSync(it.file, to)
    const text = exported(name, caption(prof, facts(sidecar(it)), tagsOf(it.file)))
    if (text) { fs.writeFileSync(txt(to), text); captions++ }
  }
  note(`${items.length} pictures, ${captions} captions → ${path.basename(d)}`)
  shell.showItemInFolder(d)
}
// Several at once, one result at the end. items may grow as it goes (lookSoon).
const lookupAll = async items => {
  let stopped
  const t = task(`Looking up 0/${items.length}`, () => stopped = true)
  let matched = 0, unsure = 0, tagged = 0
  for (const [k, item] of items.entries()) {
    if (stopped) { items.stopped = true; items = items.slice(0, k); break } // stopped: the array lookSoon keeps adding to
    try {
      const j = sidecar(item)
      if (await resolve(item, j, s => t.set(`Looking up ${k + 1}/${items.length}: ${s}`))) matched++
      else if (j.candidates) unsure++
      else if (j.tagger) tagged++
    } catch (e) { note(e.message, true) }
  }
  t.end(`${stopped ? 'Stopped: ' : ''}${matched} matched, ${unsure} to pick, ${tagged ? `${tagged} tagged, ` : ''}${items.length - matched - unsure - tagged} none`)
}
// Quality, series, characters or artists written by hand (right-click > Edit), for the tagger's misses and mistakes: one field of several
// pictures, overwritten whatever each had. Kept through lookups and tagger runs; '' leaves the field empty.
const setField = (items, field, text) => {
  const v = text.split(',').map(t => t.trim().replace(/^@/, '').replace(/\s+/g, '_')).filter(Boolean).join(' ')
  for (const item of items) {
    const j = sidecar(item)
    ;(j.edit ??= {})[field] = v
    writeJson(item.file + '.json', j)
    enrich(item).then(e => send('saved', { ...e, replace: true }))
  }
}
// Pulled pictures, looked up one at a time as they land (IQDB uploads take seconds each): one joins the lookups under way, its
// count growing, or starts them. Stopped by their ✕, the rest of the pull isn't looked up either: it joins the stopped ones.
let looking, lookups
const lookSoon = item => { if (looking) return looking.push(item); looking = [item]; lookups = lookupAll(looking).finally(() => looking = looking.stopped ? looking : null) }
// The user picked one of the close matches.
const pick = (item, i) => { const j = sidecar(item); adopt(item, j, j.candidates[i].post) }
// A site's search for a tag, in the browser: the search box's site scope and the tag menu.
const search = (site, tag) => shell.openExternal(SEARCH[site](tag))

// A caption tag: this library, the search engine (Settings > General), More for the other sites in use.
const tagMenu = tag => {
  const s = settings()
  const more = s.sites.filter(x => SEARCH[x] && x !== s.engine).map(x => ({ label: x, click: () => search(x, tag) }))
  Menu.buildFromTemplate([
    { label: 'Search local', click: () => send('search', tag) },
    { label: `Search ${s.engine}`, click: () => search(s.engine, tag) },
    ...(more.length ? [{ label: 'More', submenu: more }] : [])
  ]).popup({ window: win })
}

// Right-click, on one picture or the selection it is in (as Explorer does): everything acts on all of them. Edit asks the page
// for the text. void: popup() answers with the window it opened on, which the IPC reply can't carry.
const menu = items => void Menu.buildFromTemplate([
  { label: 'Open', submenu: [
    { label: MAC ? 'In Finder' : 'In Explorer', click: () => new Map(items.map(i => [path.dirname(i.file), i.file])).forEach(f => shell.showItemInFolder(f)) },
    { label: 'Original site', click: () => new Set(items.map(i => i.page)).forEach(u => shell.openExternal(u)) },
    ...new Set(items.map(i => i.project)).size === 1 ? [{ label: 'Project', click: () => send('openProject', items[0].project) }] : []
  ] },
  { label: 'Look up tags', click: () => items.length > 1 ? lookupAll(items) : relookup(items[0]) },
  { label: 'Run the tagger', click: () => tag(items) },
  { label: 'Edit', submenu: [['quality', 'Quality'], ['copyright', 'Series'], ['character', 'Characters'], ['artist', 'Artists']].map(([field, label]) => ({ label: label + '…',
    click: () => send('edit', { items, field, label, ...field === 'quality' && { options: profile().qualities.split(',').map(t => t.trim()).filter(Boolean) } }) })) }, // quality: the profile's words to pick from
  { label: 'Export', click: () => exportItems(items) },
  { type: 'separator' },
  { label: 'Delete', click: async () => { for (const i of items) await remove(i) } }
]).popup({ window: win })

const getCreds = () => { const e = readJson(GDL, {}).extractor ?? {}; return { ...e, ehentai: e.exhentai } }

const setCred = (site, key, value) => {
  const c = readJson(GDL, {})
  const ks = key.split('.'), last = ks.pop() // cookies.ipb_member_id: inside 'cookies'
  ks.reduce((o, k) => o[k] ??= {}, (c.extractor ??= {})[gdlName(site)] ??= {})[last] = value
  fs.mkdirSync(path.dirname(GDL), { recursive: true })
  writeJson(GDL, c)
}

// The Chrome extension ships inside the app (extraResources when packaged) and is exported for "Load unpacked".
const EXT = app.isPackaged ? path.join(process.resourcesPath, 'extension') : path.join(__dirname, 'extension')
const { checkUpdate, update } = require('./update')({ task, note, busy: () => running.size })

const instruments = async () => {
  const v = await gdl(['--version']).then(v => v.trim(), () => null)
  return {
    'gallery-dl': { status: v, action: v ? 'Update' : 'Install' },
    extension: { status: `${readJson(path.join(EXT, 'manifest.json'), {}).version ?? '?'}, port ${PORT}${listening === false ? ' taken' : ''}`, action: 'Export' },
    tagger: installing ? { status: 'downloading…', action: 'Install' } : { action: tagger.has() ? 'Remove' : 'Install' }
  }
}

// The instruments (instruments/README.md): each folder's instrument.json, and its page.js and page.css as the page links them.
const INSTR = path.join(__dirname, 'instruments')
const instrumentList = () => fs.readdirSync(INSTR, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => ({
  ...readJson(path.join(INSTR, d.name, 'instrument.json'), {}), name: d.name,
  files: ['page.css', 'page.js'].filter(f => fs.existsSync(path.join(INSTR, d.name, f))).map(f => `instruments/${d.name}/${f}`) }))

const exportExtension = async () => {
  const { filePaths: [d] } = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
  if (!d) return
  const out = path.join(d, 'epiphany-extension')
  fs.cpSync(EXT, out, { recursive: true })
  shell.showItemInFolder(out)
  note('Load it unpacked from chrome://extensions')
}

const installGdl = async () => {
  const was = await gdl(['--version']).then(v => v.trim(), () => null), t = task(was ? 'Updating gallery-dl' : 'Downloading gallery-dl')
  try { const v = await gallery.install(); t.end(v === was ? 'gallery-dl up to date' : `gallery-dl ${v} installed`); return v } catch (e) { t.end(); note(e.message, true) }
}

const HANDLERS = { list, projects, newProject, getSettings: settings, setSettings: v => { writeJson(SETTINGS, v); if (!v.aliases !== !aliasing()) useAliases(v.aliases) }, profiles: () => PROFILES, getCaption, setCaption, setField, open, editTemplate, templateInfo, resetTemplate,
  capybara, lookup: relookup, lookupAll, pick, projectMenu, searchSites: () => Object.keys(SEARCH), search, tagMenu, menu, quoteSources: () => quotes.sources, quote: () => quotes.quote(settings().quote), getCreds, setCred, oauth, stopTask, paste, importFiles, share: shareItem,
  checkUpdate, update, instruments, instrumentList, exportExtension, installGdl, export: exportItems,
  safe: () => app.commandLine.hasSwitch('safe'), // launched with -safe (or --safe)
  tagWiki, tagsFor, tag, installTagger, removeTagger: tagger.remove, devtools: () => win.webContents.toggleDevTools(), restart: () => { app.relaunch(); app.quitting = true; app.quit() } } // debug mode; quit, not exit, so the window's bounds are saved
for (const [k, f] of Object.entries(HANDLERS)) ipcMain.handle(k, (_, ...a) => f(...a))
ipcMain.on('theme', (_, t, bar) => { nativeTheme.themeSource = t; if (!MAC) win?.setTitleBarOverlay(bar) }) // native bits (select popups, title bar) follow nativeTheme, not our CSS

// Quitting from the tray with work in the task line asks first (updates and restarts have set app.quitting and go).
let asking
app.on('before-quit', e => {
  if (app.quitting || !running.size) return void (app.quitting = true)
  e.preventDefault()
  if (asking) return
  asking = true
  win.show()
  const detail = [...running.values()].map(t => t.text).join('\n')
  dialog.showMessageBox(win, { type: 'question', message: 'Still working', detail, buttons: ['Quit anyway', 'Keep running'], defaultId: 1, cancelId: 1 })
    .then(({ response }) => { asking = false; if (response === 0) { app.quitting = true; app.quit() } })
})
let tray, listening // the extension's port: true once it listens, false when taken (Instruments says which)

app.whenReady().then(() => {
  dir()
  app.dock?.setIcon(icon('icon-mac.png')) // macOS: from source the Dock would show Electron's
  if (!MAC) { // macOS: the Dock brings the window back and quits
    tray = new Tray(icon('icon.png').resize({ width: 32 }))
    tray.setToolTip('Epiphany')
    tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Quit', click: () => app.quit() }]))
    tray.on('click', () => { win.show(); win.focus() })
  }
  http.createServer((req, res) => {
    // Only the extension: web pages can POST here too (text/plain skips preflight), but can't fake Origin.
    if (!req.headers.origin?.startsWith('chrome-extension://')) return res.writeHead(403).end()
    if (req.method !== 'POST') return res.writeHead(404).end()
    let body = ''
    req.on('data', c => body += c)
    req.on('end', () => {
      let q
      try { q = JSON.parse(body) } catch { return res.writeHead(400).end() }
      if (q.stop) { stopRequest(q.stop); return res.end('{}') } // the extension's ✕: as the task line's
      // The answer in lines as it goes: how far a pull is ({ n, total }), then { got } pictures, or { why } not.
      const line = o => res.write(JSON.stringify(o) + '\n')
      res.writeHead(200).flushHeaders()
      ;(q.src ? save(q) : pull({ page: q.page, anim: q.anim, id: q.id, tick: (n, total) => line({ n, total }) })).then(
        r => res.end(JSON.stringify({ got: [r].flat().length }) + '\n'),
        err => { console.error(err.message); note(err.message, !err.quiet); res.end(JSON.stringify({ why: err.message }) + '\n') }
      )
    })
  }).on('listening', () => listening = true).on('error', () => { // taken, or reserved by Windows (its ranges move): the app runs, only the extension can't reach it
    listening = false
    const say = () => note(`Extension can't connect: port ${PORT}`, true)
    win.webContents.isLoading() ? win.webContents.once('did-finish-load', say) : say()
  }).listen(PORT, '127.0.0.1')
  createWindow()
  pullWikis()
  useAliases(settings().aliases)
  app.on('activate', () => { win.show(); win.focus() }) // macOS: the Dock icon brings back the parked window
})

