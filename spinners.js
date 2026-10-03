// The task line's spinner: 4x4 dots (style.css), the icon's grid made small. name: [ms per frame, frames], a frame the dots it lights,
// 0-15 row by row. spinner(el) plays a random one in el and returns its stop.
const RING = [0, 1, 2, 3, 7, 11, 15, 14, 13, 12, 8, 4], SPIRAL = [...RING, 5, 6, 10, 9], ALL = [...Array(16).keys()]
const SPINNERS = {
  snake: [100, RING.map((_, k) => [0, 1, 2].map(j => RING[(k + 12 - j) % 12]))], // three dots round the edge
  spiral: [70, [...SPIRAL.map((_, k) => SPIRAL.slice(0, k + 1)), ...SPIRAL.map((_, k) => SPIRAL.slice(k + 1))]], // fills inwards, empties after itself
  scan: [140, [0, 1, 2, 3, 2, 1].map(r => [0, 1, 2, 3].map(c => r * 4 + c))], // a row down and back
  wave: [110, [...Array(8).keys()].map(k => ALL.filter(i => [k, k - 1].includes((i >> 2) + (i & 3))))], // a band across, corner to corner
  quads: [220, [[0, 1, 4, 5], [2, 3, 6, 7], [10, 11, 14, 15], [8, 9, 12, 13]]], // the icon's four squares in turn
  pulse: [260, [[5, 6, 9, 10], RING, []]] // the middle, then the edge
}
const spinner = el => {
  const [ms, frames] = Object.values(SPINNERS)[Math.random() * Object.keys(SPINNERS).length | 0]
  const dots = ALL.map(() => document.createElement('i')), show = f => dots.forEach((d, i) => d.classList.toggle('on', f.includes(i)))
  el.replaceChildren(...dots)
  el.style.setProperty('--dot', Math.round(2 * devicePixelRatio) / devicePixelRatio + 'px') // whole device pixels: at 175% 2px dots blur into ovals
  let k = 0
  show(frames[0])
  if (calm.matches) return () => {} // motion off: its first frame, still
  const t = setInterval(() => show(frames[++k % frames.length]), ms)
  return () => clearInterval(t)
}
