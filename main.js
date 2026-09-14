const { app, BrowserWindow, ipcMain, Menu, shell, nativeImage, dialog, nativeTheme, Tray, net } = require('electron')
const http = require('http')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { execFile, spawn } = require('child_process')
const crypto = require('crypto')
const { PROFILES, caption } = require('./profiles')
const { autoUpdater } = require('electron-updater')

const PORT = Number(process.env.EPIPHANY_PORT) || 7676 // 7777 collides with AIRI, 67xx is a Windows reserved range; env override keeps test runs off the real app
const HOME = process.env.EPIPHANY_HOME || (app.isPackaged ? app.getPath('userData') : __dirname)
const SETTINGS = path.join(HOME, 'settings.json')
const WIN = path.join(HOME, 'window.json') // last window bounds; separate file so renderer settings saves never clobber it
const DEFAULTS = { project: 'default', quote: 'advice', lookup: true, sites: ['danbooru', 'gelbooru'], profile: 'anima', overrides: {}, accept: 90 }
let win
Menu.setApplicationMenu(null)
if (!app.requestSingleInstanceLock()) app.exit() // quit() is async and whenReady would still open a window; a second launch (tray-parked app, double-clicked exe) just raises the first
app.on('second-instance', () => { win?.show(); win?.focus() })

const readJson = (f, fallback) => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : fallback
const writeJson = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 2))
const settings = () => ({ ...DEFAULTS, ...readJson(SETTINGS, {}) })
const profile = () => { const s = settings(); return { ...PROFILES[s.profile], ...s.overrides } }
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

const info = ({ file, page }) => {
  const j = readJson(file + '.json', null)
  if (!j) return { site: new URL(page).host, ai: false, rating: '', tagged: 'none' }
  const b = j.booru ?? j // a booru match looked up for a non-booru source, if any
  const tags = [b.tag_string, b.tags, b.tag_string_meta, b.tags_metadata].flatMap(words)
  // booru: booru-vocabulary tags (pulled from one, or matched); unsure: close matches await a pick; none: no booru tags.
  const tagged = j.booru || BOORU.has(j.category) ? 'booru' : j.candidates ? 'unsure' : 'none'
  // Each candidate with the tags only it has, so look-alike variants can be told apart.
  const sets = j.candidates?.map(c => new Set(words(c.post.tag_string_general)))
  const candidates = j.candidates?.map((c, i) => ({ score: c.score, url: c.thumb ? pathToFileURL(c.thumb).href : c.post.preview_file_url, caption: caption(profile(), meta(c.post)), plus: [...sets[i]].filter(t => !sets.some((o, k) => k !== i && o.has(t))) }))
  // The post the caption's tags came from: the matched one for lookups, the pulled one for booru pulls (a tag search's page URL isn't it).
  const from = j.booru ? postUrl(j.booru) : BOORU.has(j.category) ? postUrl(j) : undefined
  return { site: j.category, ai: tags.some(t => /^ai[-_]generated$/.test(t)), rating: rating(b), artist: meta(b).artist, tags: meta(b).tags, tagged, candidates, from }
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
  item = { ...item, project: settings().project }
  enrich(item).then(e => send('saved', e))
  return item
}

const send = (ch, ...a) => win?.webContents.send(ch, ...a)
const toast = text => send('toast', text)

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
  win.on('close', e => {
    writeJson(WIN, { bounds: win.getNormalBounds(), maximized: win.isMaximized() })
    if (!app.quitting) { e.preventDefault(); win.hide() } // closing parks it in the tray; the extension keeps a listener
  })
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
  const item = record({ file, src, page, time: new Date().toISOString() })
  if (settings().lookup) resolve(item, { category: new URL(page).host }).catch(e => toast(e.message)) // same matching as a pull, after the reply
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

const danAuth = () => { const d = readJson(GDL, {}).extractor?.danbooru ?? {}; return d.username && d['api-key'] ? 'Basic ' + Buffer.from(`${d.username}:${d['api-key']}`).toString('base64') : null }
const lookup = async (j, file) => {
  const get = (url, pick) => fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Epiphany/0.1' } })
    .then(r => r.ok ? r.json() : null).then(pick, () => null)
  const dan = tags => get(`https://danbooru.donmai.us/posts.json?limit=1&tags=${encodeURIComponent(tags)}`, r => r?.[0] ? { ...r[0], category: 'danbooru' } : null)
  const md5 = crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex')
  const key = j.category === 'pixiv' ? `pixiv_id:${j.id}` : j.category === 'twitter' ? `source:*status/${j.tweet_id}*` : null
  let hit = (key && await dan(key)) || await dan(`md5:${md5}`)
  if (!hit) {
    const g = readJson(GDL, {}).extractor?.gelbooru ?? {}
    hit = await get(`https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1&limit=1&tags=md5:${md5}&api_key=${g['api-key'] ?? ''}&user_id=${g['user-id'] ?? ''}`,
      r => r?.post?.[0] ? { ...r.post[0], category: 'gelbooru' } : null)
  }
  if (!hit && danAuth()) {
    // Same picture, different bytes (watermark, rescale, scan): danbooru's IQDB matches by similarity.
    // Uploading needs an account (anonymous = Pundit denied); API-key auth also skips Rails CSRF. net.fetch: Cloudflare accepts Chromium's TLS, not Node's.
    const fd = new FormData()
    fd.append('search[file]', new Blob([fs.readFileSync(file)]), path.basename(file))
    const c = await net.fetch('https://danbooru.donmai.us/iqdb_queries.json', { method: 'POST', body: fd, signal: AbortSignal.timeout(30000), headers: { Authorization: danAuth() } })
      .then(r => r.ok ? r.json() : [], () => [])
    const near = c.filter(x => x.score >= 70 && x.post).sort((a, b) => b.score - a.score).slice(0, 4)
      .map(x => ({ score: Math.round(x.score), post: { ...x.post, category: 'danbooru' } }))
    // Settings decide how sure a similarity match must be to skip the human; exact id/md5 hits above never ask.
    if (near.length && near[0].score >= settings().accept && (near.length === 1 || near[0].score - near[1].score >= 15)) hit = near[0].post
    else if (near.length) {
      j.candidates = near
      // Their preview thumbnails, fetched here (Chromium's stack, proven against the CDN) and kept beside our own thumbs.
      const p = path.basename(path.dirname(path.dirname(file)))
      for (const c of near) {
        const t = path.join(thumbs(p), 'cand-' + c.post.id + '.jpg')
        if (!fs.existsSync(t)) await net.fetch(c.post.preview_file_url).then(async r => r.ok && fs.writeFileSync(t, Buffer.from(await r.arrayBuffer()))).catch(() => {})
        if (fs.existsSync(t)) c.thumb = t
      }
    }
  }
  return hit
}

// Toolbar button: a page URL, handed to gallery-dl.
async function pull({ page }) {
  const d = dir()
  const before = new Set(fs.readdirSync(d))
  // ponytail: --range caps a search page at 50 posts; make it a profile field if you want whole searches
  await gdl(['--write-metadata', '-o', 'tags=true', '--range', '1-50', '-D', d, page])
  const s = settings(), prof = profile()
  const items = [], later = []
  for (const f of fs.readdirSync(d)) {
    if (before.has(f) || !f.endsWith('.json')) continue
    const img = f.slice(0, -5)
    if (!fs.existsSync(path.join(d, img))) continue
    const j = readJson(path.join(d, f), {})
    const item = record({ file: path.join(d, img), src: page, page, time: new Date().toISOString() })
    items.push(item)
    // The site's own tags caption it right away; a booru match (below) replaces that.
    if (BOORU.has(j.category) || s.sites.includes(j.category)) fs.writeFileSync(txt(item.file), caption(prof, meta(j)))
    if (s.lookup && !BOORU.has(j.category)) later.push([item, j])
  }
  if (!items.length) throw new Error('nothing new from ' + page)
  toast(`${items.length} from ${new URL(page).host}`)
  // After the grid has them, and after the extension gets its answer: IQDB uploads take seconds each.
  ;(async () => { for (const [item, j] of later) await resolve(item, j) })().catch(e => toast(e.message))
  return items
}

const list = () => Promise.all(projects().flatMap(p => {
  const f = path.join(dir(p), 'meta.jsonl')
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => enrich({ ...JSON.parse(l), project: p })) : []
}))

const newProject = name => { if (/^[\w-]+$/.test(name)) dir(name) }
const txt = f => f.replace(/\.[^.]+$/, '.txt')
const getCaption = file => fs.existsSync(txt(file)) ? fs.readFileSync(txt(file), 'utf8') : ''
const setCaption = (file, text) => fs.writeFileSync(txt(file), text)
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
const adopt = (item, j, hit) => {
  j.booru = hit
  delete j.candidates
  writeJson(item.file + '.json', j)
  fs.writeFileSync(txt(item.file), caption(profile(), meta(hit)))
  enrich(item).then(e => send('saved', { ...e, replace: true }))
}
// A non-booru picture: its booru post by exact ids/md5, then by similarity; close calls become candidates.
const resolve = async (item, j) => {
  delete j.candidates
  const hit = await lookup(j, item.file)
  if (hit) adopt(item, j, hit)
  else if (j.candidates) { writeJson(item.file + '.json', j); enrich(item).then(e => send('saved', { ...e, replace: true })) }
  return hit
}
const relookup = async item => {
  toast('Looking up…')
  const j = readJson(item.file + '.json', { category: new URL(item.page).host })
  const hit = await resolve(item, j)
  toast(hit ? `Tags from ${hit.category}` : j.candidates ? `${j.candidates.length} close matches, pick one in the preview` : danAuth() ? 'No match on danbooru or gelbooru' : 'No exact match; similarity search needs a danbooru account (Sites)')
  return hit
}
// Projects: right-click. Delete goes to the Recycle Bin; the active project falls back to the first one left.
const removeProject = async name => {
  await shell.trashItem(path.join(PROJ, name))
  const s = settings()
  if (s.project === name) { s.project = projects()[0] ?? 'default'; writeJson(SETTINGS, s); dir(s.project) }
  send('projectRemoved', name)
}
const projectMenu = name => Menu.buildFromTemplate([
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
  toast(`${items.length} pictures, ${captions} captions → ${path.basename(d)}`)
  shell.showItemInFolder(d)
}
// The user picked one of the close matches.
const pick = (item, i) => { const j = readJson(item.file + '.json', {}); adopt(item, j, j.candidates[i].post) }
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

const search = (site, q) => { toast(`Pulling "${q}" from ${site}…`); return pull({ page: SEARCH[site](q) }).catch(e => { toast(e.message); throw e }) }

const tagMenu = tag => {
  // A caption tag shows spaces; boorus spell it with underscores.
  const sites = settings().sites.filter(s => SEARCH[s]).map(s => ({ label: s, click: () => shell.openExternal(SEARCH[s](BOORU.has(s) || s === 'animepictures' ? tag.replace(/ /g, '_') : tag)) }))
  Menu.buildFromTemplate([
    { label: `Search "${tag}"`, click: () => send('search', tag) },
    ...(sites.length ? [{ label: 'Search in', submenu: sites }] : [])
  ]).popup({ window: win })
}

const menu = item => Menu.buildFromTemplate([
  { label: 'Open in Explorer', click: () => shell.showItemInFolder(item.file) },
  { label: 'Open original site', click: () => shell.openExternal(item.page) },
  { label: 'Open project', click: () => send('openProject', item.project) },
  { label: 'Look up tags', click: () => relookup(item) },
  { type: 'separator' },
  { label: 'Delete', click: () => remove(item) }
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
autoUpdater.on('download-progress', p => toast(`Downloading ${Math.round(p.percent)}%`))
let latestRelease

const checkUpdate = async () => {
  const current = require('./package.json').version // app.getVersion() is Electron's own when launched without a package.json
  latestRelease = await fetch(RELEASES, { signal: AbortSignal.timeout(8000) }).then(r => r.ok ? r.json() : null, () => null)
  const latest = latestRelease?.tag_name?.replace(/^v/, '') ?? null
  return { current, latest, how: PORTABLE ? 'portable' : app.isPackaged ? 'installed' : 'dev' }
}

const update = async () => {
  if (!PORTABLE) return autoUpdater.checkForUpdates().then(() => autoUpdater.downloadUpdate())
  const asset = latestRelease.assets.find(a => /^Epiphany[ .][0-9.]+\.exe$/.test(a.name)) // GitHub swaps spaces for dots in asset names
  if (!asset) throw new Error('no portable exe in ' + latestRelease.tag_name)
  toast('Downloading ' + asset.name + '…')
  const buf = Buffer.from(await fetch(asset.browser_download_url).then(r => r.arrayBuffer()))
  if (buf.length !== asset.size) throw new Error('download incomplete')
  const nw = PORTABLE + '.new'
  fs.writeFileSync(nw, buf)
  spawn('cmd.exe', ['/c', `ping -n 2 127.0.0.1 >nul & move /y "${nw}" "${PORTABLE}" & start "" "${PORTABLE}"`], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  app.quit()
}

const instruments = async () => {
  const v = await gdl(['--version']).then(v => v.trim(), () => null)
  return {
    'gallery-dl': { status: v ?? 'not found', action: v ? 'Update' : 'Install' },
    extension: { status: readJson(path.join(EXT, 'manifest.json'), {}).version ?? '?', action: 'Export' }
  }
}

const exportExtension = async () => {
  const { filePaths: [d] } = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
  if (!d) return
  const out = path.join(d, 'epiphany-extension')
  fs.cpSync(EXT, out, { recursive: true })
  shell.showItemInFolder(out)
  toast('Load it unpacked from chrome://extensions')
}

// Stable executables are published on Codeberg, with SHA256SUMS alongside.
const installGdl = async () => {
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
}

const HANDLERS = { list, projects, newProject, getSettings: settings, setSettings: v => writeJson(SETTINGS, v), profiles: () => PROFILES, getCaption, setCaption, open,
  lookup: relookup, pick, projectMenu, searchSites: () => Object.keys(SEARCH), search, tagMenu, menu, quoteSources: () => Object.keys(QUOTES), quote, getCreds, setCred, oauth,
  checkUpdate, update, instruments, exportExtension, installGdl, export: exportItems }
for (const [k, f] of Object.entries(HANDLERS)) ipcMain.handle(k, (_, ...a) => f(...a))
ipcMain.on('theme', (_, t) => { nativeTheme.themeSource = t }) // native bits (select popups, title bar) follow nativeTheme, not our CSS

app.on('before-quit', () => { app.quitting = true })
let tray

app.whenReady().then(() => {
  dir()
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png')).resize({ width: 32 }))
  tray.setToolTip('Epiphany')
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Quit', click: () => app.quit() }]))
  tray.on('click', () => { win.show(); win.focus() })
  http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    if (req.method !== 'POST') return res.writeHead(404).end()
    let body = ''
    req.on('data', c => body += c)
    req.on('end', () => {
      let q
      try { q = JSON.parse(body) } catch { return res.writeHead(400).end() }
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
