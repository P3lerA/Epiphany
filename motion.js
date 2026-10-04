// The flight engine: things fly from a recorded pose to where a change put them (FLIP), on the compositor where it can. A flight
// can be taken back mid-air (rewind), and leaves ghosts, copies that fly or fade where something was. See piles.js for the swaps.

// Where something sits: its layout box, the pose a pile gives a print, and whether it wears a print's frame.
/** @type {(el: HTMLElement) => Pose} */
const pose = el => el.classList.contains('print')
  ? { el, box: el.parentElement.getBoundingClientRect(), translate: el.style.translate, rotate: el.style.rotate, frame: true }
  : { el, box: el.getBoundingClientRect(), translate: '0px 0px', rotate: '0deg', frame: el.tagName === 'IMG' ? false : undefined }
const onScreen = ({ box }) => box.width && box.bottom > 0 && box.top < innerHeight
// A keyframe putting something laid out at `box` where pose p shows, or just past the screen edge when p is off it.
const at = (p, box) => {
  const [x = 0, y = 0] = p.translate.split(' ').map(parseFloat), h = p.box.height
  const cy = Math.min(Math.max(p.box.top + h / 2 + y, -h / 2), innerHeight + h / 2)
  return { translate: `${p.box.left + p.box.width / 2 + x - box.left - box.width / 2}px ${cy - box.top - box.height / 2}px`, rotate: p.rotate, scale: p.box.width / box.width }
}
const frame = (p, box) => ({ border: `${p.frame ? 3 * box.width / p.box.width : 0}px solid var(--paper)`, boxShadow: p.frame ? 'var(--print)' : 'none' }) // 3px as it shows, however scaled
// From a to b, for something laid out at box. The move runs on the compositor; the lift over the rest is a class, since z-index
// in the keyframes would pull the move onto the main thread. The frame grows in its own (main-thread) animation.
// ponytail: the frame repaints each flying print every frame (~75fps main thread while flying, the move stays smooth). A print
// built as paper + shadow + picture to keep it on the compositor measured worse: three times the layers.
// A print lifts its whole pile, not itself: flying in, it already lies under the prints above it in that pile.
const lifted = el => el.closest('.pile') ?? el
const fly = (el, a, b, box, o) => {
  lifted(el).classList.add('flying')
  play(el, [at(a, box), at(b, box)], o).finished.then(() => lifted(el).classList.remove('flying'), () => {}) // one by one: all at once stalls a frame
  // A frame grows in the last quarter of the flight, or goes in the first: while it changes, the print repaints every frame, so
  // the rest of the flight stays a move. One flying off the screen keeps its frame: at 4K, 200 frames going at once were most of
  // piles -> grid's cost, for pictures nobody sees land. Coming, only the border grows: the print casts its shadow from the start,
  // lifted (a blur growing was drawn anew every frame, ~270 at once at 4K: grid -> piles stalled as it landed).
  if (a.frame !== undefined && a.frame !== b.frame && (b.frame || onScreen(b))) {
    const d = o.duration * FRAME
    play(el, [frame(a, box), frame(b, box)].map(k => b.frame ? { border: k.border } : k), { ...o, duration: d, delay: (o.delay ?? 0) + (b.frame ? o.duration - d : 0) })
  }
}
const EASE = 'cubic-bezier(.2, 0, 0, 1)'
const FRAME = .25 // the share of a flight a print's frame takes to come or go (fly)
let SLOW = 1 // slow motion for looking closely: Settings > General > Animation speed, in debug mode
// The swap still in the air: its animations, the ghosts it left, and the change, to take it back when piles are toggled again.
/** @type {Flight?} */ let flight = null
/** @type {Flight?} */ let air = null // set only while a swap records its animations
const play = (el, keys, o) => { const a = el.animate(keys, o); a.playbackRate = 1 / SLOW; air?.anims.push(a); return a }
const settle = f => { const gen = f.gen = (f.gen ?? 0) + 1; Promise.all(f.anims.map(a => a.finished)).then(() => f.gen === gen && land(f), () => {}) }
const land = (f, now) => {
  f.gen = NaN // a settle still waiting must not land it again: finish() resolves what it waits on, and a take-back undone twice is redone
  if (now) f.anims.forEach(a => a.finish())
  if (f.dir < 0) { const sec = f.root.closest('section'); f.change(); sec.scrollTop = f.top; tops.set(sec, f.top) } // back where it started: undo the change under the held poses, on its own page
  f.ghosts.remove() // in one go, before their animations are cancelled: one by one, at 4K, they were half the landing frame
  for (const a of f.anims) if (a.effect.getTiming().fill !== 'backwards') { a.cancel(); lifted(a.effect.target).classList.remove('flying') } // the rest ended holding nothing
  if (flight === f) flight = null
}
// Toggled again mid-flight: everything turns around from where it is and eases back (a reversed ease-out would slam home).
const rewind = () => {
  const f = flight
  f.dir *= -1
  const turns = f.anims.map(a => { // read every pose before cancelling any: one style pass, not one per animation
    const keys = a.effect.getKeyframes(), end = { ...keys[f.dir < 0 ? 0 : keys.length - 1] }, cs = getComputedStyle(a.effect.target)
    for (const k of ['offset', 'computedOffset', 'easing', 'composite']) delete end[k]
    return [a.effect.target, Object.fromEntries(Object.keys(end).map(p => [p, cs[p]])), end]
  })
  f.anims.forEach(a => a.cancel())
  f.anims = turns.map(([el, now, end]) => play(el, [now, end], { duration: 450, easing: EASE, fill: 'forwards' }))
  settle(f)
}
const calm = matchMedia('(prefers-reduced-motion: reduce)')
const ghosts = $('main').insertAdjacentElement('afterend', Object.assign(document.createElement('div'), { id: 'ghosts' }))
let ghostsTop = 0 // read once per swap: reading it per ghost laid the page out once per ghost
// A copy left where something was: it flies to `to` and lies over what is there (the same picture) until the flight lands, or with
// nowhere to go fades in place. Not faded out on landing: a zero-length step after a delay runs on the main thread, and ticked
// every frame while it waited.
const ghost = (a, to, bare, d = 0) => {
  const g = a.el.cloneNode(!bare)
  g.hidden = false // a picture a filter just hid still fades where it was
  bare ? air.ghosts.prepend(g) : air.ghosts.append(g) // a pile's label under the flying prints
  if (bare) g.append(a.el.firstElementChild.cloneNode(false), a.el.lastElementChild.cloneNode(true)) // a pile leaving with the view: its label, over its empty place; the prints fly on their own
  // Laid out where it lands: a layer is rastered at the size it starts at, so a print's copy flying to a grid spot twice its size
  // blurred up all the way and sharpened at once when the flight landed.
  const box = to?.box ?? a.box
  Object.assign(g.style, { position: 'absolute', margin: 0, left: box.left + 'px', top: box.top - ghostsTop + 'px', width: box.width + 'px', height: box.height + 'px', translate: a.translate, rotate: a.rotate })
  if (to) fly(g, a, to, box, { duration: 650, delay: d, easing: EASE, fill: 'both' })
  else play(g, [{ opacity: 1 }, { opacity: 0, scale: .96 }], { duration: 250, easing: EASE, fill: 'both' })
  return g
}
