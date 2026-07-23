const fs = require('fs');
const p = 'public/app.js';
let s = fs.readFileSync(p, 'utf8');
const marker = ':16px">';
let i = s.indexOf(marker);
if (i === -1) {
  console.log('marker not found');
  process.exit(0);
}
let start = s.lastIndexOf('\n', i);
if (start < 0) start = 0;
const newS = s.slice(0, start).replace(/[ \t]+$/g, '') + '\n';
fs.writeFileSync(p, newS, 'utf8');
console.log('truncated at', start);
