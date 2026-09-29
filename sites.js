// What the app knows of each site, as data: which are boorus, a post's page, a tag's search page, the page of just one picture,
// how much of a page a pull takes. No Electron, no files: main.js asks.

// Non-booru sources (pixiv, twitter...) carry no booru tags; their pictures get looked up on the boorus.
const BOORU = new Set(['danbooru', 'gelbooru', 'safebooru', 'yandere', 'konachan', 'sankaku', 'e621', 'rule34'])
// E-Hentai, ExHentai: 'ehentai' in the app, gallery-dl's 'exhentai' (one extractor, one config for both). Its namespaced tags
// (female:..., other:...) aren't booru words, so its pictures get looked up and tagged like pixiv's.
const EH = /(^|\.)(e-|ex)hentai\.org$/
const gdlName = site => site === 'ehentai' ? 'exhentai' : site

const POST = {
  danbooru: id => `https://danbooru.donmai.us/posts/${id}`,
  gelbooru: id => `https://gelbooru.com/index.php?page=post&s=view&id=${id}`,
  safebooru: id => `https://safebooru.org/index.php?page=post&s=view&id=${id}`,
  rule34: id => `https://rule34.xxx/index.php?page=post&s=view&id=${id}`,
  yandere: id => `https://yande.re/post/show/${id}`,
  konachan: id => `https://konachan.com/post/show/${id}`,
  sankaku: id => `https://chan.sankakucomplex.com/post/show/${id}`,
  e621: id => `https://e621.net/posts/${id}`
}
const postUrl = p => POST[p.category]?.(p.id)

// Tag search pages per site. Boorus spell a tag with underscores.
const q = t => encodeURIComponent(t)
const SEARCH = {
  danbooru: t => `https://danbooru.donmai.us/posts?tags=${q(t)}`,
  gelbooru: t => `https://gelbooru.com/index.php?page=post&s=list&tags=${q(t)}`,
  safebooru: t => `https://safebooru.org/index.php?page=post&s=list&tags=${q(t)}`,
  yandere: t => `https://yande.re/post?tags=${q(t)}`,
  konachan: t => `https://konachan.com/post?tags=${q(t)}`,
  sankaku: t => `https://chan.sankakucomplex.com/?tags=${q(t)}`,
  e621: t => `https://e621.net/posts?tags=${q(t)}`,
  rule34: t => `https://rule34.xxx/index.php?page=post&s=list&tags=${q(t)}`,
  animepictures: t => `https://anime-pictures.net/posts?search_tag=${q(t)}`,
  zerochan: t => `https://www.zerochan.net/${q(t)}`,
  pixiv: t => `https://www.pixiv.net/tags/${q(t)}`,
  twitter: t => `https://x.com/search?q=${q(t)}`,
  deviantart: t => `https://www.deviantart.com/search?q=${q(t)}`,
  artstation: t => `https://www.artstation.com/search?query=${q(t)}`,
  ehentai: t => `https://e-hentai.org/?f_search=${q(t)}`
}
const searchUrl = (site, tag) => SEARCH[site](BOORU.has(site) || site === 'animepictures' ? tag.replace(/ /g, '_') : tag)

// The page of just this picture, where its sidecar (j) tells: its booru post (the booru it was matched on too), a pixiv work
// (range: which of its pictures), an E-Hentai image page (on the domain it came from, from: some are ExHentai's only).
const own = (j, from) => postUrl(j.booru ?? j) ? { page: postUrl(j.booru ?? j) }
  : j.category === 'pixiv' ? { page: `https://www.pixiv.net/artworks/${j.id}`, range: String((j.num ?? 0) + 1) }
  : j.category === 'exhentai' ? { page: `https://${EH.test(new URL(from).host) ? new URL(from).host : 'e-hentai.org'}/s/${j.image_token}/${j.gid}-${j.num}` } : null

// How much of a page a pull takes (gallery-dl --range). A page showing one picture of a gallery: that one (E-Hentai's /s/, which
// gallery-dl runs on from; hitomi's reader, #page). ponytail: anything else (a search, a gallery) caps at 50; make it a profile
// field if you want whole ones.
const range = u => {
  const { host, pathname, hash } = new URL(u)
  return EH.test(host) && pathname.startsWith('/s/') ? '1' : host.endsWith('hitomi.la') && pathname.startsWith('/reader/') ? String(parseInt(hash.slice(1)) || 1) : '1-50'
}

module.exports = { BOORU, EH, gdlName, postUrl, SEARCH, searchUrl, own, range }

if (require.main === module) {
  const assert = require('assert')
  assert.equal(searchUrl('danbooru', 'long hair'), 'https://danbooru.donmai.us/posts?tags=long_hair')
  assert.equal(searchUrl('pixiv', 'long hair'), 'https://www.pixiv.net/tags/long%20hair')
  assert.deepEqual(own({ category: 'pixiv', id: 5, booru: { category: 'danbooru', id: 7 } }, 'https://www.pixiv.net/artworks/5'), { page: 'https://danbooru.donmai.us/posts/7' })
  assert.deepEqual(own({ category: 'pixiv', id: 5, num: 2 }, 'https://www.pixiv.net/users/1'), { page: 'https://www.pixiv.net/artworks/5', range: '3' })
  assert.deepEqual(own({ category: 'exhentai', gid: 9, num: 3, image_token: 'ab' }, 'https://exhentai.org/g/9/x/'), { page: 'https://exhentai.org/s/ab/9-3' })
  assert.equal(own({ category: 'twitter' }, 'https://x.com/a'), null)
  assert.equal(range('https://e-hentai.org/s/ab/9-3'), '1')
  assert.equal(range('https://hitomi.la/reader/123.html#7'), '7')
  assert.equal(range('https://gelbooru.com/index.php?page=post&s=list&tags=x'), '1-50')
  console.log('ok')
}
