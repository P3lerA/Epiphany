// The library's old layout to its new one, when Settings > General's button says so (0.1.2 only; until then an old project shows
// empty, and what is pulled meanwhile already goes the new way). Its pictures sat in <name>/dataset with their sidecars,
// captions and meta.jsonl, its thumbnails in <name>/thumbs. Now the pictures are the project folder itself, and what Epiphany keeps
// about them is in <name>/.epiphany. Cut off anywhere, the next start finishes it: dataset/ goes last, and nothing is moved over
// what is already there (it stays where it was).
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')

module.exports = proj => {
  for (const name of fs.existsSync(proj) ? fs.readdirSync(proj) : []) try {
    const dir = path.join(proj, name), old = path.join(dir, 'dataset'), own = path.join(dir, '.epiphany')
    if (!fs.existsSync(old)) continue
    const move = (from, to) => fs.existsSync(from) && !fs.existsSync(to) && fs.renameSync(from, to)
    if (!fs.existsSync(own)) { fs.mkdirSync(own); if (process.platform === 'win32') execFile('attrib', ['+h', own], () => {}) } // hidden, as main.js makes them
    move(path.join(dir, 'thumbs'), path.join(own, 'thumbs'))
    for (const f of fs.readdirSync(old)) if (f !== 'meta.jsonl') move(path.join(old, f), path.join(/\.(json|txt)$/.test(f) ? own : dir, f))
    // meta.jsonl's paths rebased by their folder's name, not the old path: a library copied from elsewhere (or from the other OS)
    // comes out right too. One begun meanwhile (pulled to before the move; a picture that reached the root, its placeholder from
    // list()) adds its lines for the pictures the old one doesn't name: the old record wins. Written whole, then the old one goes:
    // cut off between, the next run writes the same again.
    const meta = path.join(old, 'meta.jsonl'), META = path.join(own, 'meta.jsonl'), tmp = META + '.tmp'
    if (fs.existsSync(meta)) {
      const rebase = l => {
        try { const o = JSON.parse(l), [file, parent] = o.file.split(/[\\/]/).reverse(); return parent === 'dataset' ? JSON.stringify({ ...o, file: path.join(dir, file) }) : l } catch { return l }
      }
      const key = l => { try { return JSON.parse(l).file } catch { return l } } // a line that isn't JSON is kept, once
      const lines = fs.readFileSync(meta, 'utf8').split('\n').filter(Boolean).map(rebase), named = new Set(lines.map(key))
      const added = fs.existsSync(META) ? fs.readFileSync(META, 'utf8').split('\n').filter(l => l && !named.has(key(l))) : []
      fs.writeFileSync(tmp, [...lines, ...added].map(l => l + '\n').join('')); fs.renameSync(tmp, META); fs.rmSync(meta)
    }
    try { fs.rmdirSync(old) } catch {} // something left (its name taken): it stays, and so does dataset/
  } catch (e) { console.error(`migrate ${name}: ${e.message}`) }
}
