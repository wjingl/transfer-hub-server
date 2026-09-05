// 服务器版全盘中文化：对本仓库 vendored 的 TransferHub dist（webapp/dist）
// 做精确字符串变换（quoted 全词替换）。仅替换本项目自有 UI 的界面文案，
// 不触碰官方 Cimbar 运行时文件，不改动 worker 协议串（如 'encoded'）。
// 用法：
//   node scripts/localize-webapp.mjs --report   # 只报告每个条目的命中次数
//   node scripts/localize-webapp.mjs            # 应用变换并写 .localized-zh 标记
// 幂等：已本地化（标记存在且英文串不再出现）时直接跳过。
import { readFile, writeFile, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'webapp', 'dist');
const report = process.argv.includes('--report');
const marker = join(dist, '.localized-zh');

// [期望命中次数, 英文原文, 中文译文]。期望次数 = 应用于 bundle 后应精确匹配的
// 引号内全词出现次数（含双引号），防止误伤代码标识符；index.html/manifest 单独处理。
const TABLE = [
  // ── RaptorQR 发送页 ──
  [1, 'Start Live QR', '开始实况二维码'],
  [2, 'Encoding live QR…', '正在生成实况二维码…'],
  [1, 'Rendering first QR frame…', '正在渲染首帧二维码…'],
  [1, 'Stopped.', '已停止。'],
  [1, 'Stopped', '已停止'],
  [2, 'Stop', '停止'],
  [1, 'Please enter some text.', '请先输入要传输的文本。'],
  [1, 'Please select a file.', '请先选择要传输的文件。'],
  [1, 'Encode worker timed out', '编码 Worker 超时'],
  [1, 'Start a live QR transfer before preparing a GIF.', '请先开始实况二维码传输，再生成 GIF。'],
  [1, 'Preparing GIF export…', '正在导出 GIF…'],
  [1, 'GIF worker timed out', 'GIF Worker 超时'],
  [1, 'GIF ready.', 'GIF 已生成。'],
  [1, 'Fullscreen is not supported in this browser.', '当前浏览器不支持全屏。'],
  [1, 'Type or paste text to transfer…', '输入或粘贴要传输的文本…'],
  [2, 'Hide advanced settings', '收起高级设置'],
  [2, 'Advanced settings', '高级设置'],
  [1, 'Live QR transfer frames', '实况二维码传输帧'],
  [1, 'Prepare GIF', '生成 GIF'],
  [1, 'Not applicable (JS RLNC)', '不适用（JS RLNC）'],
  [2, 'Not running', '未在运行'],
  [1, 'Preparing…', '准备中…'],
  [2, 'Not prepared', '未生成'],
  [1, 'RaptorQ packets', 'RaptorQ 包'],
  [1, 'Generations', '代数'],
  [1, 'L - low', 'L - 低'],
  [1, 'M - medium', 'M - 中'],
  [1, 'Q - quartile', 'Q - 较高'],
  [1, 'H - high', 'H - 最高'],
  [1, 'Canvas 2D context is unavailable for QR tile cache.', '无法获取 Canvas 2D 上下文（二维码块缓存）。'],
  [1, 'No QR packets were generated.', '未生成任何二维码数据包。'],
  [1, 'RaptorQ packet classification metadata is missing.', '缺少 RaptorQ 包分类元数据。'],
  [1, 'Canvas 2D context is unavailable.', '无法获取 Canvas 2D 上下文。'],
  [1, 'Input mode', '输入模式'],
  [1, 'File', '文件'],
  [1, 'Text', '文本'],
  [2, 'QR size', '二维码规格'],
  [1, 'QR ECC', '二维码纠错'],
  [2, 'QR encoder', '二维码编码器'],
  [3, 'FEC codec', 'FEC 编解码'],
  [1, 'RaptorQ repair', 'RaptorQ 修复率'],
  [1, 'Less QR', '二维码更少'],
  [1, 'More repair', '修复更强'],
  [2, 'RaptorQ playback', 'RaptorQ 播放'],
  [1, 'QR speed', '二维码速度'],
  [3, 'Fast', '快速'],
  [2, 'Parallel QR', '并行二维码'],
  [1, 'Fullscreen QR', '二维码全屏'],
  [1, 'Live QR Transfer', '实况二维码传输'],
  [1, 'Transfer Info', '传输信息'],
  [1, 'Original size', '原始大小'],
  [1, 'Preprocessed size', '预处理后大小'],
  [1, 'Symbol payload', '单码载荷'],
  [1, 'QR packets', '二维码包'],
  [1, 'Live speed', '实况速度'],
  [1, 'Actual live fps', '实况实际帧率'],
  [1, 'QR render cache', '二维码渲染缓存'],
  [1, 'GIF export speed', 'GIF 导出速度'],
  [1, 'GIF size', 'GIF 大小'],
  // ── RaptorQR 接收页 ──
  [1, 'Input Mode', '输入模式'],
  [1, 'Camera', '摄像头'],
  [1, 'FEC codec', null], // 与发送页同串，已计
  [1, 'Decode preset', '解码预设'],
  [1, 'Max symbols', '最大符号数'],
  [1, 'Binarizer', '二值化器'],
  [1, 'Downscale factor', '缩放系数'],
  [1, 'Scan rate', '扫描帧率'],
  [2, 'Stable', '稳定'],
  [1, 'Balance', '均衡'],
  [1, 'Robust', '稳健'],
  [1, 'Custom', '自定义'],
  [1, 'Auto (4)', '自动（4）'],
  [1, 'Scanning…', '扫描中…'],
  [1, 'Upload GIF', '上传 GIF'],
  [1, 'Choose GIF', '选择 GIF'],
  [1, 'Parsing GIF frames…', '正在解析 GIF 帧…'],
  [1, 'No frames found in GIF', 'GIF 中未找到可用帧'],
  [1, 'GIF processed', 'GIF 处理完成'],
  [2, 'Working…', '处理中…'],
  [1, 'Full-frame scan is active.', '已启用全画面扫描。'],
  [1, 'Processing GIF…', '正在处理 GIF…'],
  [1, 'No GIF selected', '未选择 GIF'],
  [1, 'Copied', '已复制'],
  [1, 'Copy text', '复制文本'],
  [1, 'Clipboard command was rejected.', '剪贴板操作被拒绝。'],
  [2, 'Complete ✓', '接收完成 ✓'],
  [1, 'Camera zoom failed:', '摄像头变焦失败：'],
  [1, 'Recovered Text', '恢复的文本'],
  [1, 'Recovered File', '恢复的文件'],
  // 统计图例（带尾随空格的 JSX 文本，报告模式校准）
  [2, 'decoded', '已解码'],
  [2, 'unique ', '唯一包 '],
  [2, 'useful ', '有效包 '],
  [2, 'dupes ', '重复包 '],
  [2, 'gens ', '代数 '],
  [2, 'time ', '耗时 '],
  [2, 'speed ', '速度 '],
  [2, 'decode ', '解码 '],
].filter((e) => e[2] !== null);

const HTML = [
  ['<html lang="en">', '<html lang="zh-CN">'],
  ['<title>RaptorQR</title>', '<title>传输中枢 · 双协议离线传输</title>'],
];

const MANIFEST = [
  ['"name": "RaptorQR"', '"name": "传输中枢"'],
  ['"short_name": "RaptorQR"', '"short_name": "传输中枢"'],
  ['"description": "High-speed offline file and text transfer over animated QR codes."',
   '"description": "基于动态二维码的高速离线文件与文本传输。"'],
];

function fail(msg) {
  console.error(`[localize] ✗ ${msg}`);
  process.exit(1);
}

async function bundlePaths() {
  const dir = join(dist, 'assets');
  return readdirSync(dir).filter((f) => /^index-.*\.js$/.test(f)).map((f) => join(dir, f));
}

async function main() {
  if (!existsSync(join(dist, 'index.html'))) fail('webapp/dist/index.html 不存在，请先同步 dist。');
  if (existsSync(marker) && !report) {
    console.log('[localize] 已存在 .localized-zh 标记，跳过（如需重打请删除标记）。');
    return;
  }

  const bundles = await bundlePaths();
  let text = '';
  for (const b of bundles) text += await readFile(b, 'utf8');
  text += await readFile(join(dist, 'index.html'), 'utf8');

  const reportRows = [];
  const problems = [];
  for (const [count, en, zh] of TABLE) {
    const needle = JSON.stringify(en); // 带引号全词
    const hits = text.split(needle).length - 1;
    reportRows.push([hits, en, zh, count]);
    if (count > 0 && hits !== count) {
      problems.push(`"${en}" 期望 ${count} 次，实际 ${hits} 次`);
    }
  }

  console.log('命中报告（实际/期望  原文 → 译文）：');
  for (const [hits, en, zh, count] of reportRows) {
    const mark = count === 0 ? '?' : hits === count ? '✓' : '✗';
    console.log(`  ${mark} ${hits}/${count || '-'}  ${en} → ${zh}`);
  }
  if (report) return;
  if (problems.length) {
    fail(`以下条目命中数与预期不符（bundle 可能已更新，请核对 TABLE）：\n  ${problems.join('\n  ')}`);
  }

  // 应用到所有 bundle
  for (const b of bundles) {
    let code = await readFile(b, 'utf8');
    for (const [count, en, zh] of TABLE) {
      const needle = JSON.stringify(en);
      code = code.split(needle).join(JSON.stringify(zh));
    }
    await writeFile(b, code, 'utf8');
    // 语法校验（ES Module）
    const tmp = b + '.check.mjs';
    await cp(b, tmp);
    try {
      execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    } catch (err) {
      await writeFile(tmp + '.log', String(err.stderr || err));
      fail(`本地化后 bundle 语法校验失败：${b}（日志 ${tmp}.log）`);
    } finally {
      const { rmSync } = await import('node:fs');
      rmSync(tmp, { force: true });
    }
  }

  // index.html
  const htmlPath = join(dist, 'index.html');
  let html = await readFile(htmlPath, 'utf8');
  for (const [en, zh] of HTML) html = html.split(en).join(zh);
  await writeFile(htmlPath, html, 'utf8');

  // manifest
  const manifestPath = join(dist, 'manifest.webmanifest');
  if (existsSync(manifestPath)) {
    let mf = await readFile(manifestPath, 'utf8');
    for (const [en, zh] of MANIFEST) mf = mf.split(en).join(zh);
    await writeFile(manifestPath, mf, 'utf8');
  }

  await writeFile(marker, `localized ${new Date().toISOString()}\n`, 'utf8');
  console.log('[localize] ✓ webapp/dist 已本地化为中文（marker: .localized-zh）');
}

await main();
