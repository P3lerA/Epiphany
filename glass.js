// The toolbar's Liquid Glass (style.css .fab): each piece bends what scrolls under it near its rim, as a lens would. Per piece, a
// displacement map drawn from its rounded-rect distance field drives the SVG filter its backdrop-filter runs (--lens), red, green
// and blue bent a little apart; a second map is the rim's highlight (--rim). Both are baked for the piece's size, corner and the
// screen's pixel ratio, so they are redrawn when it changes size or the window changes screens. After kube.io's "Liquid Glass in
// the browser" (the bezel's profile through Snell's law) and rdev/liquid-glass-react (the colour split).
const GLASS = { refraction: 18, aberration: .05, edge: 7, highlight: .12 }

// How far a vertical ray is bent at t across the bezel (0 at the rim, 1 where it meets the flat top), 1 at the rim: a squircle
// bezel h = (1 - (1 - t)^4)^(1/4), glass of index 1.5 twice as thick as the bezel is wide.
const bend = th => Math.tan(th - Math.asin(Math.sin(th) / 1.5))
const profile = t => { const u = 1 - t; return bend(Math.atan(2 * u ** 3 / Math.max(1e-6, 1 - u ** 4) ** .75)) / bend(Math.PI / 2) }

// The two maps of a w x h piece with corner r at s device pixels per px: R, G the offset its backdrop is sampled at (128 none,
// inward along the normal: a convex lens, and the backdrop only reaches as far as the piece); white, as opaque as the rim catches
// a light from the top left.
const lensMaps = (w, h, r, s) => {
  const W = Math.round(w * s), H = Math.round(h * s), bezel = Math.min(GLASS.edge, w / 2, h / 2)
  const [map, rim] = [0, 0].map(() => Object.assign(document.createElement('canvas'), { width: W, height: H }))
  const M = new ImageData(W, H), R = new ImageData(W, H)
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const px = (i + .5) / s - w / 2, py = (j + .5) / s - h / 2
    const qx = Math.abs(px) - (w / 2 - r), qy = Math.abs(py) - (h / 2 - r)
    let nx, ny, d // the outward normal, how far inside the edge
    if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy); nx = qx / l; ny = qy / l; d = r - l }
    else if (qx > qy) { nx = 1; ny = 0; d = r - qx } else { nx = 0; ny = 1; d = r - qy }
    nx *= Math.sign(px) || 1; ny *= Math.sign(py) || 1
    const m = d < bezel ? profile(Math.max(0, d) / bezel) : 0, o = (j * W + i) * 4
    M.data.set([128 - 127 * nx * m, 128 - 127 * ny * m, 128, 255], o)
    const lit = .25 + .75 * Math.abs(-.6 * nx - .8 * ny) ** 2
    R.data.set([255, 255, 255, 255 * Math.min(1, GLASS.highlight * lit * (Math.min(1, Math.max(0, 1.4 - d)) * .9 + .35 * Math.exp(-d / 2.5)))], o)
  }
  map.getContext('2d').putImageData(M, 0, 0); rim.getContext('2d').putImageData(R, 0, 0)
  return [map.toDataURL(), rim.toDataURL()]
}

const lensDefs = document.body.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'))
lensDefs.style.cssText = 'position: absolute; width: 0; height: 0' // not the attribute: the CSP drops inline style attributes
const only = c => [0, 1, 2].map(k => [0, 1, 2, 3, 4].map(x => +(x === k && k === c)).join(' ')).join(' ') + ' 0 0 0 1 0' // keeps channel c
const lens = (el, n) => {
  const w = el.offsetWidth, h = el.offsetHeight
  if (!w) return // hidden (the debug reload button)
  const r = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius), w / 2, h / 2), [map, rim] = lensMaps(w, h, r, devicePixelRatio)
  const split = c => `<feDisplacementMap in="SourceGraphic" in2="map" scale="${2 * GLASS.refraction * (1 + (c - 1) * GLASS.aberration)}" xChannelSelector="R" yChannelSelector="G"/><feColorMatrix values="${only(c)}" result="c${c}"/>`
  lensDefs.querySelector(`#lens${n}`)?.remove()
  lensDefs.insertAdjacentHTML('beforeend', `<filter id="lens${n}" filterUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}" color-interpolation-filters="sRGB">
    <feImage href="${map}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="map"/>${split(0)}${split(1)}${split(2)}
    <feBlend in="c0" in2="c1" mode="screen"/><feBlend in2="c2" mode="screen"/></filter>`)
  el.style.setProperty('--lens', `url(#lens${n})`)
  el.style.setProperty('--rim', `url(${rim})`)
}
const pieces = [...$('.fab').children]
const reshaped = new ResizeObserver(l => l.forEach(e => lens(e.target, pieces.indexOf(e.target))))
pieces.forEach(p => reshaped.observe(p))
const moved = () => matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', () => { pieces.forEach(lens); moved() }, { once: true })
moved()
