const PROFILES = {
  // Anima's card: "[quality/meta/year/safety tags] [1girl/1boy/1other etc] [character] [series] [artist] [general tags]", artist prefixed with @.
  // Its score_N tags come from an aesthetic model we don't have; its quality tags come from human scores, which boorus have.
  anima: {
    caption: '{{quality}}, {{rating}}, {{character}}, {{copyright}}, @{{artist}}, {{tags}}',
    qualities: 'worst quality, low quality, normal quality, good quality, best quality, masterpiece',
    // Raw booru score, NSFW bias kept: danbooru's 10/30/60/85/95th percentiles, posts since 2020 (danbooru2026 dump).
    // ponytail: one scale for every site and post age; a post pulled the day it's up has few votes yet.
    scores: '2, 7, 20, 60, 130',
    spaces: true
  },
  plain: {
    caption: '{{tags}}',
    qualities: '',
    scores: '',
    spaces: false
  }
}

const list = s => s.split(',').map(x => x.trim()).filter(Boolean)
const RATINGS = ['general', 'sensitive', 'questionable', 'explicit'] // danbooru's g, s, q, e: the only rating words in the app
// Exported captions only: Anima's words for the two it names differently.
const EXPORT = { anima: { general: 'safe', questionable: 'nsfw' } }
const exported = (name, text) => EXPORT[name] ? list(text).map(t => EXPORT[name][t] ?? t).join(', ') : text

// The .txt holds a picture's general tags only, spaces for underscores, 1girl-style ones first: the part that reads the same for
// every model, and the only part written by hand. tags: comma-joined, underscores kept.
const people = t => /^\d+(girl|boy|other)s?$/.test(t)
const tagLine = tags => list(String(tags ?? '')).sort((a, b) => people(b) - people(a)).map(t => t.replace(/_/g, ' ')).join(', ')

// One written by hand (Edit > Quality) if any, else the tier of the booru score.
const quality = (profile, meta) => meta.quality ?? (meta.score === '' || meta.score == null ? '' : list(profile.qualities)[list(profile.scores).filter(t => Number(meta.score) >= Number(t)).length] ?? '')

// The template filled from the sidecar (meta), with the .txt's tags as {{tags}}; without them, the head the app shows above them.
// meta values are plain strings; rating is one of g/s/q/e or ''; score is the site's raw score.
const caption = (profile, meta, tags = '') => {
  const values = { ...meta, tags }
  values.rating = RATINGS['gsqe'.indexOf(meta.rating)] ?? ''
  values.quality = quality(profile, meta)
  const v = k => {
    const s = String(values[k] ?? '')
    if (k === 'tags') return profile.spaces ? s : list(s).map(t => t.replace(/ /g, '_')).join(', ')
    return profile.spaces ? s.replace(/_/g, ' ') : s
  }
  return profile.caption.replace(/\{\{(\w+)\}\}/g, (_, k) => v(k))
    .split(',').map(x => x.trim()).filter(x => x && x !== '@').join(', ')
}

module.exports = { PROFILES, caption, exported, tagLine, quality }

if (require.main === module) {
  const assert = require('assert')
  const m = { tags: 'black_gloves, 1girl, smile', artist: 'cogecha', character: 'higuchi_kaede', copyright: 'nijisanji', rating: 'q', score: 45 }
  assert.equal(tagLine(m.tags), '1girl, black gloves, smile')
  assert.equal(caption(PROFILES.anima, m), 'good quality, questionable, higuchi kaede, nijisanji, @cogecha')
  assert.equal(caption(PROFILES.anima, m, tagLine(m.tags)), 'good quality, questionable, higuchi kaede, nijisanji, @cogecha, 1girl, black gloves, smile')
  assert.equal(caption(PROFILES.plain, m, 'black gloves, score_7'), 'black_gloves, score_7')
  assert.equal(caption(PROFILES.anima, { score: 0 }, '1girl'), 'worst quality, 1girl')
  assert.equal(caption(PROFILES.anima, { score: 130 }, 'score_7'), 'masterpiece, score_7')
  assert.equal(caption(PROFILES.anima, { rating: 'g' }), 'general')
  assert.equal(caption(PROFILES.anima, { score: 0, quality: 'best_quality' }), 'best quality')
  assert.equal(exported('anima', 'good quality, questionable, 1girl'), 'good quality, nsfw, 1girl')
  assert.equal(exported('plain', 'general, 1girl'), 'general, 1girl')
  assert.equal(caption(PROFILES.plain, { rating: 'e', score: 9 }, 'x'), 'x')
  console.log('ok')
}
