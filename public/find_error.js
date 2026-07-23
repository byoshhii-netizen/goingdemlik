const fs = require('fs');
const acorn = require('acorn');
const text = fs.readFileSync('app.js', 'utf8');
const lines = text.split('\n');
let low = 1;
let high = lines.length;
let lastOk = 0;
while (low <= high) {
  const mid = Math.floor((low + high) / 2);
  const subset = lines.slice(0, mid).join('\n');
  try {
    acorn.parse(subset, { ecmaVersion: 2023, sourceType: 'script' });
    lastOk = mid;
    low = mid + 1;
  } catch (e) {
    high = mid - 1;
  }
}
console.log('last OK line', lastOk);
console.log('next line maybe error', lastOk + 1);
console.log('context:');
console.log(lines.slice(Math.max(0,lastOk-10), Math.min(lines.length, lastOk+10)).map((l,i)=>`${i+Math.max(0,lastOk-10)+1}: ${l}`).join('\n'));
