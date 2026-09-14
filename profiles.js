const PROFILES = {
  // Anima's card: "[quality/meta/year/safety tags] [1girl/1boy/1other etc] [character] [series] [artist] [general tags]", artist prefixed with @.
  anima: {
    caption: 'masterpiece, best quality, {{score}}, {{rating}}, {{character}}, {{copyright}}, @{{artist}}, {{tags}}',
    ratings: 'safe, sensitive, nsfw, explicit', // Anima's safety tags for danbooru's g, s, q, e
    scores: '3, 8, 15, 30, 60, 120', // ponytail: guessed booru-score thresholds for score_2..score_7; tune against real data
    spaces: true
  },
  plain: {
    caption: '{{tags}}',
    ratings: '',
    scores: '',
    spaces: false
  }
}

const list = s => s.split(',').map(x => x.trim()).filter(Boolean)

// meta values are plain strings; tags already comma-joined; rating is one of g/s/q/e or ''; score is the site's raw score.
const caption = (profile, meta) => {
  const values = { ...meta }
  const people = t => /^\d+(girl|boy|other)s?$/.test(t) // 1girl, 2boys... lead the general tags, as in Anima's training captions
  values.tags = list(String(meta.tags ?? '')).sort((a, b) => people(b) - people(a)).join(', ')
  values.rating = list(profile.ratings)['gsqe'.indexOf(meta.rating)] ?? ''
  values.score = meta.score === '' || meta.score == null ? '' : 'score_' + (1 + list(profile.scores).filter(t => Number(meta.score) >= Number(t)).length)
  const v = k => { const s = String(values[k] ?? ''); return profile.spaces && k !== 'score' && k !== 'rating' ? s.replace(/_/g, ' ') : s }
  return profile.caption.replace(/\{\{(\w+)\}\}/g, (_, k) => v(k))
    .split(',').map(x => x.trim()).filter(x => x && x !== '@').join(', ')
}

module.exports = { PROFILES, caption }

if (require.main === module) {
  const assert = require('assert')
  assert.equal(caption(PROFILES.anima, { tags: 'black_gloves, 1girl, smile', artist: 'cogecha', character: 'higuchi_kaede', copyright: 'nijisanji', rating: 'q', score: 45 }),
    'masterpiece, best quality, score_5, nsfw, higuchi kaede, nijisanji, @cogecha, 1girl, black gloves, smile')
  assert.equal(caption(PROFILES.anima, { tags: '1girl', score: 0 }), 'masterpiece, best quality, score_1, 1girl')
  assert.equal(caption(PROFILES.anima, { tags: '1girl', score: 500 }), 'masterpiece, best quality, score_7, 1girl')
  assert.equal(caption(PROFILES.anima, { tags: '1girl', rating: 'g' }), 'masterpiece, best quality, safe, 1girl')
  assert.equal(caption(PROFILES.plain, { tags: 'x', rating: 'e', score: 9 }), 'x')
  console.log('ok')
}
