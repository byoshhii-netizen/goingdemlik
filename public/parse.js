const fs = require('fs');
const acorn = require('acorn');
const text = fs.readFileSync('app.js', 'utf8');
try {
  acorn.parse(text, { ecmaVersion: 2023, sourceType: 'script' });
  console.log('ok');
} catch (e) {
  console.error(e.message);
  console.error('line', e.loc.line, 'column', e.loc.column);
  process.exit(1);
}
