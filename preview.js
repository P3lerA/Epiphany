// Preview: big image + editable caption. Reusable for any item.
const dlg = $('#preview')
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
  const link = (text, f) => Object.assign(document.createElement('a'), { href: '#', textContent: text, onclick: e => { e.preventDefault(); f() } })
  const from = item.from && (item.from.url ? link(item.from.site, () => api.open(item.from.url)) : item.from.site)
  dlg.querySelector('.tagged').replaceChildren(...(from ? ['Tags from ', from] : [{ none: 'Tags: none', unsure: 'Tags: pick a match', tagger: 'Tags from tagger' }[item.tagged]]),
    ' · ', link('Look up', () => api.lookup(item)), ' · ', link('Tag', () => api.tag([item]))) // a booru match may be a variant; one pulled from a booru is kept (main.js)
  // Close IQDB matches: click one to see its caption, Use to keep it, View post to see it on its booru.
  const head = dlg.querySelector('.head'), ta = dlg.querySelector('textarea')
  const picks = dlg.querySelector('.picks'), use = dlg.querySelector('.use'), post = dlg.querySelector('.post')
  use.hidden = post.hidden = true
  picks.replaceChildren(...(item.candidates ?? []).map((c, i) => {
    const b = document.createElement('button')
    b.innerHTML = `<img${c.url ? ` src="${esc(c.url)}"` : ''}><span>${c.score}% · +${c.plus.length}</span>`
    b.title = c.plus.join(', ') || 'no tags of its own'
    b.onclick = () => {
      picks.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b))
      head.textContent = c.head
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
  head.textContent = c.head // the profile's part, from the sidecar: shown, not edited
  ta.value = c.tags
  ta.onchange = () => api.setCaption(item, ta.value)
  if (!dlg.open) { bar(true); dlg.showModal() }
  dlg.focus()
}
dlg.onclick = e => { if (e.target === dlg) dlg.close() }
dlg.onclose = () => setTimeout(() => dlg.open || bar(), 150) // the strip turns opaque again once the backdrop has faded
// Right-click a tag in the caption: the selection, or the comma-delimited piece under the caret.
const tagAt = ta => {
  const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim()
  if (sel) return sel
  const a = ta.value.lastIndexOf(',', ta.selectionStart - 1) + 1
  const b = ta.value.indexOf(',', ta.selectionStart)
  return ta.value.slice(a, b < 0 ? undefined : b).trim()
}
dlg.querySelector('textarea').oncontextmenu = e => { const t = tagAt(e.target); if (t) api.tagMenu(t) }
api.onSearch(tag => { dlg.close(); swap(() => { scope.value = ''; search.value = tag; localQ() }); search.focus() })
