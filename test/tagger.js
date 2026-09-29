// The tagger module outside the app: npx electron test/tagger.js [models dir, to run the model too]
const { app } = require('electron')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Tagger = require('../tagger')

app.whenReady().then(async () => {
  // Thresholds per category, most sure first, one artist, the likeliest rating as a word.
  const t = Tagger(os.tmpdir())
  const p = t.post({ general: { a: .9, b: .39, c: .5 }, style: { x: .3, z: .6 }, character: { y: .45 }, rating: { 'rating:g': .2, 'rating:s': .7 } })
  assert.equal(p.tag_string_general, 'a c'); assert.equal(p.tag_string_artist, 'z'); assert.equal(p.tag_string_character, ''); assert.equal(p.rating, 'sensitive')

  // WebP (not nativeImage's) through the thumbnailer: 8x4, left half red (the clear right half depends on its cache). Letterboxed black.
  const x = await Tagger.pixels(path.join(__dirname, 'half.webp')), S = 1008, at = (c, px, py) => x[c * S * S + py * S + px]
  assert.deepEqual([0, 1, 2].map(c => at(c, 500, 10)), [-1, -1, -1]) // above the 1008x504 picture
  assert.deepEqual([0, 1, 2].map(c => Math.round(at(c, 200, 504))), [1, -1, -1]) // red

  // A failed download fails the install and leaves no model behind.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tagger-')), f = Tagger(dir), real = fetch
  globalThis.fetch = async () => new Response('', { status: 503 })
  await assert.rejects(f.install(() => {}), /503 model.onnx/)
  assert.equal(f.has(), false)
  globalThis.fetch = real
  fs.rmSync(dir, { recursive: true })

  // The model itself, when a models dir with it is given: every category comes back, the rating always.
  const models = process.argv.find(a => fs.existsSync(path.join(a, 'pixai-tagger-v1.0-fp16', 'model.onnx')))
  if (models) {
    const g = await Tagger(models).guess(path.join(__dirname, 'half.webp'))
    for (const c of ['general', 'character', 'copyright', 'style', 'meta', 'rating']) assert.ok(g[c], c)
    assert.equal(Object.keys(g.rating).length, 4)
  }
  console.log(models ? 'ok (with the model)' : 'ok')
  app.exit()
}).catch(e => { console.error(e); app.exit(1) })
