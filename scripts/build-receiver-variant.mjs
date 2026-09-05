// 构建「仅接收」分发变体：webapp/receiver-only/
// - 以 vendored dist（webapp/dist，字节原样）为底，仅做外层包装：
//   注入 receiver-guard.js（hash 锁定到 #receive + 隐藏发送 tab）与一段 CSS
// - 不修改 dist 内任何文件；监管要求：文件发送只能来自带登记的服务端工作台
// 用法：node scripts/build-receiver-variant.mjs
import { cpSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'webapp', 'dist');
const out = join(root, 'webapp', 'receiver-only');
const zipPath = join(root, 'webapp', 'transfer-hub-receiver-offline.zip');

const guardJs = `/* Transfer Hub 接收端专用构建：仅接收（本文件为分发包装层，非内核） */
(function () {
  'use strict';
  function isReceive() {
    var h = (window.location.hash || '').replace(/^#/, '').toLowerCase();
    return h === 'receive' || h === 'receiver';
  }
  function enforce() {
    if (!isReceive()) {
      // replace 不产生历史记录，避免后退绕回发送页
      window.location.replace(window.location.pathname + window.location.search + '#receive');
    }
    hideSendTab();
  }
  function hideSendTab() {
    var tabs = document.querySelectorAll('button[role="tab"]');
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].textContent.indexOf('发送') !== -1) {
        tabs[i].style.display = 'none';
      }
    }
  }
  window.addEventListener('hashchange', enforce);
  setInterval(enforce, 600);
  document.addEventListener('DOMContentLoaded', enforce);
  enforce();
})();`;

const guardStyle = '/* receiver-only build */button[role="tab"]{visibility:visible}';

function fail(msg) {
  console.error(`[receiver-only] ✗ ${msg}`);
  process.exit(1);
}

if (!existsSync(join(dist, 'index.html'))) fail('webapp/dist/index.html 不存在，请先放置完整内核 dist');

// 1) 复制完整 dist
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(dist, out, { recursive: true });

// 2) 注入守卫（不改动 dist 内文件——这里改的是副本 receiver-only）
const indexPath = join(out, 'index.html');
let html = readFileSync(indexPath, 'utf8');
if (html.includes('receiver-guard.js')) fail('dist 已含守卫标记，疑似拷贝了变体产物');
const inject = `<style>${guardStyle}</style><script src="./receiver-guard.js"></script>`;
if (!html.includes('</head>')) fail('index.html 缺少 </head>，无法注入守卫');
html = html.replace('</head>', `${inject}\n</head>`);
writeFileSync(indexPath, html, 'utf8');
writeFileSync(join(out, 'receiver-guard.js'), guardJs, 'utf8');

// 3) 打 zip（供 /receiver/download 分发）
rmSync(zipPath, { force: true });
const zipfile = join(root, 'webapp', 'receiver-only.zip.tmp');
// 用系统 zip 不可靠，这里用 Node 侧 zip：为避免第三方依赖，直接调用 PowerShell Compress-Archive 的替代——
// 简单起见调用 python（构建机必有），与 build-receiver-apk.py 同一依赖。
execFileSync('python', [
  '-c',
  [
    "import os, sys, zipfile",
    `src = r'${out}'`,
    `dst = r'${zipPath}'`,
    "zf = zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED)",
    "for base, dirs, files in os.walk(src):",
    "    for f in files:",
    "        full = os.path.join(base, f)",
    "        zf.write(full, os.path.relpath(full, src))",
    "zf.close()",
    "print('zip ok', os.path.getsize(dst))",
  ].join('\n'),
], { stdio: 'inherit' });
rmSync(zipfile, { force: true });

const size = statSync(zipPath).size;
if (size < 1024 * 1024) fail('产物 zip 异常过小');
console.log(`[receiver-only] ✓ ${out}`);
console.log(`[receiver-only] ✓ ${zipPath} (${size} B)`);
