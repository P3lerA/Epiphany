// What danbooru knows about tags, kept in HOME/cache: what a tag means and what else it is called (its wiki), old names for current
// ones (its alias table), whose an account elsewhere is (its artists' pages). And how Epiphany introduces itself to the sites it
// asks (UA).
const fs = require('fs')
const path = require('path')
const UA = { headers: { 'User-Agent': 'Epiphany/0.1' } }

module.exports = ({ home, readJson, settings }) => {
  // danbooru's tags as their wikis tell them, kept in HOME/cache: { tag: [explanation, posts, ...other names] }. The explanation is
  // the first paragraph, DText links and markup turned to plain text (null: no wiki); the other names are the tag's in other
  // languages and spellings (初音ミク, 双马尾...). Pulled whole at the first start and again once it is a month old: every general,
  // artist, series and character tag on 100+ posts that has a wiki (~57k; 57 requests, ~60MB down, ~10MB kept). Anything rarer is
  // asked for when it comes up, and kept. '' (no tag has that name) is when the last pull was done.
  const TAGS = path.join(home, 'cache', 'danbooru-tags.json')
  let tags
  const load = () => tags ??= readJson(TAGS, {})
  const saveTags = () => { fs.mkdirSync(path.dirname(TAGS), { recursive: true }); fs.writeFileSync(TAGS, JSON.stringify(tags)) } // no indent
  const plain = body => body.split(/\r?\n\s*\r?\n/).map(p => p.trim()).find(p => p && !/^(h\d\.|\*|!post|\[(table|expand|quote|spoiler))/i.test(p))
    ?.replace(/\[\[([^\]|]+)\|\]\]/g, (_, t) => t.replace(/\s*\(.*\)$/, '')) // [[poster (object)|]]: the pipe trick drops the qualifier
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, '$1').replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/"([^"]+)":\[[^\]]*\]/g, '$1').replace(/"([^"]+)":\S+/g, '$1')
    .replace(/\[\/?[a-z]+(=[^\]]*)?\]/gi, '').replace(/\s+/g, ' ').trim() || null
  const entry = w => [plain(w.body ?? ''), w.tag?.post_count ?? 0, ...w.other_names ?? []]
  const ONLY = 'title,body,other_names,tag[post_count]'
  const pullTags = async () => {
    load()
    if (Date.now() - Date.parse(tags['']) < 30 * 864e5) return // NaN for none: pulled
    const got = {}
    for (const category of [0, 1, 3, 4]) for (let page = 1; ; page++) {
      const q = new URLSearchParams({ 'search[tag][category]': category, 'search[tag][post_count]': '>=100', 'search[is_deleted]': false, limit: 1000, only: ONLY, page })
      const l = await fetch(`https://danbooru.donmai.us/wiki_pages.json?${q}`, { signal: AbortSignal.timeout(60000), ...UA }).then(r => r.ok ? r.json() : null).catch(() => null)
      if (!l) return // offline or refused: the next start tries again
      for (const w of l) got[w.title] = entry(w)
      if (l.length < 1000) break
    }
    tags = { ...tags, ...got, '': new Date().toISOString() } // the ones asked for one by one stay
    saveTags()
    fs.rmSync(path.join(home, 'cache', 'tag-wiki.json'), { force: true }) // an older version's, explanations alone
  }
  const tagWiki = async tag => {
    load()
    if (Object.hasOwn(tags, tag)) return tags[tag][0]
    const r = await fetch(`https://danbooru.donmai.us/wiki_pages/${encodeURIComponent(tag)}.json?only=${ONLY}`, { signal: AbortSignal.timeout(8000), ...UA }).catch(() => null)
    if (!r || (!r.ok && r.status !== 404)) return null
    const j = r.ok && await r.json().catch(() => null)
    if (r.ok && !j) return null // cut off mid-read: asked again next time
    tags[tag] = j ? entry(j) : [null]
    saveTags()
    return tags[tag][0]
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
  // The tags a word in another language names (初音: hatsune_miku, 双马尾: twintails): [{ tag, said }], said the name it matched.
  // From the cache: a name that is the word, then one that begins with it, then one with it inside, more posts first. None
  // there (a tag on fewer posts, one newer than the pull): danbooru's autocomplete, which matches other names too; none when it
  // can't be reached.
  const tagsFor = async q => {
    const found = []
    for (const [tag, e] of Object.entries(load())) if (tag) {
      const said = e.slice(2).find(n => n === q) ?? e.slice(2).find(n => n.startsWith(q)) ?? e.slice(2).find(n => n.includes(q))
      if (said) found.push({ tag, said, rank: (said === q) * 2 + said.startsWith(q), posts: e[1] })
    }
    if (found.length) return found.sort((a, b) => b.rank - a.rank || b.posts - a.posts).slice(0, 20).map(({ tag, said }) => ({ tag, said }))
    return fetch(`https://danbooru.donmai.us/autocomplete.json?${new URLSearchParams({ 'search[query]': q, 'search[type]': 'tag_query', limit: 20 })}`,
      { signal: AbortSignal.timeout(5000), ...UA }).then(r => r.ok ? r.json() : []).then(l => l.map(x => ({ tag: x.value, said: x.antecedent ?? '' })), () => [])
  }
  return { UA, pullTags, tagWiki, useAliases, renamed, aliasing: () => alias !== null, artistOf, tagsFor }
}
