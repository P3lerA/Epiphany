// gallery-dl: where it keeps site credentials, how it is run, installed, stopped, and signed in through. Windows and macOS differ
// here only: Windows gets the standalone exe from Codeberg, macOS (none is published) a Python venv of its own. Windows without
// it: whatever Python has (dev machines). Not macOS: /usr/bin/python3 without Apple's developer tools asks to install them.
const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const { execFile, spawn } = require('child_process')
const MAC = process.platform === 'darwin'

module.exports = home => {
  const CONFIG = path.join(MAC ? path.join(os.homedir(), '.config') : process.env.APPDATA, 'gallery-dl', 'config.json')
  const VENV = path.join(home, 'bin', 'gallery-dl')
  const EXE = MAC ? path.join(VENV, 'bin', 'gallery-dl') : path.join(home, 'bin', 'gallery-dl.exe')
  const cmd = () => MAC || fs.existsSync(EXE) ? [EXE, []] : ['python', ['-m', 'gallery_dl']]

  const run = (c, args) => {
    let child
    const p = new Promise((res, rej) => child = execFile(c, args, { maxBuffer: 1e7 }, (e, out, err) => e ? rej(new Error(err || e.message)) : res(out)))
    p.child = child
    return p
  }
  const gdl = args => { const [c, a] = cmd(); return run(c, [...a, ...args]) }
  // The whole tree: gallery-dl.exe unpacks itself and runs as a child of its own. On macOS it is Python itself.
  const kill = child => MAC ? child.kill() : execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {})

  // Its oauth: flow asks questions in a terminal of its own.
  const oauth = site => {
    const args = [...cmd().flat(), `oauth:${site}`]
    if (!MAC) return spawn('cmd.exe', ['/c', 'start', '""', 'cmd', '/k', ...args], { detached: true, stdio: 'ignore' }).unref()
    const sh = args.map(x => `'${x.replace(/'/g, `'\\''`)}'`).join(' ')
    spawn('osascript', ['-e', `tell application "Terminal" to do script ${JSON.stringify(sh)}`, '-e', 'tell application "Terminal" to activate'], { stdio: 'ignore' })
  }

  // Install and Update alike; the version it then reports. Windows: the stable exe, checked against Codeberg's SHA256SUMS.
  const install = async () => {
    if (MAC) {
      await run('python3', ['-m', 'venv', VENV]).catch(e => { // without them python3 is Apple's stub: it opens their installer and fails
        throw /xcode-select/.test(e.message) ? new Error("gallery-dl needs Apple's command line tools: install them, then Install again") : e
      })
      await run(path.join(VENV, 'bin', 'pip'), ['install', '-U', 'gallery-dl'])
    } else {
      const get = url => fetch(url, { signal: AbortSignal.timeout(120000) }).then(r => { if (!r.ok) throw new Error(`${r.status} ${url}`); return r })
      const rel = await get('https://codeberg.org/api/v1/repos/mikf/gallery-dl/releases/latest').then(r => r.json())
      const now = fs.existsSync(EXE) && await gdl(['--version']).then(v => v.trim(), () => null)
      if (now === rel.tag_name.replace(/^v/, '')) return now // up to date: nothing to fetch
      const asset = n => rel.assets.find(a => a.name === n)?.browser_download_url
      if (!asset('gallery-dl.exe')) throw new Error('no gallery-dl.exe in ' + rel.tag_name)
      const buf = Buffer.from(await get(asset('gallery-dl.exe')).then(r => r.arrayBuffer()))
      const want = (await get(asset('SHA256SUMS')).then(r => r.text())).split('\n').find(l => l.trim().endsWith('gallery-dl.exe'))?.trim().split(/\s+/)[0]
      if (want && crypto.createHash('sha256').update(buf).digest('hex') !== want) throw new Error('checksum mismatch')
      fs.mkdirSync(path.dirname(EXE), { recursive: true })
      fs.writeFileSync(EXE, buf)
    }
    return gdl(['--version']).then(v => v.trim())
  }

  return { CONFIG, gdl, kill, oauth, install }
}
