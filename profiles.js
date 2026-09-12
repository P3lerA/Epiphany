const PROFILES = {
  anima: {
    caption: 'best quality, masterpiece, {{rating}}, {{tags}}, score_7, @{{artist}}',
    ratings: 'general, sensitive, questionable, explicit', // words for g, s, q, e
    spaces: true
  },
  plain: {
    caption: '{{tags}}',
    ratings: '',
    spaces: false
  }
}

// meta values are plain strings; tags already comma-joined; rating is one of g/s/q/e or ''.
const caption = (profile, meta) => {
  const ratings = profile.ratings.split(',').map(x => x.trim())
  const values = { ...meta, rating: ratings['gsqe'.indexOf(meta.rating)] ?? '' }
  const v = k => { const s = String(values[k] ?? ''); return profile.spaces ? s.replace(/_/g, ' ') : s }
  return profile.caption.replace(/\{\{(\w+)\}\}/g, (_, k) => v(k))
    .split(',').map(x => x.trim()).filter(x => x && x !== '@').join(', ')
}

module.exports = { PROFILES, caption }

if (require.main === module) {
  const assert = require('assert')
  assert.equal(caption(PROFILES.anima, { tags: '1girl, black_gloves', artist: 'cogecha', rating: 's' }),
    'best quality, masterpiece, sensitive, 1girl, black gloves, score_7, @cogecha')
  assert.equal(caption(PROFILES.anima, { tags: '1girl' }), 'best quality, masterpiece, 1girl, score_7')
  assert.equal(caption({ ...PROFILES.anima, spaces: false }, { tags: 'a_b', rating: 'g' }), 'best quality, masterpiece, general, a_b, score_7')
  assert.equal(caption(PROFILES.plain, { tags: 'x', rating: 'e' }), 'x')
  console.log('ok')
}
