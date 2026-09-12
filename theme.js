const t = localStorage.getItem('theme')
if (t) document.documentElement.dataset.theme = t

document.addEventListener('click', e => {
  if (!e.target.closest('.theme-toggle')) return
  const html = document.documentElement
  const isDark = (html.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark'
  html.dataset.theme = isDark ? 'light' : 'dark'
  localStorage.setItem('theme', html.dataset.theme)
})
