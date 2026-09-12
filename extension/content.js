const btn = document.createElement('button')
btn.textContent = 'Pull'
Object.assign(btn.style, {
  position: 'fixed', right: '20px', top: '20px', zIndex: 2147483647,
  padding: '8px 14px', font: '500 13px/1 "Segoe UI", system-ui, sans-serif',
  color: '#EDE5D6', background: '#1A1A2E', border: '1px solid #A48D6F', borderRadius: '6px',
  cursor: 'pointer', opacity: .85
})
btn.onclick = () => {
  btn.textContent = '…'
  chrome.runtime.sendMessage({ page: location.href }, ok => {
    btn.textContent = ok ? '✓' : '!'
    setTimeout(() => btn.textContent = 'Pull', 2000)
  })
}
document.body.append(btn)
