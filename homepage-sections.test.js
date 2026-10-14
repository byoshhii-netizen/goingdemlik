const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeHomepageSections } = require('./public/homepage-sections.js');

test('single selected homepage sections remain intact', () => {
  assert.deepEqual(normalizeHomepageSections(['fotograflar']), ['fotograflar']);
  assert.deepEqual(normalizeHomepageSections('fotograflar'), ['fotograflar']);
});

test('normal homepage selections remain intact', () => {
  assert.deepEqual(normalizeHomepageSections(['konular', 'fotograflar']), ['konular', 'fotograflar']);
  assert.deepEqual(normalizeHomepageSections([]), ['konular']);
});
