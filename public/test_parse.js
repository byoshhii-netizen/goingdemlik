const fs = require('fs');
const acorn = require('acorn');
const text = fs.readFileSync('app.js', 'utf8');
const lines = text.split(/\r?\n/);
for (let n = 40; n <= lines.length; n += 10) {
  try {
    acorn.parse(lines.slice(0, n).join('\n'), { ecmaVersion: 2023, sourceType: 'script' });
    console.log('ok', n);
  } catch (e) {
    console.log('fail', n, e.loc ? e.loc.line : 'no loc', e.message);
    break;
  }
}
