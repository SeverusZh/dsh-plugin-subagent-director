const fs=require('fs');const z=require('node:zlib');const MAGIC=Buffer.from([0x28,0xb5,0x2f,0xfd]);
function findOffsets(buf){const o=[];for(let i=0;i<=buf.length-4;i++){if(buf[i]===MAGIC[0]&&buf[i+1]===MAGIC[1]&&buf[i+2]===MAGIC[2]&&buf[i+3]===MAGIC[3])o.push(i);}return o;}
const file=process.argv[2];const out=process.argv[3];const buf=fs.readFileSync(file);const offs=findOffsets(buf);const parts=[];
for(let i=0;i<offs.length;i++){const s=offs[i];const e=i+1<offs.length?offs[i+1]:buf.length;try{parts.push(z.zstdDecompressSync(buf.subarray(s,e)).toString('utf8'));}catch(err){parts.push('[FRAME '+i+' ERR '+err.message+']');}}
fs.writeFileSync(out, parts.join('\n'),'utf8');console.log('wrote', out);
