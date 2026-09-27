// Theme per machine: system | light | dark. Windows paints the caption buttons, so they get our colors pushed to them.
const root = document.documentElement
const bar = dim => {
  const css = getComputedStyle(root), v = n => css.getPropertyValue(n).trim()
  api.theme(localStorage.theme || 'system', { color: dim ? '#0000' : v('--bg'), symbolColor: v('--muted'), height: 56 })
}
const setTheme = t => {
  if (t === 'system') delete root.dataset.theme
  else root.dataset.theme = t
  localStorage.theme = t
  bar()
}
setTheme(localStorage.theme || 'system')
matchMedia('(prefers-color-scheme: dark)').onchange = () => bar(document.getElementById('preview').open) // system flips, and nativeTheme catching up after a switch; the preview keeps the strip clear
