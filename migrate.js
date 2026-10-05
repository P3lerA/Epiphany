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
    // Captions first, while their pictures are beside them: x.txt was x.jpg's and x.png's alike, now each picture has its own, named
    // as its sidecar is (x.jpg.txt). Copied to all but one, moved to that one: cut off between, the next run copies what isn't there.
    // One no picture has goes as it is.
    const files = fs.readdirSync(old).sort(), stem = f => f.replace(/\.[^.]+$/, '')
    for (const t of files.filter(f => f.endsWith('.txt'))) {
      const to = files.filter(f => !/\.(jsonl?|txt)$/.test(f) && stem(f) === stem(t)).map(f => f + '.txt')
      for (const f of to.slice(0, -1)) if (!fs.existsSync(path.join(own, f))) fs.copyFileSync(path.join(old, t), path.join(own, f))
      move(path.join(old, t), path.join(own, to.at(-1) ?? t))
    }
    for (const f of fs.readdirSync(old)) if (f !== 'meta.jsonl' && !f.endsWith('.txt')) move(path.join(old, f), path.join(f.endsWith('.json') ? own : dir, f))
    // meta.jsonl's lines name their pictures (main.js), a path kept by an old one read as its name: a library copied from elsewhere
    // (or from the other OS) comes out right too. One begun meanwhile (pulled to before the move; a picture that reached the root,
    // its placeholder from list()) adds its lines for the pictures the old one doesn't name: the old record wins. Written whole, then
    // the old one goes: cut off between, the next run writes the same again.
    const meta = path.join(old, 'meta.jsonl'), META = path.join(own, 'meta.jsonl'), tmp = META + '.tmp'
    if (fs.existsSync(meta)) {
      const pic = l => { try { return path.win32.basename(JSON.parse(l).file) } catch {} }, key = l => pic(l) ?? l // a line that isn't JSON is kept, once
      const lines = fs.readFileSync(meta, 'utf8').split('\n').filter(Boolean).map(l => pic(l) ? JSON.stringify({ ...JSON.parse(l), file: pic(l) }) : l), named = new Set(lines.map(key))
      const added = fs.existsSync(META) ? fs.readFileSync(META, 'utf8').split('\n').filter(l => l && !named.has(key(l))) : []
      fs.writeFileSync(tmp, [...lines, ...added].map(l => l + '\n').join('')); fs.renameSync(tmp, META); fs.rmSync(meta)
    }
    try { fs.rmdirSync(old) } catch {} // something left (its name taken): it stays, and so does dataset/
  } catch (e) { console.error(`migrate ${name}: ${e.message}`) }
}
