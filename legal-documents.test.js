const test = require('node:test');
const assert = require('node:assert/strict');
const { LEGAL_DOCUMENT_DEFAULTS, createLegalDocumentsVersion } = require('./legal-documents');

test('registration legal documents have readable defaults', () => {
  for (const key of ['information_notice', 'privacy_policy', 'kvkk_text']) {
    assert.ok(LEGAL_DOCUMENT_DEFAULTS[key].trim().length > 100);
  }
});

test('legal document version changes when any text changes', () => {
  const version = createLegalDocumentsVersion(LEGAL_DOCUMENT_DEFAULTS);
  assert.equal(createLegalDocumentsVersion({ ...LEGAL_DOCUMENT_DEFAULTS }), version);
  assert.notEqual(createLegalDocumentsVersion({
    ...LEGAL_DOCUMENT_DEFAULTS,
    privacy_policy: LEGAL_DOCUMENT_DEFAULTS.privacy_policy + '\nGüncel sürüm.'
  }), version);
});
