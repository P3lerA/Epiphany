// Self-update. Installed builds use electron-updater (latest.yml on the GitHub release); macOS swaps its .app (update, below).
// The portable exe is a self-extracting shell that runs from %TEMP%; it stays locked (no rename, no overwrite) until its launcher has
// cleaned up, seconds after we quit. So the new one waits beside it, and takes over as Epiphany.exe once this one is let go and
// deleted: one name from then on, so shortcuts keep working.
const { app } = require('electron')
const { autoUpdater } = require('electron-updater')
const fs = require('fs')
const path = require('path')
const { spawn, execFile } = require('child_process')
const MAC = process.platform === 'darwin'
const PORTABLE = process.env.PORTABLE_EXECUTABLE_FILE
const RELEASES = 'https://api.github.com/repos/P3lerA/Epiphany/releases/latest'

module.exports = ({ task, note, busy }) => { // busy(): how many tasks the task line has running
  autoUpdater.autoDownload = false
  // An update quits without asking, so it first waits for the rest of the task line (a pull, a lookup) to finish.
  const idle = async own => {
    if (busy() > (own ? 1 : 0)) own?.set('Update waits for the work in progress')
    while (busy() > (own ? 1 : 0)) await new Promise(r => setTimeout(r, 1000))
    app.quitting = true
  }
  autoUpdater.on('update-downloaded', () => idle(updating).then(() => autoUpdater.quitAndInstall(true, true))) // silent: else the whole setup wizard, waiting for clicks; then relaunched
  let updating
  autoUpdater.on('download-progress', p => (updating ??= task('Downloading the update')).set(`Downloading the update ${Math.round(p.percent)}%`))
  autoUpdater.on('error', e => { updating?.end(); updating = null; note(`Update: ${e.message}`, true) })
  let latestRelease, updateCall // the update under way: another click joins it (two would wait on each other forever)

  // say: Check was pressed, what it found goes to the task line, as gallery-dl's Update says its own
  const checkUpdate = async say => {
    const current = require('./package.json').version // app.getVersion() is Electron's own when launched without a package.json
    const t = say ? task('Checking for updates') : null
    latestRelease = await fetch(RELEASES, { signal: AbortSignal.timeout(8000) }).then(r => r.ok ? r.json() : null).catch(() => null)
    const latest = latestRelease?.tag_name?.replace(/^v/, '') ?? null
    t?.end(!latest ? "GitHub didn't answer" : latest === current ? 'Epiphany up to date' : `Epiphany ${latest} out`)
    return { current, latest, how: PORTABLE ? 'portable' : app.isPackaged ? 'installed' : 'dev' }
  }

  const update = async () => {
    if (!PORTABLE && !MAC) return autoUpdater.checkForUpdates().then(() => autoUpdater.downloadUpdate())
    if (process.execPath.includes('/AppTranslocation/')) throw new Error('move Epiphany into Applications first') // run where it was unzipped: Gatekeeper runs a read-only copy
    const asset = latestRelease.assets.find(a => MAC ? a.name.endsWith('-mac.zip') : /^Epiphany[ .][0-9.]+\.exe$/.test(a.name)) // GitHub swaps spaces for dots in asset names
    if (!asset) throw new Error(`no ${MAC ? 'macOS zip' : 'portable exe'} in ` + latestRelease.tag_name)
    const t = task('Downloading ' + asset.name) // until the app quits for it
    const buf = await fetch(asset.browser_download_url).then(r => r.arrayBuffer()).then(Buffer.from).catch(e => { t.end(); throw e })
    if (buf.length !== asset.size) { t.end(); throw new Error('download incomplete') }
    // macOS: Squirrel.Mac takes signed apps only, so the .app is swapped in place. A running app's bundle can be renamed and deleted
    // (its files stay open): the new one moves in before we quit, and app.relaunch starts it. Fetched by us, it carries no quarantine,
    // so Gatekeeper doesn't ask again.
    if (MAC) {
      const APP = path.resolve(process.execPath, '../../..'), nw = APP + '.new', zip = nw + '.zip'
      try { for (const d of [nw, APP + '.old']) fs.rmSync(d, { recursive: true, force: true }); fs.writeFileSync(zip, buf); await new Promise((ok, no) => execFile('ditto', ['-x', '-k', zip, nw], e => e ? no(e) : ok())) }
      catch (e) { t.end(); throw e } finally { fs.rmSync(zip, { force: true }) }
      await idle(t)
      fs.renameSync(APP, APP + '.old')
      fs.renameSync(path.join(nw, 'Epiphany.app'), APP)
      fs.rmSync(APP + '.old', { recursive: true }); fs.rmSync(nw, { recursive: true })
      app.relaunch()
      return app.quit()
    }
    const to = path.join(path.dirname(PORTABLE), 'Epiphany.exe'), nw = to + '.new'
    fs.writeFileSync(nw, buf)
    // After we quit: delete this exe once its launcher lets go (retried for a minute), then the new one becomes Epiphany.exe and
    // starts. Not app.relaunch: its helper runs from the unpacked copy and keeps the launcher from deleting it. The swap outlives us:
    // Node's children die with it (a job object) unless detached, and a detached PowerShell has no console and does nothing. So one
    // PowerShell starts it as its own child, outside the job, and we quit once that is done.
    const q = s => `'${s.replace(/'/g, "''")}'`
    await idle(t) // the swap below can't be called off
    const swap = Buffer.from(`for ($i = 0; $i -lt 60; $i++) { try { Remove-Item -LiteralPath ${q(PORTABLE)} -Force -ErrorAction Stop; break } catch { Start-Sleep 1 } }; Move-Item -LiteralPath ${q(nw)} -Destination ${q(to)} -Force; Start-Process -FilePath ${q(to)}`, 'utf16le').toString('base64')
    await new Promise(r => spawn('powershell.exe', ['-NoProfile', '-Command', `Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-EncodedCommand','${swap}'`], { stdio: 'ignore', windowsHide: true }).on('exit', r))
    app.quit()
  }

  return { checkUpdate, update: () => updateCall ??= update().catch(e => note(`Update: ${e.message}`, true)).finally(() => updateCall = null) }
}
