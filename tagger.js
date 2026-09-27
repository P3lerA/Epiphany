// Tagger, for pictures no booru has: PixAI tagger v1.0 as fp16 ONNX (our copy, pinned), on the GPU through WebGPU. DirectML
// can't load it, and a CPU crawls through it. Lives in <models>/pixai-tagger-v1.0-fp16, installed from Settings > Instruments.
// The model only: main.js writes what it guesses into sidecars and captions.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { Readable } = require('stream')
const { pipeline } = require('stream/promises')
const { nativeImage } = require('electron')

const NAME = 'pixai-tagger-v1.0-fp16'
const BASE = 'https://huggingface.co/A1yCE/pixai-tagger-v1.0-onnx-fp16/resolve/10a70bc4fc002fdc5b9378be1068faa71cf61203/'
const FILES = { 'model.onnx': 'c5157c2037e71022a04e4a217af77400183dac34b7da1587727f3e089c087123', 'tags.json': '0d34f2078016798808dc066dc206b18fb6ce7622f64241002ecd24172a4da068' }
// Thresholds per category, fitted for fp16 on 398 recent posts of four boorus against their own tags. style = artist; meta only
// feeds the AI-generated check. ponytail: fixed here; make them settings if captions come out too long or too sparse.
const AT = { general: .4, character: .5, copyright: .6, style: .25, meta: .4 }
const SIDE = 1008

// The guess as a post, so info/meta/caption read it like any booru's. Guesses keep probabilities >= .1, so thresholds can change later.
const above = (t, c) => Object.entries(t[c] ?? {}).filter(([, p]) => p >= AT[c]).sort((a, b) => b[1] - a[1]).map(([k]) => k).join(' ')
const post = t => {
  const r = Object.entries(t.rating ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0].slice(-1) // rating:g/s/q/e
  return { tag_string_general: above(t, 'general'), tag_string_character: above(t, 'character'), tag_string_copyright: above(t, 'copyright'),
    tag_string_artist: above(t, 'style'), tag_string_meta: above(t, 'meta'), rating: { g: 'general', s: 'sensitive', q: 'questionable', e: 'explicit' }[r] ?? '' }
}

// The picture as the model takes it: RGB over white, letterboxed with black to 1008 square, scaled to -1..1, planar. nativeImage
// reads PNG and JPEG; anything else (WebP, GIF, AVIF) goes through Windows' thumbnailer, already fitted to the square.
const pixels = async file => {
  let img = nativeImage.createFromPath(file)
  if (img.isEmpty()) img = await nativeImage.createThumbnailFromPath(file, { width: SIDE, height: SIDE }).catch(() => img)
  if (img.isEmpty()) throw new Error(`can't read ${path.basename(file)}`)
  const { width: w, height: h } = img.getSize(), k = Math.min(SIDE / w, SIDE / h), nw = Math.max(1, Math.floor(w * k)), nh = Math.max(1, Math.floor(h * k))
  const bmp = img.resize({ width: nw, height: nh, quality: 'best' }).toBitmap() // BGRA, premultiplied
  const x = new Float32Array(3 * SIDE * SIDE).fill(-1), plane = SIDE * SIDE, ox = (SIDE - nw) >> 1, oy = (SIDE - nh) >> 1
  for (let y = 0; y < nh; y++) for (let i = 0; i < nw; i++) {
    const p = (y * nw + i) * 4, a = 255 - bmp[p + 3], o = (oy + y) * SIDE + ox + i
    x[o] = (bmp[p + 2] + a) / 127.5 - 1; x[plane + o] = (bmp[p + 1] + a) / 127.5 - 1; x[2 * plane + o] = (bmp[p] + a) / 127.5 - 1
  }
  return x
}

module.exports = models => {
  const dir = path.join(models, NAME)
  const has = () => Object.keys(FILES).every(f => fs.existsSync(path.join(dir, f)))
  // One session, loaded on first use; ~3GB of GPU memory goes back two minutes after the last picture.
  let session, idle
  const load = () => session ??= (async () => {
    const ort = require('onnxruntime-node')
    const s = await ort.InferenceSession.create(path.join(dir, 'model.onnx'), { executionProviders: ['webgpu'], intraOpNumThreads: 1, extra: { session: { intra_op: { allow_spinning: '0' } } } })
    return { ort, s, cats: JSON.parse(fs.readFileSync(path.join(dir, 'tags.json'), 'utf8')).categories }
  })().catch(e => { session = null; throw e })
  const release = () => { clearTimeout(idle); session?.then(t => t.s.release(), () => {}); session = null }
  // A picture's guess: per category, each tag's probability (>= .1; every rating).
  const guess = async file => {
    clearTimeout(idle)
    const { ort, s, cats } = await load()
    const logits = (await s.run({ pixel_values: new ort.Tensor('float32', await pixels(file), [1, 3, SIDE, SIDE]) })).logits.data
    clearTimeout(idle) // another picture's run may have ended meanwhile: one timer, from the last
    idle = setTimeout(release, 120000)
    const t = { model: NAME }
    for (const c of cats) {
      const m = t[c.name] = {}
      c.tags.forEach((tag, i) => { const p = 1 / (1 + Math.exp(-logits[c.offset + i])); if (p >= .1 || c.name === 'rating') m[tag] = +p.toFixed(3) })
    }
    return t
  }
  // Download, checked against the pinned hashes; progress(percent) along the big file. Stalled a minute: it fails, and can be tried again.
  const install = async progress => {
    fs.mkdirSync(dir, { recursive: true })
    for (const [f, sha] of Object.entries(FILES)) {
      const ac = new AbortController(), part = path.join(dir, f + '.part'), hash = crypto.createHash('sha256')
      let stall
      const alive = () => { clearTimeout(stall); stall = setTimeout(() => ac.abort(new Error('download stalled')), 60000) }
      try {
        alive()
        const r = await fetch(BASE + f, { signal: ac.signal })
        if (!r.ok) throw new Error(`${r.status} ${f}`)
        const total = Number(r.headers.get('content-length'))
        let got = 0, shown = 0
        await pipeline(Readable.fromWeb(r.body), async function* (src) {
          for await (const c of src) { alive(); hash.update(c); got += c.length; if (total > 1e7 && got / total * 100 >= shown + 1) progress(++shown); yield c }
        }, fs.createWriteStream(part))
      } finally { clearTimeout(stall) }
      if (hash.digest('hex') !== sha) { fs.rmSync(part); throw new Error(`${f}: checksum mismatch`) }
      fs.renameSync(part, path.join(dir, f))
    }
  }
  const remove = () => { release(); fs.rmSync(dir, { recursive: true, force: true }) } // a download, not the user's data
  return { has, guess, post, install, remove }
}
module.exports.pixels = pixels // for test/tagger.js
