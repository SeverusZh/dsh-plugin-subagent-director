
const fs = require('fs');
const z = require('node:zlib');
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
function findOffsets(buf) {
  const offs = [];
  for (let i = 0; i <= buf.length - 4; i++) {
    if (buf[i] === MAGIC[0] && buf[i+1] === MAGIC[1] && buf[i+2] === MAGIC[2] && buf[i+3] === MAGIC[3]) offs.push(i);
  }
  return offs;
}
const file = process.argv[2];
const buf = fs.readFileSync(file);
const offs = findOffsets(buf);
const parts = [];
for (let i = 0; i < offs.length; i++) {
  const start = offs[i];
  const end = i + 1 < offs.length ? offs[i+1] : buf.length;
  try {
    parts.push(z.zstdDecompressSync(buf.subarray(start, end)).toString('utf8'));
  } catch (e) {
    parts.push('[FRAME ' + i + ' DECODE ERROR: ' + e.message + ']');
  }
}
const text = parts.join('\n');
console.log('frames:', offs.length, '| total decoded chars:', text.length);
const lines = text.split('\n');
const interesting = lines.filter(l => /agentProvider|agentModel|provider|model|descriptor/i.test(l));
console.log('interesting lines:', interesting.length);
for (const l of interesting.slice(0, 80)) {
  console.log(l.length > 600 ? l.slice(0, 600) + ' ...[truncated]' : l);
}
if (interesting.length === 0) {
  console.log('--- first 3 lines sample ---');
  for (const l of lines.slice(0, 3)) console.log(l.length > 400 ? l.slice(0,400) : l);
}
