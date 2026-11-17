
const fs=require('fs');
const p='/Applications/DeepSeek Harness.app/Contents/Resources/app.asar';
const fd=fs.openSync(p,'r');
const head=Buffer.alloc(16); fs.readSync(fd,head,0,16,0);
const jsonLen=head.readUInt32LE(12);
const buf=Buffer.alloc(jsonLen); fs.readSync(fd,buf,0,jsonLen,16);
const idx=JSON.parse(buf.toString('utf8'));
const base=16+jsonLen;
function getNode(path){ let n=idx; for(const part of path.split('/')){ n=n.files&&n.files[part]; if(!n) return null; } return n; }
function read(path){ const n=getNode(path); if(!n||!n.size) return null; const b=Buffer.alloc(Number(n.size)); fs.readSync(fd,b,0,Number(n.size), base+Number(n.offset)); return b.toString('utf8'); }
const target=process.argv[2]; const re=new RegExp(process.argv[3], 'g');
const txt=read(target);
if(txt===null){ console.error('NOT FOUND'); process.exit(1); }
console.log('bytes='+txt.length);
const seen=new Set(); let m;
while((m=re.exec(txt))){ const s=txt.slice(Math.max(0,m.index-120), m.index+m[0].length+120); if(!seen.has(m[0])){ seen.add(m[0]); } console.log('--- @'+m.index+' :: '+JSON.stringify(m[0])); console.log(s.replace(/\n/g,' ')); if(seen.size>12) break; }
