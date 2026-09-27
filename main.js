const { app, BrowserWindow, ipcMain, Menu, shell, nativeImage, dialog, nativeTheme, Tray, net } = require('electron')
const http = require('http')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { execFile, spawn } = require('child_process')
const crypto = require('crypto')
const { PROFILES, caption } = require('./profiles')
const Tagger = require('./tagger')
const { autoUpdater } = require('electron-updater')

const PORT = Number(process.env.EPIPHANY_PORT) || 7676 // 7777 collides with AIRI, 67xx is a Windows reserved range; env override keeps test runs off the real app
const HOME = process.env.EPIPHANY_HOME || (app.isPackaged ? app.getPath('userData') : __dirname)
const SETTINGS = path.join(HOME, 'settings.json')
const WIN = path.join(HOME, 'window.json') // last window bounds; separate file so renderer settings saves never clobber it
const DEFAULTS = { project: 'default', quote: 'advice', lookup: true, sites: ['danbooru', 'gelbooru'], profile: 'anima', overrides: {}, accept: 90, autotag: true }
let win
Menu.setApplicationMenu(null)
if (!app.requestSingleInstanceLock()) app.exit() // quit() is async and whenReady would still open a window; a second launch (tray-parked app, double-clicked exe) just raises the first
app.on('second-instance', () => { win?.show(); win?.focus() })

const readJson = (f, fallback) => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : fallback
const writeJson = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 2))
const settings = () => ({ ...DEFAULTS, ...readJson(SETTINGS, {}) })
// Debug mode opens a DevTools port at start, so the running app can be driven from outside (Claude's tests) without a relaunch.
if (settings().debug) app.commandLine.appendSwitch('remote-debugging-port', '9231')
// A profile's caption template can live in captions/<profile>.md, edited in the user's editor: one piece per line, <!-- notes --> ignored.
const templateFile = () => path.join(HOME, 'captions', settings().profile + '.md')
const template = () => fs.existsSync(templateFile()) ? fs.readFileSync(templateFile(), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/\r?\n/g, ',') : null
const profile = () => { const s = settings(), t = template(); return { ...PROFILES[s.profile], ...s.overrides, ...(t != null && { caption: t }) } }
const editTemplate = () => {
  const f = templateFile()
  if (!fs.existsSync(f)) {
    fs.mkdirSync(path.dirname(f), { recursive: true })
    const note = `<!-- Caption template for the "${settings().profile}" profile. One piece per line. {{tags}} {{artist}} {{character}} {{copyright}} {{rating}} {{score}} are filled in per picture. Delete this file (or Reset in Settings) to go back to the default. -->`
    fs.writeFileSync(f, [note, ...profile().caption.split(',').map(x => x.trim())].join('\n') + '\n')
  }
  return shell.openPath(f)
}
const templateInfo = () => ({ text: profile().caption.split(',').map(x => x.trim()).filter(Boolean).join(', '), custom: template() != null })
const resetTemplate = () => fs.existsSync(templateFile()) && shell.trashItem(templateFile())
const GDL = path.join(process.env.APPDATA, 'gallery-dl', 'config.json') // site credentials live here, where gallery-dl reads them
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
  return r.startsWith('safe') || (!four && r === 's') ? 'g' : (r[0] ?? '')
}

// Where a picture's tags come from: a booru match looked up for a non-booru source, the booru it was pulled from, or the tagger's guess.
const source = j => j.booru ?? (j.tagger && !BOORU.has(j.category) ? tagger.post(j.tagger) : j)
// Its caption fields: the source's, with series, characters and artists written by hand over them (j.edit, booru-style strings).
const facts = j => ({ ...meta(source(j)), ...Object.fromEntries(Object.entries(j.edit ?? {}).map(([k, v]) => [k, words(v).join(k === 'artist' ? ', @' : ', ')])) })
const recaption = (item, j) => fs.writeFileSync(txt(item.file), caption(profile(), facts(j)))
const info = item => {
  const j = sidecar(item, null)
  if (!j) return { site: new URL(item.page).host, ai: false, rating: '', tagged: 'none' }
  const b = source(j)
  const tags = [b.tag_string, b.tags, b.tag_string_meta, b.tags_metadata].flatMap(words)
  // booru: booru-vocabulary tags (pulled from one, or matched); unsure: close matches await a pick; tagger: no booru has it, the
  // tagger guessed; none: no tags.
  const tagged = j.tagged ?? (j.booru || BOORU.has(j.category) ? 'booru' : j.candidates ? 'unsure' : j.tagger ? 'tagger' : 'none') // j.tagged: the caption was emptied by hand
  // Each candidate with the tags only it has, so look-alike variants can be told apart.
  const sets = j.candidates?.map(c => new Set(words(c.post.tag_string_general)))
  const candidates = j.candidates?.map((c, i) => ({ score: c.score, url: c.thumb ? pathToFileURL(c.thumb).href : c.post.preview_file_url, caption: caption(profile(), meta(c.post)), plus: [...sets[i]].filter(t => !sets.some((o, k) => k !== i && o.has(t))) }))
  // The post the caption's tags came from: the matched one for lookups, the pulled one for booru pulls (a tag search's page URL isn't it).
  const from = j.booru ? postUrl(j.booru) : BOORU.has(j.category) ? postUrl(j) : undefined
  const m = facts(j)
  return { site: j.category, ai: tags.some(t => /^ai[-_]generated$/.test(t)), rating: rating(b), artist: m.artist, character: m.character, copyright: m.copyright, tags: m.tags, tagged, candidates, from }
}

// Grid thumbnails live beside the dataset, never inside it. OS thumbnailer, cached as JPEG.
const thumbs = p => { const d = path.join(PROJ, p, 'thumbs'); fs.mkdirSync(d, { recursive: true }); return d }
const thumbPath = item => path.join(thumbs(item.project), path.basename(item.file) + '.jpg')

const thumb = async item => {
  const t = thumbPath(item)
  if (!fs.existsSync(t)) {
    try { fs.writeFileSync(t, (await nativeImage.createThumbnailFromPath(item.file, { width: 400, height: 400 })).toJPEG(82)) }
    catch { return item.url }
  }
  return pathToFileURL(t).href
}

// A picture's sidecar; a right-click save has none until a lookup writes one, and one cut off mid-write reads as none (the
// library still loads; the next lookup writes it afresh).
const sidecar = (item, none = { category: new URL(item.page).host, page: item.page }) => { try { return readJson(item.file + '.json', none) } catch { return none } }
const enrich = async item => { const e = withUrl({ ...item, ...info(item) }); e.thumb = await thumb(e); return e }

const record = item => {
  fs.appendFileSync(path.join(dir(), 'meta.jsonl'), JSON.stringify(item) + '\n')
  item = { ...item, project: settings().project }
  enrich(item).then(e => send('saved', e))
  return item
}

const send = (ch, ...a) => win?.webContents.send(ch, ...a)
// What the app is doing, in the header's task line (tasks.js). task(): shown while it runs, its line updated as it goes, ending
// with a result; note(): a result or error on its own. A result stays there a few seconds.
const running = new Map()
let taskN = 0
const task = text => {
  const id = ++taskN, show = () => send('tasks', [...running.values()])
  running.set(id, text); show()
  return { set: t => { running.set(id, t); show() }, end: result => { running.delete(id); show(); if (result) note(result) } }
}
const note = (text, error) => send('note', { text, error: !!error })

const run = (cmd, args) => new Promise((res, rej) =>
  execFile(cmd, args, { maxBuffer: 1e7 }, (e, out, err) => e ? rej(new Error(err || e.message)) : res(out)))

// gallery-dl: the standalone exe we downloaded if present, else whatever Python has (dev machines).
const GDL_EXE = path.join(HOME, 'bin', 'gallery-dl.exe')
const gdlCmd = () => fs.existsSync(GDL_EXE) ? [GDL_EXE, []] : ['python', ['-m', 'gallery_dl']]
const gdl = args => { const [c, a] = gdlCmd(); return run(c, [...a, ...args]) }

function createWindow() {
  const saved = readJson(WIN, {})
  win = new BrowserWindow({
    width: 1000,
    height: 700,
    ...saved.bounds,
    show: false,
    titleBarStyle: 'hidden', // the renderer's header is the title bar; Windows keeps only its caption buttons
    titleBarOverlay: { height: 56 },
    icon: path.join(__dirname, 'build', 'icon.png'),
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
const web = u => { if (!/^https?:$/.test(new URL(u).protocol)) throw new Error(`Not a web URL: ${u}`) }

// Right-click: one image URL, fetched directly.
async function save({ src, page }) {
  web(src); web(page)
  const res = await fetch(src, { headers: { Referer: page, 'User-Agent': 'Mozilla/5.0 Epiphany/0.1' } })
  if (!res.ok) throw new Error(`${res.status} ${src}`)
  let name = decodeURIComponent(path.basename(new URL(src).pathname)).replace(/[<>:"/\\|?*]/g, '_') || 'image'
  if (!path.extname(name)) name += '.' + (res.headers.get('content-type')?.split('/')[1]?.split(';')[0] || 'bin')
  if (fs.existsSync(path.join(dir(), name))) name = `${Date.now()}_${name}`
  const file = path.join(dir(), name)
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  const item = record({ file, src, page, time: new Date().toISOString() })
  if (settings().lookup) relookup(item).catch(() => {}) // same matching as a pull, after the reply; it reports its own errors
  return item
}

// gallery-dl metadata -> caption fields.
const first = (j, ...ks) => words(ks.map(k => j[k]).find(v => v && v.length))

const meta = j => ({
  tags: first(j, 'tag_string_general', 'tags_general', 'tags').join(', '),
  artist: first(j, 'tag_string_artist', 'tags_artist').join(', @'), // ponytail: "a, @b" so "@{{artist}}" reads right
  character: first(j, 'tag_string_character', 'tags_character').join(', '),
  copyright: first(j, 'tag_string_copyright', 'tags_copyright').join(', '),
  rating: rating(j),
  score: j.score ?? ''
})

// Non-booru sources (pixiv, twitter...) carry no booru tags. Ask danbooru, then gelbooru, for the same picture.
const BOORU = new Set(['danbooru', 'gelbooru', 'safebooru', 'yandere', 'konachan', 'sankaku', 'e621', 'rule34'])
const POST = {
  danbooru: id => `https://danbooru.donmai.us/posts/${id}`,
  gelbooru: id => `https://gelbooru.com/index.php?page=post&s=view&id=${id}`,
  safebooru: id => `https://safebooru.org/index.php?page=post&s=view&id=${id}`,
  rule34: id => `https://rule34.xxx/index.php?page=post&s=view&id=${id}`,
  yandere: id => `https://yande.re/post/show/${id}`,
  konachan: id => `https://konachan.com/post/show/${id}`,
  sankaku: id => `https://chan.sankakucomplex.com/post/show/${id}`,
  e621: id => `https://e621.net/posts/${id}`
}
const postUrl = p => POST[p.category]?.(p.id)

// Similarity search per site, each answering with whole posts. Danbooru's IQDB needs an account (anonymous uploads are denied;
// API-key auth also skips Rails CSRF; net.fetch because Cloudflare accepts Chromium's TLS, not Node's). Moebooru's post/similar is open.
const moe = (base, form) => fetch(base + '/post/similar.json', { method: 'POST', body: form('file'), signal: AbortSignal.timeout(30000), ...UA })
  .then(r => r.ok ? r.json() : {}).catch(() => ({})).then(j => (j.posts ?? []).map(p => ({ score: p.similarity, post: p }))) // catch after the body: a timeout can land mid-read
const SIMILAR = {
  danbooru: form => !danAuth() ? [] : net.fetch('https://danbooru.donmai.us/iqdb_queries.json', { method: 'POST', body: form('search[file]'), signal: AbortSignal.timeout(30000), headers: { Authorization: danAuth() } })
    .then(r => r.ok ? r.json() : (note(`IQDB: ${r.status}`, true), [])).catch(e => (note(`IQDB: ${e.message}`, true), [])).then(c => c.filter(x => x.post)),
  yandere: form => moe('https://yande.re', form),
  konachan: form => moe('https://konachan.com', form)
}
// iqdb.org: one upload covers every booru it indexes, and the tags ride along in each thumbnail's alt text. It is HTML, but the
// template has not changed since 2008; if it ever does, the regex finds nothing and we get no candidates, never wrong ones.
const IQDB_HOST = { 'danbooru.donmai.us': 'danbooru', 'gelbooru.com': 'gelbooru', 'yande.re': 'yandere', 'konachan.com': 'konachan',
  'chan.sankakucomplex.com': 'sankaku', 'anime-pictures.net': 'animepictures', 'www.zerochan.net': 'zerochan' }
const IQDB_ONLY = ['gelbooru', 'sankaku', 'zerochan', 'animepictures'] // enabling one of these is what turns iqdb.org on
const iqdbOrg = form => fetch('https://iqdb.org/', { method: 'POST', body: form('file'), signal: AbortSignal.timeout(30000), ...UA })
  .then(r => r.ok ? r.text() : '').catch(() => '').then(html => html.split('<table>').flatMap(t => {
    const m = t.match(/href="\/\/([^/"]+)([^"]*)"[^>]*>\s*<img src='([^']+)' alt="Rating: (\w+)(?: Score: (\S+))? Tags: ([^"]*)"[\s\S]*?(\d+)% similarity/)
    const category = m && IQDB_HOST[m[1]], id = m && m[2].match(/\d+(?!.*\d)/)?.[0]
    return category && id ? [{ score: Number(m[7]), post: { id: Number(id), category, tags: m[6], rating: m[4], score: Number(m[5]) || '', preview_url: 'https://iqdb.org' + m[3] } }] : []
  }))
const canSimilar = () => settings().sites.some(site => (SIMILAR[site] && (site !== 'danbooru' || danAuth())) || IQDB_ONLY.includes(site))
const danAuth = () => { const d = readJson(GDL, {}).extractor?.danbooru ?? {}; return d.username && d['api-key'] ? 'Basic ' + Buffer.from(`${d.username}:${d['api-key']}`).toString('base64') : null }
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
  // Exact bytes first, then the source id, then similarity.
  say('same file on danbooru')
  let hit = await dan(`md5:${md5}`)
  if (!hit) { say('same file on gelbooru'); hit = await gel() }
  if (!hit && key) { say('source on danbooru'); hit = await dan(key, true) }
  if (!hit) {
    // Same picture, different bytes (watermark, rescale, scan): ask every enabled site that can search by similarity.
    const bytes = fs.readFileSync(file)
    const form = field => { const d = new FormData(); d.append(field, new Blob([bytes]), path.basename(file)); return d }
    const found = []
    const sites = settings().sites
    for (const site of sites) if (SIMILAR[site]) { say(`similar on ${site}`); for (const c of await SIMILAR[site](form)) found.push({ score: Math.round(c.score), post: { ...c.post, category: site } }) }
    if (sites.some(s => IQDB_ONLY.includes(s))) { say('similar on iqdb.org'); for (const c of await iqdbOrg(form)) if (!found.some(f => f.post.category === c.post.category && f.post.id === c.post.id)) found.push(c) }
    const near = found.filter(x => x.score >= 70).sort((a, b) => b.score - a.score).slice(0, 4)
    // Settings decide how sure a similarity match must be to skip the human; exact id/md5 hits above never ask.
    if (near.length && near[0].score >= settings().accept && (near.length === 1 || near[0].score - near[1].score >= 15)) hit = near[0].post
    else if (near.length) {
      j.candidates = near
      // Their preview thumbnails, fetched here (Chromium's stack, proven against the CDN) and kept beside our own thumbs.
      const p = path.basename(path.dirname(path.dirname(file)))
      for (const c of near) {
        const t = path.join(thumbs(p), `cand-${c.post.category}-${c.post.id}.jpg`) // ids collide across sites
        if (!fs.existsSync(t)) await net.fetch(c.post.preview_file_url ?? c.post.preview_url).then(async r => r.ok && fs.writeFileSync(t, Buffer.from(await r.arrayBuffer()))).catch(() => {})
        if (fs.existsSync(t)) c.thumb = t
      }
    }
  }
  return hit
}

// Toolbar button: a page URL, handed to gallery-dl. A pull takes the new sidecars in the dataset as its own, so pulls go one at a
// time (two at once would each take the other's), and a picture already recorded is skipped (a right-click save's lookup writes
// its sidecar mid-pull).
let pulling = Promise.resolve()
const pull = q => {
  const host = URL.canParse(q.page) ? new URL(q.page).host : q.page, t = task(`Waiting to pull from ${host}`)
  const run = () => { t.set(`Pulling from ${host}`); return pullOne(q) }
  pulling = pulling.then(run, run)
  return pulling.then(items => { t.end(`${items.length} from ${host}`); return items }, e => { t.end(); throw e })
}
async function pullOne({ page }) {
  web(page)
  const d = dir()
  const before = new Set(fs.readdirSync(d))
  // ponytail: --range caps a search page at 50 posts; make it a profile field if you want whole searches
  await gdl(['--write-metadata', '-o', 'tags=true', '--range', '1-50', '-D', d, '--', page])
  const s = settings(), prof = profile(), m = path.join(d, 'meta.jsonl')
  const known = new Set(fs.existsSync(m) ? fs.readFileSync(m, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).file) : [])
  const items = [], later = []
  for (const f of fs.readdirSync(d)) {
    if (before.has(f) || !f.endsWith('.json')) continue
    const img = f.slice(0, -5)
    if (!fs.existsSync(path.join(d, img)) || known.has(path.join(d, img))) continue
    const j = readJson(path.join(d, f), {})
    const item = record({ file: path.join(d, img), src: page, page, time: new Date().toISOString() })
    items.push(item)
    // The site's own tags caption it right away; a booru match (below) replaces that.
    if (BOORU.has(j.category) || s.sites.includes(j.category)) fs.writeFileSync(txt(item.file), caption(prof, meta(j)))
    if (s.lookup && !BOORU.has(j.category)) later.push(item)
  }
  if (!items.length) throw new Error('Nothing new from ' + new URL(page).host)
  // After the grid has them, and after the extension gets its answer: IQDB uploads take seconds each.
  if (later.length) lookupAll(later)
  return items
}

const list = () => Promise.all(projects().flatMap(p => {
  const f = path.join(dir(p), 'meta.jsonl')
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => enrich({ ...JSON.parse(l), project: p })) : []
}))

const newProject = name => { if (/^[\w-]+$/.test(name)) dir(name) }
const txt = f => f.replace(/\.[^.]+$/, '.txt')
const getCaption = file => fs.existsSync(txt(file)) ? fs.readFileSync(txt(file), 'utf8') : ''
// A caption emptied by hand makes the picture untagged, whatever its sidecar says, so Look up / Tag show again; anything else
// written there lifts that.
const setCaption = (item, text) => {
  fs.writeFileSync(txt(item.file), text)
  const j = sidecar(item, null), empty = !text.split(',').some(t => t.trim())
  if (!j || !!j.tagged === empty) return
  if (empty) j.tagged = 'none'; else delete j.tagged
  writeJson(item.file + '.json', j)
  enrich(item).then(e => send('saved', { ...e, replace: true }))
}
const open = url => shell.openExternal(url)

// Right-click on a picture. Delete goes to the Recycle Bin, so no confirm.
const remove = async item => {
  for (const f of [item.file, item.file + '.json', txt(item.file)]) if (fs.existsSync(f)) await shell.trashItem(f)
  const m = path.join(dir(item.project), 'meta.jsonl')
  fs.writeFileSync(m, fs.readFileSync(m, 'utf8').split('\n').filter(l => l && JSON.parse(l).file !== item.file).join('\n') + '\n')
  fs.rmSync(thumbPath(item), { force: true })
  send('removed', item.file)
}

// Manual lookup for any picture, including right-click saves that have no sidecar.
// A flat tag string becomes tags by kind, so @artist can be written: danbooru answers by post id; gelbooru types a batch of names;
// the moebooru sites publish their whole artist list, fetched once a month into HOME/cache.
const MOE = { yandere: 'https://yande.re', konachan: 'https://konachan.com' }
const artists = async site => {
  const f = path.join(HOME, 'cache', site + '-artists.json')
  if (!fs.existsSync(f) || Date.now() - fs.statSync(f).mtimeMs > 30 * 864e5) {
    const names = await fetch(MOE[site] + '/tag.json?type=1&limit=0', UA).then(r => r.json()).then(l => l.map(t => t.name), () => null)
    if (names) { fs.mkdirSync(path.dirname(f), { recursive: true }); writeJson(f, names) }
  }
  return new Set(readJson(f, []))
}
// The post as the site has it now: iqdb.org's index lags, and a similarity hit may carry an old tag list.
const UA = { headers: { 'User-Agent': 'Epiphany/0.1' } }

// A tag's explanation: the first paragraph of its danbooru wiki, DText links and markup turned to plain text. Kept in
// HOME/cache for good, a tag without a wiki as null; a failed request isn't kept, so it is asked again next time.
const WIKI = path.join(HOME, 'cache', 'tag-wiki.json')
let wiki
const saveWiki = () => { fs.mkdirSync(path.dirname(WIKI), { recursive: true }); fs.writeFileSync(WIKI, JSON.stringify(wiki)) } // ~3MB: no indent
const plain = body => body.split(/\r?\n\s*\r?\n/).map(p => p.trim()).find(p => p && !/^(h\d\.|\*|!post|\[(table|expand|quote|spoiler))/i.test(p))
  ?.replace(/\[\[([^\]|]+)\|\]\]/g, (_, t) => t.replace(/\s*\(.*\)$/, '')) // [[poster (object)|]]: the pipe trick drops the qualifier
  .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, '$1').replace(/\[\[([^\]]+)\]\]/g, '$1')
  .replace(/"([^"]+)":\[[^\]]*\]/g, '$1').replace(/"([^"]+)":\S+/g, '$1')
  .replace(/\[\/?[a-z]+(=[^\]]*)?\]/gi, '').replace(/\s+/g, ' ').trim() || null
// First start pulls the lot: every general tag on 100+ danbooru posts (~24k; 25 requests, ~17MB down, ~4MB kept, 97% of a
// sample library's tags). Anything rarer is asked for when it comes up. '' (no tag has that name) marks the pull done.
const pullWikis = async () => {
  wiki ??= readJson(WIKI, {})
  if (wiki['']) return
  for (let page = 1; ; page++) {
    const l = await fetch(`https://danbooru.donmai.us/wiki_pages.json?search[tag][category]=0&search[tag][post_count]=>=100&search[is_deleted]=false&limit=1000&only=title,body&page=${page}`, { signal: AbortSignal.timeout(30000), ...UA }).then(r => r.ok ? r.json() : null).catch(() => null)
    if (!l) return // offline or refused: the next start tries again
    for (const w of l) wiki[w.title] ??= plain(w.body ?? '')
    if (l.length < 1000) break
  }
  wiki[''] = new Date().toISOString()
  saveWiki()
}
const tagWiki = async tag => {
  wiki ??= readJson(WIKI, {})
  if (tag in wiki) return wiki[tag]
  const r = await fetch(`https://danbooru.donmai.us/wiki_pages/${encodeURIComponent(tag)}.json`, { signal: AbortSignal.timeout(8000), ...UA }).catch(() => null)
  if (!r || (!r.ok && r.status !== 404)) return null
  const j = r.ok && await r.json().catch(() => null)
  if (r.ok && !j) return null // cut off mid-read: asked again next time
  wiki[tag] = j ? plain(j.body ?? '') : null
  saveWiki()
  return wiki[tag]
}
const gelCreds = () => { const g = readJson(GDL, {}).extractor?.gelbooru ?? {}; return `&api_key=${g['api-key'] ?? ''}&user_id=${g['user-id'] ?? ''}` }
const live = p => {
  if (p.category === 'danbooru') return fetch(`https://danbooru.donmai.us/posts/${p.id}.json`, UA).then(r => r.ok ? r.json() : null, () => null)
  if (p.category === 'gelbooru') return fetch(`https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1&id=${p.id}${gelCreds()}`, UA).then(r => r.json()).then(r => r?.post?.[0] ?? null, () => null)
  if (MOE[p.category]) return fetch(`${MOE[p.category]}/post.json?tags=id:${p.id}`, UA).then(r => r.json()).then(r => r?.[0] ?? null, () => null)
  return null
}
const categorize = async p => {
  p = { ...(await live(p) ?? p), category: p.category }
  if (p.tag_string_general != null) return p
  const tags = words(p.tags), kind = {}
  if (p.category === 'gelbooru') {
    const r = await fetch(`https://gelbooru.com/index.php?page=dapi&s=tag&q=index&json=1&limit=1000&names=${encodeURIComponent(tags.join(' '))}${gelCreds()}`, UA).then(r => r.json(), () => null)
    for (const t of r?.tag ?? []) kind[t.name] = { 1: 'artist', 3: 'copyright', 4: 'character' }[t.type]
  } else if (MOE[p.category]) { const a = await artists(p.category); for (const t of tags) if (a.has(t)) kind[t] = 'artist' }
  const of = k => tags.filter(t => kind[t] === k).join(' ')
  return { ...p, tag_string_artist: of('artist'), tag_string_copyright: of('copyright'), tag_string_character: of('character'), tag_string_general: tags.filter(t => !kind[t]).join(' ') }
}
const adopt = async (item, j, hit) => {
  j.booru = await categorize(hit)
  delete j.candidates
  delete j.tagged
  writeJson(item.file + '.json', j)
  recaption(item, j)
  enrich(item).then(e => send('saved', { ...e, replace: true }))
}
// A non-booru picture: its booru post by exact ids/md5, then by similarity; close calls become candidates.
const resolve = async (item, j, say) => {
  delete j.candidates
  // Pulled from a booru: its own tags are the caption, nothing to look up (this re-renders it under the current profile).
  if (BOORU.has(j.category)) { if (j.tagged) { delete j.tagged; writeJson(item.file + '.json', j) }; recaption(item, j); enrich(item).then(e => send('saved', { ...e, replace: true })); return j }
  const hit = await lookup(j, item.file, say)
  if (hit) await adopt(item, j, hit)
  else if (j.candidates) { writeJson(item.file + '.json', j); enrich(item).then(e => send('saved', { ...e, replace: true })) }
  else if (!j.booru && (!j.tagger || j.tagged) && settings().autotag && tagger.has()) { say?.('tagging with the tagger'); await tagIt(item, j).catch(e => note(`Tagger: ${e.message}`, true)) } // no booru has it (j.tagged: its caption was emptied)
  return hit
}
const relookup = async item => {
  const t = task('Looking up'), j = sidecar(item)
  const hit = await resolve(item, j, s => t.set(`Looking up: ${s}`)).catch(e => { t.end(); note(e.message, true); throw e })
  t.end(hit ? `Tags from ${hit.category}` : j.candidates ? `${j.candidates.length} close matches` : j.tagger && !j.tagged ? 'No match, tagged' : canSimilar() ? 'No match' : 'No exact match')
  return hit
}

// The tagger (tagger.js), for pictures no booru has. What it guesses goes into the sidecar (j.tagger) and the caption.
const tagger = Tagger(path.join(HOME, 'models'))
const tagIt = async (item, j = sidecar(item)) => {
  j.tagger = await tagger.guess(item.file)
  delete j.candidates
  delete j.tagged
  writeJson(item.file + '.json', j)
  recaption(item, j)
  enrich(item).then(e => send('saved', { ...e, replace: true }))
}
// Booru tags stay: the tagger is for pictures without them (their caption would stop matching what the page shows).
const tag = async items => {
  if (!tagger.has()) return note('Install tagger in Instruments')
  const t = task('Tagging')
  let done = 0, kept = 0
  for (const [k, item] of items.entries()) {
    if (items.length > 1) t.set(`Tagging ${k + 1}/${items.length}`)
    try {
      const j = sidecar(item)
      if (j.booru || BOORU.has(j.category)) kept++
      else { await tagIt(item, j); done++ }
    } catch (e) { note(`Tagger: ${e.message}`, true) }
  }
  t.end(items.length > 1 ? `${done} tagged${kept ? `, ${kept} had booru tags` : ''}` : done ? 'Tagged' : kept ? 'Has booru tags' : '')
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
  { label: 'Open in Explorer', click: () => shell.openPath(path.join(PROJ, name)) },
  { type: 'separator' },
  { label: 'Delete project', click: () => removeProject(name) }
]).popup({ window: win })
// Export: pictures and their captions into a folder of the user's choosing, which is all a trainer reads. Same names; a clash gets the project as prefix.
const exportItems = async items => {
  const { filePaths: [d] } = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
  if (!d) return
  let captions = 0
  for (const it of items) {
    let name = path.basename(it.file)
    if (fs.existsSync(path.join(d, name))) name = it.project + '_' + name
    fs.copyFileSync(it.file, path.join(d, name))
    if (fs.existsSync(txt(it.file))) { fs.copyFileSync(txt(it.file), txt(path.join(d, name))); captions++ }
  }
  note(`${items.length} pictures, ${captions} captions → ${path.basename(d)}`)
  shell.showItemInFolder(d)
}
// Several at once, one result at the end.
const lookupAll = async items => {
  const t = task(`Looking up 0/${items.length}`)
  let matched = 0, unsure = 0, tagged = 0
  for (const [k, item] of items.entries()) {
    try {
      const j = sidecar(item)
      if (await resolve(item, j, s => t.set(`Looking up ${k + 1}/${items.length}: ${s}`))) matched++
      else if (j.candidates) unsure++
      else if (j.tagger && !j.tagged) tagged++
    } catch (e) { note(e.message, true) }
  }
  t.end(`${matched} matched, ${unsure} to pick, ${tagged ? `${tagged} tagged, ` : ''}${items.length - matched - unsure - tagged} none`)
}
// Series, characters or artists written by hand (right-click > Edit), for the tagger's misses and mistakes: one field of several
// pictures, overwritten whatever each had. Kept through lookups and tagger runs; '' leaves the field empty.
const setField = (items, field, text) => {
  const v = text.split(',').map(t => t.trim().replace(/^@/, '').replace(/\s+/g, '_')).filter(Boolean).join(' ')
  for (const item of items) {
    const j = sidecar(item)
    ;(j.edit ??= {})[field] = v
    writeJson(item.file + '.json', j)
    recaption(item, j)
    enrich(item).then(e => send('saved', { ...e, replace: true }))
  }
}
// The user picked one of the close matches.
const pick = (item, i) => { const j = sidecar(item); adopt(item, j, j.candidates[i].post) }
// Tag search pages per site. The query arrives in the site's own syntax (booru: space-separated tags).
const booru = t => encodeURIComponent(t)

const SEARCH = {
  danbooru: t => `https://danbooru.donmai.us/posts?tags=${booru(t)}`,
  gelbooru: t => `https://gelbooru.com/index.php?page=post&s=list&tags=${booru(t)}`,
  safebooru: t => `https://safebooru.org/index.php?page=post&s=list&tags=${booru(t)}`,
  yandere: t => `https://yande.re/post?tags=${booru(t)}`,
  konachan: t => `https://konachan.com/post?tags=${booru(t)}`,
  sankaku: t => `https://chan.sankakucomplex.com/?tags=${booru(t)}`,
  e621: t => `https://e621.net/posts?tags=${booru(t)}`,
  rule34: t => `https://rule34.xxx/index.php?page=post&s=list&tags=${booru(t)}`,
  animepictures: t => `https://anime-pictures.net/posts?search_tag=${booru(t)}`,
  zerochan: t => `https://www.zerochan.net/${encodeURIComponent(t)}`,
  pixiv: t => `https://www.pixiv.net/tags/${encodeURIComponent(t)}`,
  twitter: t => `https://x.com/search?q=${encodeURIComponent(t)}`,
  deviantart: t => `https://www.deviantart.com/search?q=${encodeURIComponent(t)}`,
  artstation: t => `https://www.artstation.com/search?query=${encodeURIComponent(t)}`
}

const search = (site, q) => pull({ page: SEARCH[site](q) }).catch(e => { note(e.message, true); throw e })

const tagMenu = tag => {
  // A caption tag shows spaces; boorus spell it with underscores.
  const sites = settings().sites.filter(s => SEARCH[s]).map(s => ({ label: s, click: () => shell.openExternal(SEARCH[s](BOORU.has(s) || s === 'animepictures' ? tag.replace(/ /g, '_') : tag)) }))
  Menu.buildFromTemplate([
    { label: `Search "${tag}"`, click: () => send('search', tag) },
    ...(sites.length ? [{ label: 'Search in', submenu: sites }] : [])
  ]).popup({ window: win })
}

// Right-click, on one picture or the selection it is in (as Explorer does): everything acts on all of them. Edit asks the page
// for the text. void: popup() answers with the window it opened on, which the IPC reply can't carry.
const menu = items => void Menu.buildFromTemplate([
  { label: 'Open', submenu: [
    { label: 'In Explorer', click: () => new Map(items.map(i => [path.dirname(i.file), i.file])).forEach(f => shell.showItemInFolder(f)) },
    { label: 'Original site', click: () => new Set(items.map(i => i.page)).forEach(u => shell.openExternal(u)) },
    ...new Set(items.map(i => i.project)).size === 1 ? [{ label: 'Project', click: () => send('openProject', items[0].project) }] : []
  ] },
  { label: 'Look up tags', click: () => items.length > 1 ? lookupAll(items) : relookup(items[0]) },
  { label: 'Run the tagger', click: () => tag(items) },
  { label: 'Edit', submenu: [['copyright', 'Series'], ['character', 'Characters'], ['artist', 'Artists']].map(([field, label]) => ({ label: label + '…', click: () => send('edit', { items, field, label }) })) },
  { label: 'Export', click: () => exportItems(items) },
  { type: 'separator' },
  { label: 'Delete', click: async () => { for (const i of items) await remove(i) } }
]).popup({ window: win })

const QUOTES = {
  advice: ['https://api.adviceslip.com/advice', j => j.slip.advice],
  animechan: ['https://api.animechan.io/v1/quotes/random', j => j.data.content],
  zenquotes: ['https://zenquotes.io/api/random', j => j[0].q],
  hitokoto: ['https://v1.hitokoto.cn/?c=a&c=b&c=c&c=d&max_length=28', j => j.hitokoto],
  none: null
}

const quote = () => {
  const src = QUOTES[settings().quote]
  if (!src) return null
  const [url, pick] = src
  return fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { signal: AbortSignal.timeout(3000), cache: 'no-store' })
    .then(r => r.json()).then(pick, () => null)
}

const getCreds = () => readJson(GDL, {}).extractor ?? {}

const setCred = (site, key, value) => {
  const c = readJson(GDL, {})
  ;((c.extractor ??= {})[site] ??= {})[key] = value
  fs.mkdirSync(path.dirname(GDL), { recursive: true })
  writeJson(GDL, c)
}

const oauth = site => {
  const [c, a] = gdlCmd()
  spawn('cmd.exe', ['/c', 'start', '""', 'cmd', '/k', c, ...a, `oauth:${site}`], { detached: true, stdio: 'ignore' }).unref()
}

// The Chrome extension ships inside the app (extraResources when packaged) and is exported for "Load unpacked".
const EXT = app.isPackaged ? path.join(process.resourcesPath, 'extension') : path.join(__dirname, 'extension')
// Self-update. Installed builds use electron-updater (latest.yml on the GitHub release).
// The portable exe is a self-extracting shell that runs from %TEMP%, so the file itself can simply be replaced and relaunched.
const PORTABLE = process.env.PORTABLE_EXECUTABLE_FILE
const RELEASES = 'https://api.github.com/repos/P3lerA/Epiphany/releases/latest'
autoUpdater.autoDownload = false
autoUpdater.on('update-downloaded', () => autoUpdater.quitAndInstall())
let updating
autoUpdater.on('download-progress', p => (updating ??= task('Downloading the update')).set(`Downloading the update ${Math.round(p.percent)}%`))
autoUpdater.on('error', e => { updating?.end(); updating = null; note(`Update: ${e.message}`, true) })
let latestRelease

const checkUpdate = async () => {
  const current = require('./package.json').version // app.getVersion() is Electron's own when launched without a package.json
  latestRelease = await fetch(RELEASES, { signal: AbortSignal.timeout(8000) }).then(r => r.ok ? r.json() : null).catch(() => null)
  const latest = latestRelease?.tag_name?.replace(/^v/, '') ?? null
  return { current, latest, how: PORTABLE ? 'portable' : app.isPackaged ? 'installed' : 'dev' }
}

const update = async () => {
  if (!PORTABLE) return autoUpdater.checkForUpdates().then(() => autoUpdater.downloadUpdate())
  const asset = latestRelease.assets.find(a => /^Epiphany[ .][0-9.]+\.exe$/.test(a.name)) // GitHub swaps spaces for dots in asset names
  if (!asset) throw new Error('no portable exe in ' + latestRelease.tag_name)
  const t = task('Downloading ' + asset.name) // until the app quits for it
  const buf = await fetch(asset.browser_download_url).then(r => r.arrayBuffer()).then(Buffer.from).catch(e => { t.end(); throw e })
  if (buf.length !== asset.size) { t.end(); throw new Error('download incomplete') }
  const nw = PORTABLE + '.new'
  fs.writeFileSync(nw, buf)
  spawn('cmd.exe', ['/c', `ping -n 2 127.0.0.1 >nul & move /y "${nw}" "${PORTABLE}" & start "" "${PORTABLE}"`], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  app.quit()
}

const instruments = async () => {
  const v = await gdl(['--version']).then(v => v.trim(), () => null)
  return {
    'gallery-dl': { status: v ?? 'not found', action: v ? 'Update' : 'Install' },
    extension: { status: readJson(path.join(EXT, 'manifest.json'), {}).version ?? '?', action: 'Export' },
    tagger: installing ? { status: 'downloading…', action: 'Install' } : tagger.has() ? { status: 'PixAI v1.0', action: 'Remove' } : { status: 'not installed', action: 'Install' }
  }
}

const exportExtension = async () => {
  const { filePaths: [d] } = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
  if (!d) return
  const out = path.join(d, 'epiphany-extension')
  fs.cpSync(EXT, out, { recursive: true })
  shell.showItemInFolder(out)
  note('Load it unpacked from chrome://extensions')
}

// Stable executables are published on Codeberg, with SHA256SUMS alongside.
const installGdl = async () => {
  const t = task('Downloading gallery-dl')
  try {
  const get = url => fetch(url, { signal: AbortSignal.timeout(120000) }).then(r => { if (!r.ok) throw new Error(`${r.status} ${url}`); return r })
  const rel = await get('https://codeberg.org/api/v1/repos/mikf/gallery-dl/releases/latest').then(r => r.json())
  const asset = n => rel.assets.find(a => a.name === n)?.browser_download_url
  if (!asset('gallery-dl.exe')) throw new Error('no gallery-dl.exe in ' + rel.tag_name)
  const buf = Buffer.from(await get(asset('gallery-dl.exe')).then(r => r.arrayBuffer()))
  const want = (await get(asset('SHA256SUMS')).then(r => r.text())).split('\n').find(l => l.trim().endsWith('gallery-dl.exe'))?.trim().split(/\s+/)[0]
  if (want && crypto.createHash('sha256').update(buf).digest('hex') !== want) throw new Error('checksum mismatch')
  fs.mkdirSync(path.dirname(GDL_EXE), { recursive: true })
  fs.writeFileSync(GDL_EXE, buf)
  const v = await gdl(['--version']).then(v => v.trim())
  t.end(`gallery-dl ${v} installed`)
  return v
  } catch (e) { t.end(); note(e.message, true) }
}

const HANDLERS = { list, projects, newProject, getSettings: settings, setSettings: v => writeJson(SETTINGS, v), profiles: () => PROFILES, getCaption, setCaption, setField, open, editTemplate, templateInfo, resetTemplate,
  lookup: relookup, lookupAll, pick, projectMenu, searchSites: () => Object.keys(SEARCH), search, tagMenu, menu, quoteSources: () => Object.keys(QUOTES), quote, getCreds, setCred, oauth,
  checkUpdate, update, instruments, exportExtension, installGdl, export: exportItems,
  tagWiki, tag, installTagger, removeTagger: tagger.remove, devtools: () => win.webContents.toggleDevTools(), restart: () => { app.relaunch(); app.quit() } } // debug mode; quit, not exit, so the window's bounds are saved
for (const [k, f] of Object.entries(HANDLERS)) ipcMain.handle(k, (_, ...a) => f(...a))
ipcMain.on('theme', (_, t, bar) => { nativeTheme.themeSource = t; win?.setTitleBarOverlay(bar) }) // native bits (select popups, title bar) follow nativeTheme, not our CSS

app.on('before-quit', () => { app.quitting = true })
let tray

app.whenReady().then(() => {
  dir()
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png')).resize({ width: 32 }))
  tray.setToolTip('Epiphany')
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Quit', click: () => app.quit() }]))
  tray.on('click', () => { win.show(); win.focus() })
  http.createServer((req, res) => {
    // Only the extension: web pages can POST here too (text/plain skips preflight), but can't fake Origin.
    if (!req.headers.origin?.startsWith('chrome-extension://')) return res.writeHead(403).end()
    if (req.method !== 'POST') return res.writeHead(404).end()
    let body = ''
    req.on('data', c => body += c)
    req.on('end', () => {
      let q
      try { q = JSON.parse(body) } catch { return res.writeHead(400).end() }
      ;(q.src ? save(q) : pull(q)).then(
        r => res.end(JSON.stringify(r)),
        err => { console.error(err.message); note(err.message, true); res.writeHead(500).end(err.message) }
      )
    })
  }).listen(PORT, '127.0.0.1')
  createWindow()
  pullWikis()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
