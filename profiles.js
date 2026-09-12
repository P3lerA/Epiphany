const PROFILES = {
  anima: {
    caption: 'best quality, masterpiece, {{score}}, {{rating}}, @{{artist}}, {{tags}}',
    ratings: 'general, sensitive, questionable, explicit', // words for g, s, q, e
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
  values.rating = list(profile.ratings)['gsqe'.indexOf(meta.rating)] ?? ''
  values.score = meta.score === '' || meta.score == null ? '' : 'score_' + (1 + list(profile.scores).filter(t => Number(meta.score) >= Number(t)).length)
  const v = k => { const s = String(values[k] ?? ''); return profile.spaces && k !== 'score' && k !== 'rating' ? s.replace(/_/g, ' ') : s }
  return profile.caption.replace(/\{\{(\w+)\}\}/g, (_, k) => v(k))
    .split(',').map(x => x.trim()).filter(x => x && x !== '@').join(', ')
}

module.exports = { PROFILES, caption }

if (require.main === module) {
  const assert = require('assert')
  assert.equal(caption(PROFILES.anima, { tags: '1girl, black_gloves', artist: 'cogecha', rating: 's', score: 45 }),
    'best quality, masterpiece, score_5, sensitive, @cogecha, 1girl, black gloves')
  assert.equal(caption(PROFILES.anima, { tags: '1girl', score: 0 }), 'best quality, masterpiece, score_1, 1girl')
  assert.equal(caption(PROFILES.anima, { tags: '1girl', score: 500 }), 'best quality, masterpiece, score_7, 1girl')
  assert.equal(caption(PROFILES.anima, { tags: '1girl' }), 'best quality, masterpiece, 1girl')
  assert.equal(caption(PROFILES.plain, { tags: 'x', rating: 'e', score: 9 }), 'x')
  console.log('ok')
}
