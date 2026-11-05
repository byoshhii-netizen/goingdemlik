const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeHomepageSections, getHomepageSections } = require('./public/homepage-sections.js');

test('single selected homepage sections remain intact', () => {
  assert.deepEqual(normalizeHomepageSections(['fotograflar']), ['fotograflar']);
  assert.deepEqual(normalizeHomepageSections('fotograflar'), ['fotograflar']);
});

test('normal homepage selections remain intact', () => {
  assert.deepEqual(normalizeHomepageSections(['konular', 'fotograflar']), ['konular', 'fotograflar']);
  assert.deepEqual(normalizeHomepageSections([]), ['konular']);
});

test('homepage sections can differ on desktop and fall back to the shared selection', () => {
  const settings = {
    homepage_sections: '["konular","fotograflar"]',
    homepage_sections_desktop: '["kitaplar"]'
  };
  assert.deepEqual(getHomepageSections(settings, false), ['konular', 'fotograflar']);
  assert.deepEqual(getHomepageSections(settings, true), ['kitaplar']);
  assert.deepEqual(getHomepageSections({ homepage_sections: '["konular"]' }, true), ['konular']);
  assert.deepEqual(getHomepageSections({ homepage_sections: '["konular"]', homepage_sections_desktop: '' }, true), ['konular']);
});
