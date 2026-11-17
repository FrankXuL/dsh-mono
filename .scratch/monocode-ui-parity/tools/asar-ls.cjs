// 列 app.asar 里的目录 / 看文件大小。用法: node asar-ls.cjs 'dsh/node_modules/@deepseek-ai'
const fs=require('fs');
const p='/Applications/DeepSeek Harness.app/Contents/Resources/app.asar';
const fd=fs.openSync(p,'r');
const head=Buffer.alloc(16); fs.readSync(fd,head,0,16,0);
const jsonLen=head.readUInt32LE(12);
const buf=Buffer.alloc(jsonLen); fs.readSync(fd,buf,0,jsonLen,16);
const idx=JSON.parse(buf.toString('utf8'));
function node(path){ let n=idx; if(!path) return n; for(const part of path.split('/')){ n=n.files&&n.files[part]; if(!n) return null; } return n; }
const tgt=process.argv[2]||'';
const n=node(tgt);
if(!n){console.error('NOT FOUND '+tgt);process.exit(1);}
if(n.files){ console.log(Object.keys(n.files).sort().join('\n')); } else { console.log('FILE size='+n.size); }
