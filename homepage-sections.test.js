const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeHomepageSections } = require('./public/homepage-sections.js');

test('media-only homepage is rejected', () => {
  assert.deepEqual(normalizeHomepageSections(['fotograflar']), ['konular']);
  assert.deepEqual(normalizeHomepageSections('fotograflar'), ['konular']);
});

test('normal homepage selections remain intact', () => {
  assert.deepEqual(normalizeHomepageSections(['konular', 'fotograflar']), ['konular', 'fotograflar']);
  assert.deepEqual(normalizeHomepageSections([]), ['konular']);
});
