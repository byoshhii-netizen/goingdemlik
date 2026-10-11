const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword, needsRehash } = require('./password');

test('passwords are stored as salted scrypt hashes and verify correctly', () => {
  const password = 'CigCig-Strong-Test-Password';
  const stored = hashPassword(password);

  assert.match(stored, /^scrypt\$131072\$8\$1\$/);
  assert.notEqual(stored, password);
  assert.equal(verifyPassword(password, stored), true);
  assert.equal(verifyPassword('wrong password', stored), false);
  assert.equal(needsRehash(stored), false);
});
