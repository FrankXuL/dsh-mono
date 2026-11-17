
const fs=require('fs');
const p='/Applications/DeepSeek Harness.app/Contents/Resources/app.asar';
const fd=fs.openSync(p,'r');
const head=Buffer.alloc(16); fs.readSync(fd,head,0,16,0);
const jsonLen=head.readUInt32LE(12);
const buf=Buffer.alloc(jsonLen); fs.readSync(fd,buf,0,jsonLen,16);
const idx=JSON.parse(buf.toString('utf8'));
const base=16+jsonLen;
function read(path){ let n=idx; for(const part of path.split('/')){ n=n.files&&n.files[part]; if(!n) return null; } if(!n.size) return null; const b=Buffer.alloc(Number(n.size)); fs.readSync(fd,b,0,Number(n.size), base+Number(n.offset)); return b.toString('utf8'); }
const txt=read(process.argv[2]);
const start=Number(process.argv[3]); const len=Number(process.argv[4]||1200);
console.log(txt.slice(start, start+len));
