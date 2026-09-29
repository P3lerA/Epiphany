// Preview: big image + editable caption. Reusable for any item.
const dlg = $('#preview'), ta = dlg.querySelector('textarea')
let cur // which grid the preview walks, and where it is
const siblings = () => {
  const imgs = shown(cur.root)
  const i = imgs.findIndex(x => x.dataset.file === cur.file)
  return { prev: imgs[i - 1], next: imgs[i + 1] }
}
const step = d => { const n = d < 0 ? siblings().prev : siblings().next; if (n) preview(n.item) }
dlg.querySelector('.prev').onclick = () => step(-1)
dlg.querySelector('.next').onclick = () => step(1)
dlg.tabIndex = -1
dlg.onkeydown = e => {
  if (e.target.tagName === 'TEXTAREA') return
  if (e.key === 'ArrowLeft') step(-1)
  if (e.key === 'ArrowRight') step(1)
}
const preview = async (item, root) => {
  cur = { root: root ?? cur.root, file: item.file }
  const { prev, next } = siblings()
  dlg.querySelector('.prev').hidden = !prev
  dlg.querySelector('.next').hidden = !next
  dlg.querySelector('img').src = item.url
  dlg.querySelector('.time').textContent = new Date(item.time).toLocaleString()
  const head = dlg.querySelector('.head')
  const link = (text, f) => Object.assign(document.createElement('a'), { href: '#', textContent: text, onclick: e => { e.preventDefault(); f() } })
  const from = item.from && (item.from.url ? link(item.from.site, () => api.open(item.from.url)) : item.from.site)
  const acts = document.createElement('span')
  acts.className = 'acts'
  acts.append(link('Look up', () => api.lookup(item)), ' / ', link('Tag', () => api.tag([item]))) // a booru match may be a variant; one pulled from a booru is kept (main.js)
  dlg.querySelector('.tagged').replaceChildren(...(from ? ['Tags from ', from] : [{ none: 'Tags: none', unsure: 'Tags: pick a match', tagger: 'Tags from tagger' }[item.tagged]]), acts)
  // The head's names: click searches this library, right-click has the rest, as a tag in the box does.
  const known = new Set(['character', 'copyright', 'artist'].flatMap(k => names(item[k])))
  const drawHead = text => head.replaceChildren(...text.split(', ').filter(Boolean).flatMap((t, i) => {
    const n = t.replace(/^@/, '')
    const el = known.has(n) ? Object.assign(document.createElement('span'), { textContent: t, onclick: () => searchLocal(n), oncontextmenu: () => api.tagMenu(n) }) : t
    return i ? [', ', el] : [el]
  }))
  // Close IQDB matches: click one to see its caption, Use to keep it, View post to see it on its booru.
  const picks = dlg.querySelector('.picks'), use = dlg.querySelector('.use'), post = dlg.querySelector('.post')
  use.hidden = post.hidden = true
  picks.replaceChildren(...(item.candidates ?? []).map((c, i) => {
    const b = document.createElement('button')
    b.innerHTML = `<img${c.url ? ` src="${esc(c.url)}"` : ''}><span>${c.score}% · +${c.plus.length}</span>`
    b.title = c.plus.join(', ') || 'no tags of its own'
    b.onclick = () => {
      picks.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b))
      drawHead(c.head)
      ta.value = c.tags
      use.hidden = false
      use.onclick = () => api.pick(item, i)
      post.hidden = !c.post // iqdb.org's zerochan and anime-pictures have no post link here
      post.onclick = e => { e.preventDefault(); api.open(c.post) }
    }
    return b
  }))
  const proj = dlg.querySelector('.proj')
  proj.textContent = item.project
  proj.onclick = e => { e.preventDefault(); dlg.close(); openProject(item.project) }
  const src = dlg.querySelector('.src')
  const u = new URL(item.page)
  src.replaceChildren(u.protocol + '//', Object.assign(document.createElement('b'), { textContent: u.host }), u.pathname + u.search)
  src.onclick = e => { e.preventDefault(); api.open(item.page) }
  const c = await api.getCaption(item)
  drawHead(c.head) // the profile's part, from the sidecar: shown, not edited
  ta.value = c.tags
  ta.onchange = () => api.setCaption(item, ta.value)
  if (!dlg.open) { bar(true); dlg.showModal() }
  dlg.focus()
}
dlg.onclick = e => { if (e.target === dlg) dlg.close() }
dlg.onclose = () => setTimeout(() => dlg.open || bar(), 150) // the strip turns opaque again once the backdrop has faded
// The comma-delimited piece around a place in the caption, spaces trimmed: [start, end].
const piece = (v, i) => {
  let a = v.lastIndexOf(',', i - 1) + 1, b = v.indexOf(',', i)
  if (b < 0) b = v.length
  while (a < b && /\s/.test(v[a])) a++
  while (b > a && /\s/.test(v[b - 1])) b--
  return [a, b]
}
// Right-click a tag in the caption: the selection, or the piece under the caret.
const tagAt = () => ta.value.slice(ta.selectionStart, ta.selectionEnd).trim() || ta.value.slice(...piece(ta.value, ta.selectionStart))
ta.oncontextmenu = () => { const t = tagAt(); if (t) api.tagMenu(t) }
ta.ondblclick = () => ta.setSelectionRange(...piece(ta.value, ta.selectionStart)) // the whole tag ("long hair"), not one word
const searchLocal = tag => { dlg.close(); swap(() => { scope.value = ''; search.value = tag; localQ() }); search.focus() }
api.onSearch(searchLocal)
