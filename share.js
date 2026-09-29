// Share: one picture as a line of text, for another Epiphany's Ctrl+V to pull and fill in the same way. The line is its source
// link (so it still reads as one to anyone else), then an epiphany: code holding the source and what was written by hand: Edit's
// fields and the tags. A pasted code is someone else's text: only strings of the known fields come through.
const PREFIX = 'epiphany:', FIELDS = ['quality', 'copyright', 'character', 'artist']

// at: { page, range?, src?, name? }: where to get it (range: which of the page's pictures; src: an image saved by right-click;
// name: to find it among a page's several).
const make = (at, edit, tags) => `${at.page} ${PREFIX}${Buffer.from(JSON.stringify({ ...at, edit, tags })).toString('base64url')}` // tags: only when written by hand

const read = text => (text.match(/epiphany:[\w-]+/g) ?? []).flatMap(code => {
  let s
  try { s = JSON.parse(Buffer.from(code.slice(PREFIX.length), 'base64url')) } catch { return [] }
  if (typeof s?.page !== 'string') return []
  const str = v => typeof v === 'string' ? v : undefined
  return [{ page: s.page, range: /^\d+$/.test(s.range) ? s.range : undefined, src: str(s.src), name: str(s.name), tags: str(s.tags),
    edit: Object.fromEntries(FIELDS.filter(k => typeof s.edit?.[k] === 'string').map(k => [k, s.edit[k]])) }]
})

module.exports = { make, read }

if (require.main === module) {
  const assert = require('assert')
  const line = make({ page: 'https://a.test/p/1', name: 'a_1.png' }, { character: 'hatsune_miku' }, '1girl, smile')
  assert.match(line, /^https:\/\/a\.test\/p\/1 epiphany:[\w-]+$/)
  assert.deepEqual(read(`look: ${line}, thanks`), [{ page: 'https://a.test/p/1', range: undefined, src: undefined, name: 'a_1.png', tags: '1girl, smile', edit: { character: 'hatsune_miku' } }])
  assert.equal(read(make({ page: 'https://a.test', range: '1-50; rm' }))[0].range, undefined)
  assert.equal(read(make({ page: 'https://a.test', range: '3' }))[0].range, '3')
  const odd = 'epiphany:' + Buffer.from(JSON.stringify({ page: 'https://a.test', edit: { artist: 1, evil: 'x', quality: 'masterpiece' }, tags: {} })).toString('base64url')
  assert.deepEqual(read(odd)[0].edit, { quality: 'masterpiece' })
  assert.equal(read(odd)[0].tags, undefined)
  assert.deepEqual(read('epiphany:!!! epiphany:bm90IGpzb24'), [])
  console.log('ok')
}
