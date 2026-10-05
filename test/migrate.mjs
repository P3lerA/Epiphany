// migrate.js on a made-up library in a temp folder: node test/migrate.mjs
import fs from 'fs'
import os from 'os'
import path from 'path'
import assert from 'assert'
import { createRequire } from 'module'
const migrate = createRequire(import.meta.url)('../migrate.js')

const PROJ = fs.mkdtempSync(path.join(os.tmpdir(), 'epiphany-migrate-'))
const put = (f, s) => { f = path.join(PROJ, f); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s) }
const line = (file, page) => JSON.stringify({ file, src: `https://example.test/${page}`, page, time: 1700000000 + page })
// every file and folder under PROJ: { 'a/x.jpg': its text, 'a/.epiphany': null }
const tree = () => Object.fromEntries(fs.readdirSync(PROJ, { recursive: true }).map(f => {
  const p = path.join(PROJ, f)
  return [f.split(path.sep).join('/'), fs.statSync(p).isDirectory() ? null : fs.readFileSync(p, 'utf8')]
}))

// a: the old layout, its meta.jsonl written somewhere else (a copied library, a line from the Mac), a line that isn't JSON; a
// caption two pictures shared, one no picture has
put('a/dataset/x.jpg', 'x'); put('a/dataset/x.jpg.json', '{"x":1}'); put('a/dataset/x.txt', 'cap'); put('a/dataset/y.png', 'y')
put('a/dataset/y.jpg', 'y2'); put('a/dataset/y.txt', 'both'); put('a/dataset/z.txt', 'orphan')
put('a/dataset/meta.jsonl', [line('C:/elsewhere/project/a/dataset/x.jpg', 1), line('/Users/someone/project/a/dataset/y.png', 2), '{', ''].join('\n'))
put('a/thumbs/x.jpg.sq.jpg', 't')
// b: already the new layout
put('b/x.jpg', 'x'); put('b/.epiphany/x.jpg.json', '{}'); put('b/.epiphany/thumbs/x.jpg.sq.jpg', 't')
put('b/.epiphany/meta.jsonl', line(path.join(PROJ, 'b', 'x.jpg'), 1) + '\n')
// c: cut off halfway
put('c/x.jpg', 'x'); put('c/.epiphany/x.jpg.json', '{}'); put('c/dataset/y.png', 'y')
put('c/dataset/meta.jsonl', [line(path.join(PROJ, 'c', 'dataset', 'x.jpg'), 1), line(path.join(PROJ, 'c', 'dataset', 'y.png'), 2)].join('\n'))
// d: pulled to before the move, its new meta.jsonl beside the old one
put('d/new.jpg', 'n'); put('d/.epiphany/meta.jsonl', line(path.join(PROJ, 'd', 'new.jpg'), 3) + '\n')
put('d/dataset/old.jpg', 'o'); put('d/dataset/meta.jsonl', line(path.join(PROJ, 'd', 'dataset', 'old.jpg'), 4) + '\n')
// e: a Move cut off midway, then a start: list() wrote a placeholder for the picture that reached the root, its record still in the old one
const e = f => path.join(PROJ, 'e', f), placeholder = JSON.stringify({ file: 'x.jpg', src: 'file:///x.jpg', page: 'file:///x.jpg', time: '2026-01-01' })
put('e/x.jpg', 'x'); put('e/.epiphany/meta.jsonl', placeholder + '\n' + line(e('new.jpg'), 6) + '\n')
put('e/dataset/meta.jsonl', line(path.join(PROJ, 'e', 'dataset', 'x.jpg'), 5) + '\n')
// f: cut off copying a shared caption: one picture has its copy, the other not yet
put('f/dataset/p.jpg', 'p'); put('f/dataset/p.png', 'p2'); put('f/dataset/p.txt', 'cap'); put('f/.epiphany/p.jpg.txt', 'cap')

const b = Object.fromEntries(Object.entries(tree()).filter(([f]) => f.startsWith('b')))
migrate(PROJ)
const once = tree()
assert.deepStrictEqual(once, {
  a: null, 'a/x.jpg': 'x', 'a/y.png': 'y', 'a/y.jpg': 'y2',
  'a/.epiphany': null, 'a/.epiphany/x.jpg.json': '{"x":1}', 'a/.epiphany/x.jpg.txt': 'cap',
  'a/.epiphany/y.jpg.txt': 'both', 'a/.epiphany/y.png.txt': 'both', 'a/.epiphany/z.txt': 'orphan', // each its own; none's as it was
  'a/.epiphany/thumbs': null, 'a/.epiphany/thumbs/x.jpg.sq.jpg': 't',
  'a/.epiphany/meta.jsonl': [line('x.jpg', 1), line('y.png', 2), '{', ''].join('\n'), // names; garbage kept
  ...b,
  c: null, 'c/x.jpg': 'x', 'c/y.png': 'y', 'c/.epiphany': null, 'c/.epiphany/x.jpg.json': '{}',
  'c/.epiphany/meta.jsonl': [line('x.jpg', 1), line('y.png', 2), ''].join('\n'),
  d: null, 'd/new.jpg': 'n', 'd/old.jpg': 'o', 'd/.epiphany': null,
  'd/.epiphany/meta.jsonl': line('old.jpg', 4) + '\n' + line(path.join(PROJ, 'd', 'new.jpg'), 3) + '\n', // merged
  e: null, 'e/x.jpg': 'x', 'e/.epiphany': null,
  'e/.epiphany/meta.jsonl': line('x.jpg', 5) + '\n' + line(e('new.jpg'), 6) + '\n', // the record, not the placeholder
  f: null, 'f/p.jpg': 'p', 'f/p.png': 'p2', 'f/.epiphany': null, 'f/.epiphany/p.jpg.txt': 'cap', 'f/.epiphany/p.png.txt': 'cap',
})
migrate(PROJ)
assert.deepStrictEqual(tree(), once)
fs.rmSync(PROJ, { recursive: true })
console.log('ok')
