// 在 asar 索引里递归按正则找路径。用法: node asar-find.cjs 'regex'
const fs=require('fs');
const p='/Applications/DeepSeek Harness.app/Contents/Resources/app.asar';
const fd=fs.openSync(p,'r');
const head=Buffer.alloc(16); fs.readSync(fd,head,0,16,0);
const jsonLen=head.readUInt32LE(12);
const buf=Buffer.alloc(jsonLen); fs.readSync(fd,buf,0,jsonLen,16);
const idx=JSON.parse(buf.toString('utf8'));
const re=new RegExp(process.argv[2]);
const out=[]; let visited=0;
(function walk(n,path){
  if(!n||!n.files) return;
  for(const k of Object.keys(n.files)){
    const c=n.files[k]; const q=path+'/'+k; visited++;
    if(re.test(q)) out.push((c.files?'DIR  ':'FILE ')+q);
    if(c.files) walk(c,q);
  }
})(idx,'');
console.log('visited='+visited+' matches='+out.length);
console.log(out.slice(0,200).join('\n'));
