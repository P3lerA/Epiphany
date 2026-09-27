// The flight engine: things fly from a recorded pose to where a change put them (FLIP), on the compositor where it can. A flight
// can be taken back mid-air (rewind), and leaves ghosts, copies that fly or fade where something was. See piles.js for the swaps.

// Where something sits: its layout box, the pose a pile gives a print, and whether it wears a print's frame.
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
const frame = p => ({ border: `${p.frame ? 3 : 0}px solid var(--paper)`, boxShadow: p.frame ? 'var(--print)' : 'none' })
// From a to b, for something laid out at box. The move runs on the compositor; the lift over the rest is a class, since z-index
// in the keyframes would pull the move onto the main thread. The frame grows in its own (main-thread) animation.
// ponytail: the frame repaints each flying print every frame (~75fps main thread while flying, the move stays smooth). A print
// built as paper + shadow + picture to keep it on the compositor measured worse: three times the layers.
// A print lifts its whole pile, not itself: flying in, it already lies under the prints above it in that pile.
const lifted = el => el.closest('.pile') ?? el
const fly = (el, a, b, box, o) => {
  lifted(el).classList.add('flying')
  play(el, [at(a, box), at(b, box)], o).finished.then(() => lifted(el).classList.remove('flying'), () => {}) // one by one: all at once stalls a frame
  if (a.frame !== undefined && a.frame !== b.frame) play(el, [frame(a), frame(b)], o)
}
const EASE = 'cubic-bezier(.2, 0, 0, 1)'
const SLOW = 1 // slow motion, for looking closely; 1 is normal speed
// The swap still in the air: its animations, the ghosts it left, and the change, to take it back when piles are toggled again.
let flight = null, air = null
const play = (el, keys, o) => { const a = el.animate(keys, o); a.playbackRate = 1 / SLOW; air?.anims.push(a); return a }
const settle = f => { const gen = f.gen = (f.gen ?? 0) + 1; Promise.all(f.anims.map(a => a.finished)).then(() => f.gen === gen && land(f), () => {}) }
const land = (f, now) => {
  if (now) f.anims.forEach(a => a.finish())
  if (f.dir < 0) { const sec = f.root.closest('section'); f.change(); sec.scrollTop = f.top; tops.set(sec, f.top) } // back where it started: undo the change under the held poses, on its own page
  for (const a of f.anims) if (a.effect.getTiming().fill !== 'backwards') { a.cancel(); lifted(a.effect.target).classList.remove('flying') } // the rest ended holding nothing
  f.ghosts.forEach(g => g.remove())
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
// A copy left where something was: it flies to `to` and melts into what is there, or with nowhere to go fades in place.
const ghost = (a, to, bare, d = 0) => {
  const g = a.el.cloneNode(true)
  g.hidden = false // a picture a filter just hid still fades where it was
  bare ? ghosts.prepend(g) : ghosts.append(g) // a pile's label under the flying prints
  air.ghosts.push(g)
  if (bare) g.firstElementChild.style.visibility = 'hidden' // a pile leaving with the view: its prints fly on their own
  Object.assign(g.style, { position: 'absolute', margin: 0, left: a.box.left + 'px', top: a.box.top - ghostsTop + 'px', width: a.box.width + 'px', height: a.box.height + 'px', translate: a.translate, rotate: a.rotate })
  if (to) fly(g, a, to, a.box, { duration: 650, delay: d, easing: EASE, fill: 'both' }) // gone when its flight lands
  if (to) play(g, [{ opacity: 1 }, { opacity: 0 }], { duration: 0, delay: d + 650, fill: 'both' }) // lands, then trades places with the picture in one frame
  else play(g, [{ opacity: 1 }, { opacity: 0, scale: .96 }], { duration: 250, easing: EASE, fill: 'both' })
}
