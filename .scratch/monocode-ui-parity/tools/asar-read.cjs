// 读 DSH app.asar 里的文件。
// 用法: node asar-read.cjs 'dsh/node_modules/@deepseek-ai/xxx/README.md'
// 说明: cat/ls/node fs 直接读 asar 路径会失败（它不是目录），这里按 asar 头部索引取偏移。
const fs = require('node:fs');
const ARCHIVE = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar';
const fd = fs.openSync(ARCHIVE, 'r');
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
const headerSize = head.readUInt32LE(4);      // pickle: 8 + headerSize = data 起点
const jsonLen = head.readUInt32LE(12);
const json = Buffer.alloc(jsonLen);
fs.readSync(fd, json, 0, jsonLen, 16);
const index = JSON.parse(json.toString('utf8'));
const base = 8 + headerSize;

function read(innerPath) {
  let node = index;
  for (const part of innerPath.replace(/^\/+/, '').split('/')) {
    node = node.files && node.files[part];
    if (!node) return null;
  }
  if (node.offset == null) return null;
  const out = Buffer.alloc(Number(node.size));
  fs.readSync(fd, out, 0, Number(node.size), base + Number(node.offset));
  return out.toString('utf8');
}

const target = process.argv[2];
if (!target) { console.error('usage: node asar-read.cjs <path-inside-asar>'); process.exit(2); }
const text = read(target);
if (text === null) { console.error('NOT FOUND: ' + target); process.exit(1); }
process.stdout.write(text);
