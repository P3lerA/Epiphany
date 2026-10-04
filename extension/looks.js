// What the app and its extension both show, loaded by each (index.html; the extension's pages, content script and worker): the
// task spinner, 4x4 dots (the icon's grid made small), the faces of an empty page, and the ✕ of a stop. A pull carries its spinner's name (anim) from
// the extension to the app's task line. SPINNERS name: [ms per frame, frames], a frame the dots it lights, 0-15 row by row.
const RING = [0, 1, 2, 3, 7, 11, 15, 14, 13, 12, 8, 4], SPIRAL = [...RING, 5, 6, 10, 9], ALL = [...Array(16).keys()]
const SPINNERS = {
  snake: [100, RING.map((_, k) => [0, 1, 2].map(j => RING[(k + 12 - j) % 12]))], // three dots round the edge
  spiral: [70, [...SPIRAL.map((_, k) => SPIRAL.slice(0, k + 1)), ...SPIRAL.map((_, k) => SPIRAL.slice(k + 1))]], // fills inwards, empties after itself
  scan: [140, [0, 1, 2, 3, 2, 1].map(r => [0, 1, 2, 3].map(c => r * 4 + c))], // a row down and back
  wave: [110, [...Array(8).keys()].map(k => ALL.filter(i => [k, k - 1].includes((i >> 2) + (i & 3))))], // a band across, corner to corner
  quads: [220, [[0, 1, 4, 5], [2, 3, 6, 7], [10, 11, 14, 15], [8, 9, 12, 13]]], // the icon's four squares in turn
  pulse: [260, [[5, 6, 9, 10], RING, []]] // the middle, then the edge
}
const FACES = ['(・_・)', '(´・ω・`)', '(・∀・)', '(￣▽￣)', '(°ー°〃)', '(´-ω-`)', '(・ε・)', '(o_O)', '(>_<)', '( ˘ω˘ )', 'ヽ(・∀・)ﾉ', '(ﾟДﾟ)', '(=^・ω・^=)', '¯\\_(ツ)_/¯', '(っ´ω`c)', '(・・?)']
const anyOf = list => list[Math.random() * list.length | 0]
// Plays spinner name (any, when not given) in el as 16 <i>, lit by the class on; returns its stop.
const spinner = (el, name = anyOf(Object.keys(SPINNERS))) => {
  const [ms, frames] = SPINNERS[Object.hasOwn(SPINNERS, name) ? name : 'snake'] // a name from a request is checked, not trusted
  const dots = ALL.map(() => document.createElement('i')), show = f => dots.forEach((d, i) => d.classList.toggle('on', f.includes(i)))
  el.replaceChildren(...dots)
  el.style.setProperty('--dot', Math.round(2 * devicePixelRatio) / devicePixelRatio + 'px') // whole device pixels: at 175% 2px dots blur into ovals
  el.style.setProperty('--frame', ms + 'ms') // each dot fades over a frame: smooth, not stop-motion (the UI around it is)
  let k = 0
  show(frames[0])
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {} // motion off: its first frame, still
  const t = setInterval(() => show(frames[++k % frames.length]), ms)
  return () => clearInterval(t)
}
// The task line's ✕ (index.html has its own copy), for the extension's panel and Pull button: an icon with round ends, not a glyph
// thinner than the text beside it. Built with DOM calls: a site's CSP can refuse innerHTML in the Pull button.
const cross = () => {
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'), path = document.createElementNS(ns, 'path')
  for (const [k, v] of Object.entries({ width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round' })) svg.setAttribute(k, v)
  path.setAttribute('d', 'M6 6l12 12M18 6 6 18')
  svg.append(path)
  return svg
}
