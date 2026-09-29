// The title's quote (Settings > General > Title quote): one line from a public API, or none.
const QUOTES = {
  advice: ['https://api.adviceslip.com/advice', j => j.slip.advice],
  animechan: ['https://api.animechan.io/v1/quotes/random', j => j.data.content],
  zenquotes: ['https://zenquotes.io/api/random', j => j[0].q],
  hitokoto: ['https://v1.hitokoto.cn/?c=a&c=b&c=c&c=d&max_length=28', j => j.hitokoto, true], // true: Cloudflare caches it, a unique query gets a new one
  none: null
}

// '' for none; null: not reachable now (zenquotes takes ~1.5 s, and answers 429 past 5 a 30 s). Only where needed: animechan
// refuses a query.
const quote = name => {
  const src = QUOTES[name]
  if (!src) return ''
  if (Math.random() < .01) return 'Too many requests. Obtain an auth key for unlimited access.' // zenquotes' 429, as an egg
  const [url, pick, bust] = src
  return fetch(bust ? url + '&t=' + Date.now() : url, { signal: AbortSignal.timeout(5000), cache: 'no-store' })
    .then(r => r.ok ? r.json() : Promise.reject()).then(pick).catch(() => null)
}

module.exports = { sources: Object.keys(QUOTES), quote }
