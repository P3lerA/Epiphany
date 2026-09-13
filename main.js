const { app, BrowserWindow, ipcMain, Menu, shell, nativeImage, dialog, nativeTheme } = require('electron')
const http = require('http')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { execFile, spawn } = require('child_process')
const crypto = require('crypto')
const { PROFILES, caption } = require('./profiles')

const PORT = 7777
const HOME = process.env.EPIPHANY_HOME || (app.isPackaged ? app.getPath('userData') : __dirname)
const SETTINGS = path.join(HOME, 'settings.json')
const WIN = path.join(HOME, 'window.json') // last window bounds; separate file so renderer settings saves never clobber it
const DEFAULTS = { project: 'default', quote: 'advice', lookup: true, sites: ['danbooru', 'gelbooru'], profile: 'anima', overrides: {} }
let win
Menu.setApplicationMenu(null)

const readJson = (f, fallback) => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : fallback
const settings = () => ({ ...DEFAULTS, ...readJson(SETTINGS, {}) })
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
const info = ({ file, page }) => {
  const j = readJson(file + '.json', null)
  if (!j) return { site: new URL(page).host, ai: false, rating: '' }
  const b = j.booru ?? j // a booru match looked up for a non-booru source, if any
  const tags = [b.tag_string, b.tags, b.tag_string_meta, b.tags_metadata].flatMap(words)
  return { site: j.category, ai: tags.some(t => /^ai[-_]generated$/.test(t)), rating: rating(b), artist: meta(b).artist, tags: meta(b).tags }
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
const enrich = async item => { const e = withUrl({ ...item, ...info(item) }); e.thumb = await thumb(e); return e }
const record = item => {
  fs.appendFileSync(path.join(dir(), 'meta.jsonl'), JSON.stringify(item) + '\n')
  enrich({ ...item, project: settings().project }).then(e => win?.webContents.send('saved', e))
  return item
}
const toast = text => win?.webContents.send('toast', text)
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
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false }
  })
  win.once('ready-to-show', () => { win.show(); if (saved.maximized) win.maximize() })
  win.on('close', () => fs.writeFileSync(WIN, JSON.stringify({ bounds: win.getNormalBounds(), maximized: win.isMaximized() })))
  win.loadFile('index.html')
}

// Right-click: one image URL, fetched directly.
async function save({ src, page }) {
  const res = await fetch(src, { headers: { Referer: page, 'User-Agent': 'Mozilla/5.0 Epiphany/0.1' } })
  if (!res.ok) throw new Error(`${res.status} ${src}`)
  let name = decodeURIComponent(path.basename(new URL(src).pathname)).replace(/[<>:"/\\|?*]/g, '_') || 'image'
  if (!path.extname(name)) name += '.' + (res.headers.get('content-type')?.split('/')[1]?.split(';')[0] || 'bin')
  if (fs.existsSync(path.join(dir(), name))) name = `${Date.now()}_${name}`
  const file = path.join(dir(), name)
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  return record({ file, src, page, time: new Date().toISOString() })
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
const lookup = async (j, file) => {
  const get = (url, pick) => fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Epiphany/0.1' } })
    .then(r => r.ok ? r.json() : null).then(pick, () => null)
  const dan = tags => get(`https://danbooru.donmai.us/posts.json?limit=1&tags=${encodeURIComponent(tags)}`, r => r?.[0] ? { ...r[0], category: 'danbooru' } : null)
  const md5 = crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex')
  const key = j.category === 'pixiv' ? `pixiv_id:${j.id}` : j.category === 'twitter' ? `source:*status/${j.tweet_id}*` : null
  let hit = (key && await dan(key)) || await dan(`md5:${md5}`)
  if (!hit) {
    const g = readJson(path.join(process.env.APPDATA, 'gallery-dl', 'config.json'), {}).extractor?.gelbooru ?? {}
    hit = await get(`https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1&limit=1&tags=md5:${md5}&api_key=${g['api-key'] ?? ''}&user_id=${g['user-id'] ?? ''}`,
      r => r?.post?.[0] ? { ...r.post[0], category: 'gelbooru' } : null)
  }
  return hit
}

// Toolbar button: a page URL, handed to gallery-dl.
async function pull({ page }) {
  const d = dir()
  const before = new Set(fs.readdirSync(d))
  // ponytail: --range caps a search page at 50 posts; make it a profile field if you want whole searches
  await gdl(['--write-metadata', '-o', 'tags=true', '--range', '1-50', '-D', d, page])
  const s = settings()
  const profile = { ...PROFILES[s.profile], ...s.overrides }
  const items = []
  for (const f of fs.readdirSync(d)) {
    if (before.has(f) || !f.endsWith('.json')) continue
    const img = f.slice(0, -5)
    if (!fs.existsSync(path.join(d, img))) continue
    const j = readJson(path.join(d, f), {})
    if (s.lookup && !BOORU.has(j.category)) {
      j.booru = await lookup(j, path.join(d, img))
      if (j.booru) fs.writeFileSync(path.join(d, f), JSON.stringify(j, null, 2))
    }
    if (j.booru || s.sites.includes(j.category)) fs.writeFileSync(path.join(d, img.replace(/\.[^.]+$/, '.txt')), caption(profile, meta(j.booru ?? j)))
    items.push(record({ file: path.join(d, img), src: page, page, time: new Date().toISOString() }))
  }
  if (!items.length) throw new Error('nothing new from ' + page)
  toast(`${items.length} from ${new URL(page).host}`)
  return items
}

ipcMain.handle('list', () => Promise.all(projects().flatMap(p => {
  const f = path.join(dir(p), 'meta.jsonl')
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => enrich({ ...JSON.parse(l), project: p })) : []
})))
ipcMain.handle('projects', projects)
ipcMain.handle('newProject', (_, name) => { if (/^[\w-]+$/.test(name)) dir(name) })
ipcMain.handle('getSettings', settings)
ipcMain.handle('setSettings', (_, s) => fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2)))
ipcMain.handle('profiles', () => PROFILES)
const txt = f => f.replace(/\.[^.]+$/, '.txt')
ipcMain.handle('getCaption', (_, file) => fs.existsSync(txt(file)) ? fs.readFileSync(txt(file), 'utf8') : '')
ipcMain.handle('setCaption', (_, file, text) => fs.writeFileSync(txt(file), text))
ipcMain.handle('open', (_, url) => shell.openExternal(url))
// Native bits (select popups, title bar) follow nativeTheme, not our CSS; keep them in step with the dot.
ipcMain.on('theme', (_, t) => { nativeTheme.themeSource = t })

// Right-click on a picture. Delete goes to the Recycle Bin, so no confirm.
const remove = async item => {
  for (const f of [item.file, item.file + '.json', txt(item.file)]) if (fs.existsSync(f)) await shell.trashItem(f)
  const m = path.join(dir(item.project), 'meta.jsonl')
  fs.writeFileSync(m, fs.readFileSync(m, 'utf8').split('\n').filter(l => l && JSON.parse(l).file !== item.file).join('\n') + '\n')
  fs.rmSync(thumbPath(item), { force: true })
  win.webContents.send('removed', item.file)
}
ipcMain.handle('remove', (_, item) => remove(item))
// Manual lookup for any picture, including right-click saves that have no sidecar.
const relookup = async item => {
  toast('Looking up…')
  const jf = item.file + '.json'
  const j = readJson(jf, { category: new URL(item.page).host })
  const hit = await lookup(j, item.file)
  toast(hit ? `Tags from ${hit.category}` : 'No match on danbooru or gelbooru')
  if (!hit) return null
  j.booru = hit
  fs.writeFileSync(jf, JSON.stringify(j, null, 2))
  const s = settings()
  fs.writeFileSync(txt(item.file), caption({ ...PROFILES[s.profile], ...s.overrides }, meta(hit)))
  enrich(item).then(e => win.webContents.send('saved', { ...e, replace: true }))
  return hit
}
ipcMain.handle('lookup', (_, item) => relookup(item))
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
ipcMain.handle('searchSites', () => Object.keys(SEARCH))
ipcMain.handle('search', (_, site, q) => { toast(`Pulling "${q}" from ${site}…`); return pull({ page: SEARCH[site](q) }).catch(e => { toast(e.message); throw e }) })
ipcMain.handle('tagMenu', (_, tag) => {
  // A caption tag shows spaces; boorus spell it with underscores.
  const sites = settings().sites.filter(s => SEARCH[s]).map(s => ({ label: s, click: () => shell.openExternal(SEARCH[s](BOORU.has(s) || s === 'animepictures' ? tag.replace(/ /g, '_') : tag)) }))
  Menu.buildFromTemplate([
    { label: `Search "${tag}"`, click: () => win.webContents.send('search', tag) },
    ...(sites.length ? [{ label: 'Search in', submenu: sites }] : [])
  ]).popup({ window: win })
})
ipcMain.handle('menu', (_, item) => Menu.buildFromTemplate([
  { label: 'Open in Explorer', click: () => shell.showItemInFolder(item.file) },
  { label: 'Open original site', click: () => shell.openExternal(item.page) },
  { label: 'Open project', click: () => win.webContents.send('openProject', item.project) },
  { label: 'Look up tags', click: () => relookup(item) },
  { type: 'separator' },
  { label: 'Delete', click: () => remove(item) }
]).popup({ window: win }))
const QUOTES = {
  advice: ['https://api.adviceslip.com/advice', j => j.slip.advice],
  animechan: ['https://api.animechan.io/v1/quotes/random', j => j.data.content],
  zenquotes: ['https://zenquotes.io/api/random', j => j[0].q],
  hitokoto: ['https://v1.hitokoto.cn/?c=a&c=b&c=c&c=d&max_length=28', j => j.hitokoto],
  none: null
}
ipcMain.handle('quoteSources', () => Object.keys(QUOTES))
ipcMain.handle('quote', () => {
  const src = QUOTES[settings().quote]
  if (!src) return null
  const [url, pick] = src
  return fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { signal: AbortSignal.timeout(3000), cache: 'no-store' })
    .then(r => r.json()).then(pick, () => null)
})
// Site credentials live in gallery-dl's own config, which is what reads them.
const GDL = path.join(process.env.APPDATA, 'gallery-dl', 'config.json')
ipcMain.handle('getCreds', () => readJson(GDL, {}).extractor ?? {})
ipcMain.handle('setCred', (_, site, key, value) => {
  const c = readJson(GDL, {})
  ;((c.extractor ??= {})[site] ??= {})[key] = value
  fs.mkdirSync(path.dirname(GDL), { recursive: true })
  fs.writeFileSync(GDL, JSON.stringify(c, null, 2))
})
ipcMain.handle('oauth', (_, site) => {
  const [c, a] = gdlCmd()
  spawn('cmd.exe', ['/c', 'start', '""', 'cmd', '/k', c, ...a, `oauth:${site}`], { detached: true, stdio: 'ignore' }).unref()
})
// The Chrome extension ships inside the app (extraResources when packaged) and is exported for "Load unpacked".
const EXT = app.isPackaged ? path.join(process.resourcesPath, 'extension') : path.join(__dirname, 'extension')
ipcMain.handle('instruments', async () => {
  const v = await gdl(['--version']).then(v => v.trim(), () => null)
  return {
    'gallery-dl': { status: v ? `${v} · ${fs.existsSync(GDL_EXE) ? 'exe' : 'python'}` : 'not found', action: v ? 'Update' : 'Install' },
    extension: { status: readJson(path.join(EXT, 'manifest.json'), {}).version ?? '?', action: 'Export' }
  }
})
ipcMain.handle('exportExtension', async () => {
  const { filePaths: [d] } = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
  if (!d) return
  const out = path.join(d, 'epiphany-extension')
  fs.cpSync(EXT, out, { recursive: true })
  shell.showItemInFolder(out)
  toast('Load it unpacked from chrome://extensions')
})
// Stable executables are published on Codeberg, with SHA256SUMS alongside.
ipcMain.handle('installGdl', async () => {
  toast('Downloading gallery-dl…')
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
  toast(`gallery-dl ${v} installed`)
  return v
})

app.whenReady().then(() => {
  dir()
  http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    if (req.method !== 'POST') return res.writeHead(404).end()
    let body = ''
    req.on('data', c => body += c)
    req.on('end', () => {
      const q = JSON.parse(body)
      ;(q.src ? save(q) : pull(q)).then(
        r => res.end(JSON.stringify(r)),
        err => { console.error(err.message); toast(err.message); res.writeHead(500).end(err.message) }
      )
    })
  }).listen(PORT, '127.0.0.1')
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
