// What danbooru knows about tags, kept in HOME/cache: what a tag means (its wiki), old names for current ones (its alias table),
// whose an account elsewhere is (its artists' pages), and the tags a word in another language names (their other names). And how Epiphany introduces itself to the sites it asks (UA).
const fs = require('fs')
const path = require('path')
const UA = { headers: { 'User-Agent': 'Epiphany/0.1' } }

module.exports = ({ home, readJson, settings }) => {
  // A tag's explanation: the first paragraph of its danbooru wiki, DText links and markup turned to plain text. Kept in
  // HOME/cache for good, a tag without a wiki as null; a failed request isn't kept, so it is asked again next time.
  const WIKI = path.join(home, 'cache', 'tag-wiki.json')
  let wiki
  const saveWiki = () => { fs.mkdirSync(path.dirname(WIKI), { recursive: true }); fs.writeFileSync(WIKI, JSON.stringify(wiki)) } // ~3MB: no indent
  const plain = body => body.split(/\r?\n\s*\r?\n/).map(p => p.trim()).find(p => p && !/^(h\d\.|\*|!post|\[(table|expand|quote|spoiler))/i.test(p))
    ?.replace(/\[\[([^\]|]+)\|\]\]/g, (_, t) => t.replace(/\s*\(.*\)$/, '')) // [[poster (object)|]]: the pipe trick drops the qualifier
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, '$1').replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/"([^"]+)":\[[^\]]*\]/g, '$1').replace(/"([^"]+)":\S+/g, '$1')
    .replace(/\[\/?[a-z]+(=[^\]]*)?\]/gi, '').replace(/\s+/g, ' ').trim() || null
  // First start pulls the lot: every general tag on 100+ danbooru posts (~24k; 25 requests, ~17MB down, ~4MB kept, 97% of a
  // sample library's tags). Anything rarer is asked for when it comes up. '' (no tag has that name) marks the pull done.
  const pullWikis = async () => {
    wiki ??= readJson(WIKI, {})
    if (wiki['']) return
    for (let page = 1; ; page++) {
      const l = await fetch(`https://danbooru.donmai.us/wiki_pages.json?search[tag][category]=0&search[tag][post_count]=>=100&search[is_deleted]=false&limit=1000&only=title,body&page=${page}`, { signal: AbortSignal.timeout(30000), ...UA }).then(r => r.ok ? r.json() : null).catch(() => null)
      if (!l) return // offline or refused: the next start tries again
      for (const w of l) wiki[w.title] ??= plain(w.body ?? '')
      if (l.length < 1000) break
    }
    wiki[''] = new Date().toISOString()
    saveWiki()
  }
  const tagWiki = async tag => {
    wiki ??= readJson(WIKI, {})
    if (tag in wiki) return wiki[tag]
    const r = await fetch(`https://danbooru.donmai.us/wiki_pages/${encodeURIComponent(tag)}.json`, { signal: AbortSignal.timeout(8000), ...UA }).catch(() => null)
    if (!r || (!r.ok && r.status !== 404)) return null
    const j = r.ok && await r.json().catch(() => null)
    if (r.ok && !j) return null // cut off mid-read: asked again next time
    wiki[tag] = j ? plain(j.body ?? '') : null
    saveWiki()
    return wiki[tag]
  }
  // Old names to danbooru's current ones (clouds -> cloud, catgirl -> cat_girl; konachan still writes many), when Settings > General
  // says so: danbooru's whole alias table (~41k, 42 requests, ~3MB), pulled then and again once it is a month old. Each name is
  // renamed only to one of its kind (an artist "x" stays, though the general tag x is now x_(symbol)). Renamed as they are read
  // (meta, tagsOf), the files as written: off, the old names are back.
  const ALIASES = path.join(home, 'cache', 'tag-aliases.json')
  let alias = null // { tags|artist|character|copyright: { old: new } }
  const renamed = (kind, t) => alias && Object.hasOwn(alias[kind], t) ? alias[kind][t] : t // own keys: a tag "constructor" is no alias
  const useAliases = async on => {
    if (on && !(fs.existsSync(ALIASES) && Date.now() - fs.statSync(ALIASES).mtimeMs < 30 * 864e5)) {
      const all = { tags: {}, artist: {}, character: {}, copyright: {} }
      for (let page = 1; ; page++) {
        const l = await fetch(`https://danbooru.donmai.us/tag_aliases.json?search[status]=active&limit=1000&only=antecedent_name,consequent_name,consequent_tag[category]&page=${page}`, { signal: AbortSignal.timeout(30000), ...UA }).then(r => r.ok ? r.json() : null).catch(() => null)
        if (!l) break // offline or refused: the table there is, if any; the next start tries again
        for (const a of l) all[{ 1: 'artist', 3: 'copyright', 4: 'character' }[a.consequent_tag?.category] ?? 'tags'][a.antecedent_name] = a.consequent_name
        if (l.length < 1000) { fs.mkdirSync(path.dirname(ALIASES), { recursive: true }); fs.writeFileSync(ALIASES, JSON.stringify(all)); break }
      }
    }
    alias = settings().aliases ? readJson(ALIASES, null) : null // turned off meanwhile: off
  }

  // An account's artist: an artist entry lists the artist's pages elsewhere (pixiv, X, fanbox...), and danbooru finds one by any
  // spelling of its URL. Their names, space-separated as a post's tag_string_artist; '' for none. Kept in HOME/cache for good; a
  // failed request isn't kept, so it is asked again next time.
  const ARTISTS = path.join(home, 'cache', 'artist-urls.json')
  let artists
  const artistOf = async url => {
    artists ??= readJson(ARTISTS, {})
    if (Object.hasOwn(artists, url)) return artists[url]
    const l = await fetch(`https://danbooru.donmai.us/artists.json?search[url_matches]=${encodeURIComponent(url)}&only=name,is_deleted`, { signal: AbortSignal.timeout(8000), ...UA })
      .then(r => r.ok ? r.json() : null).catch(() => null)
    if (!Array.isArray(l)) return null
    artists[url] = l.filter(a => !a.is_deleted).map(a => a.name).join(' ')
    fs.mkdirSync(path.dirname(ARTISTS), { recursive: true }); fs.writeFileSync(ARTISTS, JSON.stringify(artists))
    return artists[url]
  }
  // The tags a word in another language names: danbooru's autocomplete matches their other names too (初音: hatsune_miku, 双马尾:
  // twintails), most used first. [{ tag, said }], said the name it matched; none when danbooru can't be reached.
  const tagsFor = q => fetch(`https://danbooru.donmai.us/autocomplete.json?${new URLSearchParams({ 'search[query]': q, 'search[type]': 'tag_query', limit: 20 })}`,
    { signal: AbortSignal.timeout(5000), ...UA }).then(r => r.ok ? r.json() : []).then(l => l.map(x => ({ tag: x.value, said: x.antecedent ?? '' })), () => [])
  return { UA, pullWikis, tagWiki, useAliases, renamed, aliasing: () => alias !== null, artistOf, tagsFor }
}
