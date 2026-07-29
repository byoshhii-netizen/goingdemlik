/**
 * Build script: admin.js ve app.js'yi obfuscate eder.
 * Çalıştır: node build.js
 * Gerekli: npm install (javascript-obfuscator)
 */
const fs = require('fs');
const path = require('path');

let JavaScriptObfuscator;
try {
  JavaScriptObfuscator = require('javascript-obfuscator');
} catch (e) {
  console.warn('javascript-obfuscator yüklü değil. npm install yapın.');
  process.exit(0);
}

const files = [
  { src: 'public/admin.js', out: 'public/admin.js' },
  { src: 'public/app.js',   out: 'public/app.js' },
];

const baseOpts = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  rotateStringArray: true,
  shuffleStringArray: true,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  selfDefending: false,
  splitStrings: true,
  splitStringsChunkLength: 10,
  unicodeEscapeSequence: false,
};

for (const { src, out } of files) {
  if (!fs.existsSync(src)) { console.log('Atlandı (bulunamadı):', src); continue; }
  console.log('Obfuscating:', src);
  const code = fs.readFileSync(src, 'utf8');
  const result = JavaScriptObfuscator.obfuscate(code, baseOpts);
  fs.writeFileSync(out, result.getObfuscatedCode(), 'utf8');
  console.log('  Tamamlandı:', out);
}
console.log('Build tamamlandı.');
