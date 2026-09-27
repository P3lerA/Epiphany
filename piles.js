// Tag piles: one pile per general tag over the pictures on show, most common first. And swap(change): the choreography between
// grid and piles and across filter changes. Pictures fly from where they were to where change puts them; one can land on several
// piles, one coming from off screen enters at the edge, what truly goes away fades.

const pilesUI = $('.fab .piles-toggle')
let piling = false, gridTop = 0
const covers = new Map() // tag -> pictures that have lain on top, latest first: what shows on top stays there while it's in the pile
const tilt = s => { let h = 7; for (const c of s) h = h * 31 + c.charCodeAt(0) | 0; return (h >>> 0) / 2 ** 32 - .5 } // steady per pile across redraws
const drawPiles = root => {
  const by = new Map()
  for (const img of shown(root)) for (const t of img.item.tags?.split(', ') ?? []) if (t) by.has(t) ? by.get(t).push(img) : by.set(t, [img])
  const el = document.createElement('div')
  el.className = 'piles'
  const seen = new Set() // pictures a bigger pile already shows: otherwise the newest few top every pile
  // ponytail: the 120 biggest piles of 2+; virtualize if the long tail is wanted
  for (const [t, l] of [...by].filter(([, l]) => l.length > 1).sort((a, b) => b[1].length - a[1].length).slice(0, 120)) {
    const b = el.appendChild(document.createElement('button'))
    b.className = 'pile'
    b.dataset.tag = t
    b.onclick = () => swap(() => { back = scroller().scrollTop; setPiling(false); scope.value = ''; search.value = t.replace(/_/g, ' '); localQ(); scroller().scrollTop = 0 })
    const stack = b.appendChild(document.createElement('span'))
    const kept = (covers.get(t) ?? []).map(f => l.find(i => i.dataset.file === f)).filter(Boolean) // filters and trips to the grid don't reshuffle what lies on top
    const pick = [...new Set([...kept, ...l.filter(i => !seen.has(i)), ...l.filter(i => seen.has(i))])].slice(0, 3)
    covers.set(t, [...new Set([...pick.map(i => i.dataset.file), ...covers.get(t) ?? []])])
    pick.forEach(i => seen.add(i))
    pick.reverse().forEach((src, i, a) => {
      const img = stack.appendChild(new Image())
      img.className = 'print'
      img.src = src.src
      img.dataset.file = src.dataset.file
      const k = t + src.dataset.file // pose per pile and picture, not per place: a print joining underneath doesn't shift the others
      img.style.rotate = tilt(k) * (i === a.length - 1 ? 4 : 14) + 'deg' // the top print lies nearly straight
      img.style.translate = `${tilt(k + 'x') * 12}px ${tilt(k + 'y') * 12}px`
    })
    b.appendChild(document.createElement('span')).append(t.replace(/_/g, ' '), Object.assign(document.createElement('small'), { textContent: l.length }))
  }
  root.querySelector(':scope > .piles')?.remove()
  root.append(el)
}
const setPiling = (on, root = page()) => {
  const sec = root.closest('section')
  if (on && !piling) gridTop = sec.scrollTop
  piling = on
  pilesUI.classList.toggle('on', on)
  for (const r of [$('#lobby'), pgrid]) { r.classList.remove('piling'); r.querySelector(':scope > .piles')?.remove() }
  if (on) { root.classList.add('piling'); drawPiles(root) }
  sec.scrollTop = on ? 0 : gridTop
}
const swap = (change, key) => {
  if (calm.matches) return change()
  if (flight?.dir < 0) land(flight, true) // a take-back still rewinding lands first: its undo must not come after this change
  const root = page(), was = piling
  // The rest of the page moves as blocks: day headings in the grid, whole piles in piles (their prints ride along).
  const blocks = () => new Map([...root.querySelectorAll(piling ? '.pile' : 'h3')].map(el => [el.dataset.tag ?? el.parentElement.dataset.day, pose(el)]))
  const pics = () => piling ? [...root.querySelectorAll('.print')] : shown(root)
  const marks = blocks(), before = pics().map(pose).filter(p => !piling || onScreen(p)) // every print on screen, or every grid spot even off screen
  const lay = el => el.closest('.pile').dataset.tag + ' ' + el.dataset.file, lain = piling && new Set(pics().map(lay)) // which pile each print lay in
  const from = new Map() // picture -> where it shows
  for (const p of before) from.set(p.el.dataset.file, [...from.get(p.el.dataset.file) ?? [], p])
  const f = air = { anims: [], ghosts: [], key, dir: 1, change, root, top: root.closest('section').scrollTop }
  ghostsTop = ghosts.getBoundingClientRect().top
  try { // a throw must not leave later animations recording into a dead flight
    change()
    const used = new Set(), same = was === piling
    let n = 0
    const delay = () => Math.min(n++ * 12, 240)
    // A pile's prints set off and land together, stacked as they lie: one by one, whichever landed first was the pile's face for a moment.
    const piled = new Map(), pileDelay = el => { const p = el.closest('.pile'); if (!piled.has(p)) piled.set(p, delay()); return piled.get(p) }
    const move = (a, b, d = b.el.classList.contains('print') ? pileDelay(b.el) : delay()) => {
      used.add(a)
      if (onScreen(a) || onScreen(b)) fly(b.el, a, b, b.box, { duration: 650, delay: d, easing: EASE, fill: 'backwards' })
    }
    const appear = el => play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: delay() + 150, easing: EASE, fill: 'backwards' })
    for (const [k, b] of blocks()) {
      const a = same ? marks.get(k) : undefined
      if (a?.box.width && b.box.width) move(a, b)
      else if (onScreen(b)) appear(piling && !same ? b.el.lastElementChild : b.el) // a pile arriving with the view: only its label, the prints fly in
    }
    if (was && piling) { // piles to piles: the prints ride in their piles; one new on a pile fades in, one gone fades where it was
      const now = pics(), lies = new Set(now.map(lay)), stays = new Set(blocks().keys())
      for (const a of before) if (lies.has(lay(a.el)) || !stays.has(a.el.closest('.pile').dataset.tag)) used.add(a) // a pile gone takes its prints with it
      for (const el of now) if (!lain.has(lay(el)) && onScreen(pose(el))) appear(el)
    } else {
      const now = pics().map(pose)
      if (was) { // piles to grid: every print flies home as a copy, stacked as it lay (the pictures themselves stack in grid order); the picture shows under the first to land
        const spot = new Map(now.map(b => [b.el.dataset.file, b])), held = new Set()
        for (const a of before) {
          const b = spot.get(a.el.dataset.file), d = pileDelay(a.el)
          if (!b) continue
          used.add(a)
          ghost(a, b, false, d)
          if (!held.has(b)) { held.add(b); play(b.el, [{ opacity: 0 }, { opacity: 0 }], { duration: d + 650 }) }
        }
        for (const b of now) if (!held.has(b) && onScreen(b)) appear(b.el)
      } else {
        // From a filtered grid most prints have no picture to fly from. They show as their pile's flight sets off, so one flying in
        // slides under the prints above it; a pile nothing flies into fades in as one layer, not prints seen through each other.
        const flown = new Set(piling ? now.filter(b => from.has(b.el.dataset.file) && onScreen(b)).map(b => b.el.closest('.pile')) : []), shows = new Set()
        for (const b of now) {
          const a = from.get(b.el.dataset.file)?.[0]
          if (a) { if (!piling || onScreen(b)) move(a, b); continue } // a picture on many piles: each one on screen takes a copy
          if (!onScreen(b)) continue
          if (!piling) { appear(b.el); continue }
          const pile = b.el.closest('.pile'), el = flown.has(pile) ? b.el : pile.firstElementChild
          if (shows.has(el)) continue
          shows.add(el)
          play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 250, delay: pileDelay(b.el), easing: EASE, fill: 'backwards' })
        }
      }
      if (piling) for (const [file, [a]] of from) if (!used.has(a) && onScreen(a)) { // no pile on screen wants it: off to one below
        const b = now.find(p => p.el.dataset.file === file)
        if (b) move(a, b)
      }
    }
    for (const a of [...marks.values(), ...[...from.values()].flat()]) if (!used.has(a) && onScreen(a)) ghost(a, null, marks.get(a.el.dataset.tag) === a && !piling)
  } finally { air = null; settle(flight = f) }
}
let back = null // where the piles were when a pile opened into the grid: clearing that search goes back
const backToPiles = () => {
  if (back === null || search.value.trim()) return
  const g = gridTop, top = back
  back = null
  setPiling(true)
  gridTop = g
  scroller().scrollTop = top
}
pilesUI.onclick = () => { // again mid-flight: everything flies back
  back = null
  if (flight?.key === 'piles') { pilesUI.classList.toggle('on'); rewind() }
  else { const root = page(); swap(() => setPiling(!piling, root), 'piles') } // its undo may run after the page changed
}
addEventListener('hashchange', () => { back = null; if (flight) land(flight, true); if (piling && !page().classList.contains('piling')) { gridTop = 0; setPiling(true) } })
// Pulls, lookups and deletes reach the piles in one redraw once they stop coming: a pull saves dozens in a row.
let refresh
const refreshPiles = () => { clearTimeout(refresh); refresh = setTimeout(() => piling && swap(() => drawPiles(page())), 300) }
