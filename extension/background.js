const post = body => fetch('http://127.0.0.1:7676/', { method: 'POST', body: JSON.stringify(body) }).then(r => r.ok, () => false)

const badge = (tabId, text) => {
  chrome.action.setBadgeText({ tabId, text })
  if (text !== '…') setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }), 2000)
}
const send = (tabId, body) => { badge(tabId, '…'); post(body).then(ok => badge(tabId, ok ? '✓' : '!')) }

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'save', title: 'Save to Epiphany', contexts: ['image'] })
})

// Floating button on listed sites (content.js) -> gallery-dl.
chrome.runtime.onMessage.addListener((msg, _, reply) => { post(msg).then(reply); return true })

// Toolbar icon on any site -> gallery-dl.
chrome.action.onClicked.addListener(tab => send(tab.id, { page: tab.url }))

// Right-click on an image -> fetch that image directly.
chrome.contextMenus.onClicked.addListener((info, tab) => send(tab.id, { src: info.srcUrl, page: info.pageUrl }))
