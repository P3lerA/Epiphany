// true: Epiphany took it; false: it failed there (Epiphany says why); null: Epiphany isn't running.
const post = body => fetch('http://127.0.0.1:7676/', { method: 'POST', body: JSON.stringify(body) }).then(r => r.ok, () => null)

// Epiphany isn't running: the request waits in storage (kept across browser restarts) and goes out with the next click Epiphany takes.
// ponytail: a right-click save waits as a URL; an image URL that expires (signed CDN links) can 404 by then. Keep the bytes if that bites.
let chain = Promise.resolve()
const locked = f => chain = chain.catch(() => {}).then(f)
const waiting = async () => (await chrome.storage.local.get({ waiting: [] })).waiting
const keep = list => {
  chrome.action.setBadgeText({ text: list.length ? String(list.length) : '' }) // how many wait for Epiphany
  return chrome.storage.local.set({ waiting: list })
}
const flush = () => locked(async () => {
  for (let list = await waiting(); list.length; list = await waiting()) {
    await keep(list.slice(1)) // out before it is sent: a worker stopped mid-pull must not pull it twice
    if (await post(list[0]) === null) return keep(list)
  }
})
chrome.runtime.onStartup.addListener(async () => keep(await waiting())) // the badge doesn't survive a browser restart, the list does

const badge = (tabId, text) => {
  chrome.action.setBadgeText({ tabId, text })
  if (text !== '…') setTimeout(() => chrome.action.setBadgeText({ tabId, text: null }), 2000) // null: back to the waiting count
}
const send = async (tabId, body) => {
  badge(tabId, '…')
  let ok = await post(body) // also the liveness check: a refused connection means Epiphany isn't running
  if (ok === null) { await locked(async () => keep([...await waiting(), body])); ok = true }
  else flush()
  badge(tabId, ok ? '✓' : '!')
  return ok
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'save', title: 'Save to Epiphany', contexts: ['image'] })
})

// Floating button on listed sites (content.js) -> gallery-dl.
chrome.runtime.onMessage.addListener((msg, sender, reply) => { send(sender.tab.id, msg).then(reply); return true })

// Toolbar icon on any site -> gallery-dl.
chrome.action.onClicked.addListener(tab => send(tab.id, { page: tab.url }))

// Right-click on an image -> fetch that image directly.
chrome.contextMenus.onClicked.addListener((info, tab) => send(tab.id, { src: info.srcUrl, page: info.pageUrl }))
