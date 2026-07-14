const fs = require('fs');
const text = fs.readFileSync('app.js', 'utf8');
let state = 'normal';
let stack = [];
let line = 1;
const counts = { '{': 0, '}': 0, '(': 0, ')': 0, '[': 0, ']': 0 };
for (let i = 0; i < text.length; i++) {
  const ch = text[i];
  const next = text[i + 1];
  if (ch === '\n') { line++; if (state === 'line-comment') state = 'normal'; continue; }
  if (state === 'normal') {
    if (ch === '/' && next === '/') { state = 'line-comment'; i++; continue; }
    if (ch === '/' && next === '*') { state = 'block-comment'; i++; continue; }
    if (ch === '"') { state = 'double'; continue; }
    if (ch === "'") { state = 'single'; continue; }
    if (ch === '`') { state = 'template'; continue; }
    if (ch === '{' || ch === '}' || ch === '(' || ch === ')' || ch === '[' || ch === ']') {
      counts[ch]++;
      continue;
    }
  } else if (state === 'single') {
    if (ch === '\\') { i++; continue; }
    if (ch === "'") state = 'normal';
    continue;
  } else if (state === 'double') {
    if (ch === '\\') { i++; continue; }
    if (ch === '"') state = 'normal';
    continue;
  } else if (state === 'template') {
    if (ch === '\\') { i++; continue; }
    if (ch === '`') { state = 'normal'; continue; }
    if (ch === '$' && next === '{') { counts['{']++; i++; continue; }
    continue;
  } else if (state === 'block-comment') {
    if (ch === '*' && next === '/') { state = 'normal'; i++; continue; }
    continue;
  } else if (state === 'line-comment') {
    continue;
  }
}
console.log(counts);
console.log('state', state);
console.log('last line', line);
