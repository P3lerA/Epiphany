const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron')
const http = require('http')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { execFile } = require('child_process')
const { PROFILES, caption } = require('./profiles')

const PORT = 7777
const HOME = process.env.EPIPHANY_HOME || __dirname
const SETTINGS = path.join(HOME, 'settings.json')
const DEFAULTS = { project: 'default', quote: 'advice', sites: ['danbooru', 'gelbooru'], profile: 'anima', overrides: {} }
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
  const tags = [j.tag_string, j.tags, j.tag_string_meta, j.tags_metadata].flatMap(words)
  return { site: j.category, ai: tags.some(t => /^ai[-_]generated$/.test(t)), rating: rating(j), artist: meta(j).artist, tags: meta(j).tags }
}
const enrich = item => withUrl({ ...item, ...info(item) })
const record = item => {
  fs.appendFileSync(path.join(dir(), 'meta.jsonl'), JSON.stringify(item) + '\n')
  win?.webContents.send('saved', enrich({ ...item, project: settings().project }))
  return item
}
const run = (cmd, args) => new Promise((res, rej) =>
  execFile(cmd, args, { maxBuffer: 1e7 }, (e, out, err) => e ? rej(new Error(err || e.message)) : res(out)))

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false }
  })
  win.once('ready-to-show', () => win.show())
  win.loadFile('index.html')
}

// Right-click: one image URL, fetched directly.
async function save({ src, page }) {
  const res = await fetch(src, { headers: { Referer: page } })
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

// Toolbar button: a page URL, handed to gallery-dl.
async function pull({ page }) {
  const d = dir()
  const before = new Set(fs.readdirSync(d))
  // ponytail: --range caps a search page at 50 posts; make it a profile field if you want whole searches
  await run('python', ['-m', 'gallery_dl', '--write-metadata', '-o', 'tags=true', '--range', '1-50', '-D', d, page])
  const s = settings()
  const profile = { ...PROFILES[s.profile], ...s.overrides }
  const items = []
  for (const f of fs.readdirSync(d)) {
    if (before.has(f) || !f.endsWith('.json')) continue
    const img = f.slice(0, -5)
    if (!fs.existsSync(path.join(d, img))) continue
    const j = readJson(path.join(d, f), {})
    if (s.sites.includes(j.category)) fs.writeFileSync(path.join(d, img.replace(/\.[^.]+$/, '.txt')), caption(profile, meta(j)))
    items.push(record({ file: path.join(d, img), src: page, page, time: new Date().toISOString() }))
  }
  if (!items.length) throw new Error('nothing new from ' + page)
  return items
}

ipcMain.handle('list', () => projects().flatMap(p => {
  const f = path.join(dir(p), 'meta.jsonl')
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => enrich({ ...JSON.parse(l), project: p })) : []
}))
ipcMain.handle('projects', projects)
ipcMain.handle('newProject', (_, name) => { if (/^[\w-]+$/.test(name)) dir(name) })
ipcMain.handle('getSettings', settings)
ipcMain.handle('setSettings', (_, s) => fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2)))
ipcMain.handle('profiles', () => PROFILES)
const txt = f => f.replace(/\.[^.]+$/, '.txt')
ipcMain.handle('getCaption', (_, file) => fs.existsSync(txt(file)) ? fs.readFileSync(txt(file), 'utf8') : '')
ipcMain.handle('setCaption', (_, file, text) => fs.writeFileSync(txt(file), text))
ipcMain.handle('open', (_, url) => shell.openExternal(url))

// Right-click on a picture. Delete goes to the Recycle Bin, so no confirm.
const remove = async item => {
  for (const f of [item.file, item.file + '.json', txt(item.file)]) if (fs.existsSync(f)) await shell.trashItem(f)
  const m = path.join(dir(item.project), 'meta.jsonl')
  fs.writeFileSync(m, fs.readFileSync(m, 'utf8').split('\n').filter(l => l && JSON.parse(l).file !== item.file).join('\n') + '\n')
  win.webContents.send('removed', item.file)
}
ipcMain.handle('remove', (_, item) => remove(item))
ipcMain.handle('tagMenu', (_, tag) => Menu.buildFromTemplate([
  { label: `Search "${tag}"`, click: () => win.webContents.send('search', tag) }
]).popup({ window: win }))
ipcMain.handle('menu', (_, item) => Menu.buildFromTemplate([
  { label: 'Open in Explorer', click: () => shell.showItemInFolder(item.file) },
  { label: 'Open original site', click: () => shell.openExternal(item.page) },
  { label: 'Open project', click: () => win.webContents.send('openProject', item.project) },
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
ipcMain.handle('instruments', async () => ({
  'gallery-dl': await run('python', ['-m', 'gallery_dl', '--version']).then(v => v.trim(), () => null)
}))

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
        err => { console.error(err.message); res.writeHead(500).end(err.message) }
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
