const fs = require('fs');
const acorn = require('acorn');
const lines = fs.readFileSync('app.js', 'utf8').split(/\r?\n/);
for (let n = 41; n <= 50; n++) {
  try {
    acorn.parse(lines.slice(0, n).join('\n'), { ecmaVersion: 2023, sourceType: 'script' });
    console.log('ok', n);
  } catch (e) {
    console.log('fail', n, e.loc ? `${e.loc.line}:${e.loc.column}` : 'no loc', e.message);
  }
}
