{
// Statistics: the pictures the filters let through (the filter button and the search work here as on the grid), counted a few
// ways; behind each bar, faint, the whole library: what the filters cut away. A bar with a filter of its own on the grid sets it
// (rating, tags, source; a name searches for it whole), and takes it off when clicked again; right-click: everything but it, as
// there. Ctrl adds it to what is chosen: one rating, source... or another (a picture has one of each); one name and another.
// Installed or not in Instruments: removed, no page in Settings and nothing counted. Its caption profiles: the quality order.
let profs
api.profiles().then(p => { profs = p; drawStats() })
$('#settings aside').append(Object.assign(document.createElement('a'), { href: '#statistics', textContent: 'Statistics' }))
$('#settings').insertAdjacentHTML('beforeend', '<div id="statistics"><h2>Statistics</h2><p></p><div class="charts"></div></div>')
const showStats = () => {
  $('#settings aside a[href="#statistics"]').hidden = !s.instruments.statistics
  if (!s.instruments.statistics && location.hash === '#statistics') location.hash = '#instruments'
  drawStats()
}
const RATED = { g: 'General', s: 'Sensitive', q: 'Questionable', e: 'Explicit' }
const FROM = { booru: 'Booru', tagger: 'Tagger', unsure: 'Close matches', none: 'None' }
const LENGTHS = ['None', '1–9', '10–19', '20–29', '30–39', '40–49', '50+']
const tiers = () => { const p = { ...profs[s.profile], ...s.overrides }; return [...(p.qualities || '').split(',').map(t => t.trim()).filter(Boolean)].reverse().concat('None') }
const flip = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]))
// In two groups (page.css): where the pictures come from, to cut by; and what is in them.
// [title, the value(s) a picture counts under, their order (else by count), only the most common: names, the filter its bars set
// (q: the search) and a bar's value for it, a note on the title]
const STATS = {
  from: [
    ['Rating', i => RATED[i.rating || 'e'], () => Object.values(RATED), false, 'rating', k => flip(RATED)[k]], // unrated is explicit, as on the grid
    ['Tags from', i => FROM[i.tagged] ?? 'None', () => Object.values(FROM), false, 'tagged', k => flip(FROM)[k]],
    ['Source', i => source(i.site), null, false, 'site', k => k]
  ],
  in: [
    ['Quality', i => i.quality || 'None', tiers],
    ['Tags per picture', i => { const n = names(i.tags).length; return LENGTHS[Math.min(6, n && 1 + Math.floor(n / 10))] }, () => LENGTHS, false, null, null,
      l => `average ${(l.reduce((a, i) => a + names(i.tags).length, 0) / (l.length || 1)).toFixed(1)}`],
    ['Series', i => names(i.copyright), null, true, 'q', k => k],
    ['Characters', i => names(i.character), null, true, 'q', k => k],
    ['Artists', i => names(i.artist), null, true, 'q', k => k],
    ['Tags', i => names(i.tags), null, true, 'q', k => k]
  ]
}
const count = (list, key) => { const n = new Map(); for (const i of list) for (const k of [key(i)].flat()) n.set(k, (n.get(k) ?? 0) + 1); return n }
const asQ = v => v.toLowerCase().replace(/ /g, '_') // as the search box keeps it
const SEP = { rating: '' } // rating's choices are letters (gs), the others' comma-separated (renderer.js)
const chosen = (f, neg) => { const c = F[f] || ''; return c.startsWith('!') === neg ? c.replace(/^!/, '').split(SEP[f] ?? ',').filter(Boolean) : [] }
const drawStats = () => {
  const box = $('#statistics .charts')
  if (!profs || !s.instruments.statistics || !box.checkVisibility()) return
  const on = shown($('#lobby')).map(i => i.item), ai = on.filter(i => i.ai).length
  $('#statistics p').textContent = `${plural(on.length, 'picture')} of ${items.length.toLocaleString()}${ai ? `, ${ai.toLocaleString()} AI-generated` : ''}`
  const chart = ([title, key, order, top, f, value, note]) => {
    const n = count(on, key), all = count(items, key), by = (a, b) => (n.get(b) ?? 0) - (n.get(a) ?? 0) || all.get(b) - all.get(a)
    const keys = order ? order().filter(k => all.has(k)) : top ? [...n.keys()].sort(by).slice(0, 12) : [...all.keys()].sort(by) // a name the filters cut away entirely isn't worth a line
    if (!keys.length) return ''
    const max = Math.max(...keys.map(k => all.get(k)))
    return `<div class="chart"><h3>${title}${note ? ` <small>${note(on)}${on.length < items.length ? `, library ${note(items).replace(/^\D+/, '')}` : ''}</small>` : ''}</h3>` + keys.map(k => {
      const v = f && value(k), now = f === 'q' ? Q().names.includes(asQ(k)) : v && chosen(f, false).includes(v)
      return `<div${v ? ` data-f="${f}" data-v="${esc(v)}"` : ''}${now ? ' class="on"' : v && chosen(f, true).includes(v) ? ' class="not"' : ''} title="${(n.get(k) ?? 0).toLocaleString()} of ${plural(on.length, 'picture')} on show; ${all.get(k).toLocaleString()} in the library">`
        + `<i class="all" data-w="${all.get(k) / max}"></i><i data-w="${(n.get(k) ?? 0) / max}"></i><span>${esc(k)}</span><b>${(n.get(k) ?? 0).toLocaleString()}</b></div>`
    }).join('') + '</div>'
  }
  box.innerHTML = Object.entries(STATS).map(([group, list]) => `<div class="${group}">${list.map(chart).join('')}</div>`).join('')
    + (items.length ? `<div class="saved">${saved(on)}</div>` : '')
  box.querySelectorAll('i').forEach(i => i.style.setProperty('--w', i.dataset.w)) // the page's CSP refuses style attributes
}
// Under the lists, across: pictures saved in the last month by the day, or the last week or day by the hour; the library faint
// behind what is on show, as on the bars. A column's tooltip gives its counts.
const SPANS = { Month: [30, false], Week: [7, true], Day: [1, true] } // days back, by the hour
const saved = on => {
  const span = SPANS[localStorage.savedSpan] ? localStorage.savedSpan : 'Month', [back, hour] = SPANS[span], now = Date.now()
  const bin = t => { const d = new Date(t); hour ? d.setMinutes(0, 0, 0) : d.setHours(0, 0, 0, 0); return +d }
  const keys = []
  for (const d = new Date(bin(now - back * 864e5)); +d <= now; hour ? d.setHours(d.getHours() + 1) : d.setDate(d.getDate() + 1)) keys.push(+d)
  const n = count(on, i => bin(i.time)), all = count(items, i => bin(i.time)), peak = Math.max(...keys.map(k => all.get(k) ?? 0))
  const x = j => j / (keys.length - 1) * 1000, w = 1000 / (keys.length - 1), y = v => 100 - (v ?? 0) / (peak || 1) * 96
  const line = m => { // smoothed: curves through the midpoints, each count a control point, so it never dips below 0 or tops the peak
    const p = keys.map((k, j) => [x(j), y(m.get(k))]), mid = (a, b) => `${(a[0] + b[0]) / 2},${(a[1] + b[1]) / 2}`
    return `${p[0]} L${mid(p[0], p[1])} ${p.slice(1, -1).map((q, j) => `Q${q} ${mid(q, p[j + 2])}`).join(' ')} L${p.at(-1)}`
  }
  const label = k => hour ? `${day(k)} ${new Date(k).getHours()}:00` : day(k)
  return `<div class="chart"><h3>Saved per ${hour ? 'hour' : 'day'} <small>peak ${peak.toLocaleString()}</small>`
    + `<div class="seg">${Object.keys(SPANS).map(k => `<button data-span="${k}"${k === span ? ' class="on"' : ''}>${k}</button>`).join('')}</div></h3>`
    + `<svg viewBox="0 0 1000 100" preserveAspectRatio="none"><path class="all" d="M0,100 L${line(all)} L1000,100Z"/><path d="M0,100 L${line(n)} L1000,100Z"/><path class="line" d="M${line(n)}"/>`
    + keys.map((k, j) => `<rect x="${x(j) - w / 2}" width="${w}" height="100"><title>${label(k)}: ${(n.get(k) ?? 0).toLocaleString()} on show, ${(all.get(k) ?? 0).toLocaleString()} in the library</title></rect>`).join('')
    + `</svg><p><span>${label(keys[0])}</span><span>${label(keys.at(-1))}</span></p></div>`
}
const cut = (e, not) => {
  const bar = e.target.closest('[data-f]')
  if (!bar) return
  e.preventDefault()
  const { f, v } = bar.dataset, add = e.ctrlKey || e.metaKey
  if (f === 'q') { // whole names; Ctrl keeps the others, and what is typed besides
    const was = Q().names, n = asQ(v)
    const to = add ? (was.includes(n) ? was.filter(x => x !== n) : [...was, n]) : was.length === 1 && was[0] === n && !Q().text.length ? [] : [n]
    scope.value = ''; search.value = [...to, ...add ? Q().text : []].map(x => x.replace(/_/g, ' ')).join(', ')
    return applyQ()
  }
  if (f === 'rating' && safe !== null) return // safe mode: Rating locked
  if (f === 'site') not = false // a source has no "everything but" on the grid either
  const sign = not ? '!' : '', was = chosen(f, !!not)
  const to = add ? (was.includes(v) ? was.filter(x => x !== v) : [...was, v]) : F[f] === sign + v ? [] : [v]
  swap(() => { F[f] = to.length ? sign + to.join(SEP[f] ?? ',') : ''; saveF(); applyFilters(); explain() })
}
$('#statistics .charts').onclick = e => {
  const b = e.target.closest('[data-span]')
  if (!b) return cut(e)
  localStorage.savedSpan = b.dataset.span
  $('#statistics .saved').innerHTML = saved(shown($('#lobby')).map(i => i.item))
}
$('#statistics .charts').oncontextmenu = e => cut(e, true)
addEventListener('hashchange', () => { if (location.hash === '#statistics') s.instruments.statistics ? drawStats() : location.replace('#instruments') }) // removed: no page
showStats()
addEventListener('instrument', e => e.detail === 'statistics' && showStats())
addEventListener('library', () => drawStats())
}
