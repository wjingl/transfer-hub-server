'use strict';
/* ============================================================================
 * prep：校验 vendored 传输内核（webapp/dist）与离线包的完整性
 * - 内核为 TransferHub 构建产物的字节原样副本（含官方 Cimbar v0.6.8 运行时）
 * - 本脚本只做校验与清单刷新，绝不修改内核文件
 * 用法：node scripts/prep.js
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'webapp', 'dist');
const ZIP = path.join(ROOT, 'webapp', 'transfer-hub-receiver-offline.zip');
const APK = path.join(ROOT, 'webapp', 'transfer-hub-receiver-android.apk');
const BASE_APK = path.join(ROOT, 'webapp', 'transfer-hub-android.apk');

function fail(msg) {
  // eslint-disable-next-line no-console
  console.error(`[prep] ✗ ${msg}`);
  process.exit(1);
}

function sha256(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  fail('webapp/dist/index.html 不存在：请先放入 TransferHub 构建产物（npm run build 于上游仓库，或解压发布包）。');
}

// 1) index.html 引用的本地 bundle 必须存在
const index = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const refs = [...index.matchAll(/(?:src|href)="(\.\/assets\/[^"]+|\.\/sw\.js|\.\/manifest\.webmanifest)"/g)].map((m) => m[1].slice(2));
for (const rel of refs) {
  if (!fs.existsSync(path.join(DIST, rel))) fail(`index.html 引用的 ${rel} 不存在`);
}

// 2) 官方 Cimbar 运行时五件套必须齐全（版本名固定，禁止改名/改内容）
const CIMBAR = [
  'cimbar_js.2026-08-21T2336.js',
  'cimbar_js.2026-08-21T2336.wasm',
  'send.2026-08-21T2336.js',
  'send-worker.2026-08-21T2336.js',
  'recv-worker.2026-08-21T2336.js',
  'recv.2026-08-21T2336.js',
  'zstd.2026-08-21T2336.js',
];
for (const f of CIMBAR) {
  const p = path.join(DIST, 'cimbar', f);
  if (!fs.existsSync(p)) fail(`cimbar/${f} 缺失（官方运行时必须完整随包）`);
}

// 3) 离线包与 Android APK 必须存在且 >1MB
const zipOk = fs.existsSync(ZIP) && fs.statSync(ZIP).size > 1024 * 1024;
if (!zipOk) fail('webapp/transfer-hub-receiver-offline.zip 缺失或过小（先运行 npm run build:receiver）');
const apkOk = fs.existsSync(APK) && fs.statSync(APK).size > 1024 * 1024;
const baseApkOk = fs.existsSync(BASE_APK) && fs.statSync(BASE_APK).size > 1024 * 1024; // 仅接收 APK 的重打包底稿
if (!apkOk) fail('webapp/transfer-hub-receiver-android.apk 缺失或过小（先运行 npm run build:receiver）');
if (!baseApkOk) fail('webapp/transfer-hub-android.apk 缺失或过小（放入与 dist 同构建的完整版 Release APK 作为重打包底稿）');

// 4) 刷新清单（provenance）
const bundle = refs.find((r) => /^assets\/index-.*\.js$/.test(r)) || '';
const manifest = {
  note: 'vendored TransferHub transfer core (byte-identical dist); cimbar runtime = pristine sz3/libcimbar v0.6.8 release files',
  indexHtmlRefs: refs,
  bundle,
  cimbar: Object.fromEntries(CIMBAR.map((f) => [f, sha256(path.join(DIST, 'cimbar', f)).slice(0, 32)])),
  offlineZipBytes: fs.statSync(ZIP).size,
  androidApkBytes: fs.statSync(APK).size, // 仅接收重签版
  verifiedAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(ROOT, 'webapp', 'VERSION.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

// eslint-disable-next-line no-console
console.log(`[prep] ✓ 内核完整：bundle=${bundle}，cimbar×${CIMBAR.length}，离线包 ${manifest.offlineZipBytes} B，APK ${manifest.androidApkBytes} B`);
