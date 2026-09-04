/* ============================================================================
 * 零依赖 SVG/HTML 图表（暗色主题，与 app.css 配色一致）
 * 提供：竖向柱状图 bars / 横向条形图 hbar / 环形图 donut
 * 全部本地实现，无 CDN、无外部请求；悬浮提示用 SVG <title>（原生）。
 * 用法：RqrCharts.bars(el, rows, {valueFormat, height, color})
 * ========================================================================== */
'use strict';

const RqrCharts = (() => {
  const PALETTE = ['#58a6ff', '#3fb950', '#d29922', '#f85149', '#bc8cff', '#39c5cf', '#e3b341', '#8b949e', '#f0883e', '#56d4dd'];
  const NS = 'http://www.w3.org/2000/svg';
  const registry = [];

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function el(tag, attrs, children) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    for (const c of children || []) e.appendChild(c);
    return e;
  }

  function textNode(s, x, y, cls) {
    const t = el('text', { x, y, 'class': cls || 'rqr-chart-text' });
    t.textContent = s;
    return t;
  }

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
      if (v <= m * p) return m * p;
    }
    return 10 * p;
  }

  function shortDay(label) {
    const m = String(label).match(/^\d{4}-(\d{2})-(\d{2})$/);
    return m ? `${Number(m[2])}/${Number(m[1])}` : label;
  }

  function mkSvg(container, w, h) {
    container.innerHTML = '';
    const s = el('svg', { width: '100%', height: String(h), viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': '图表' });
    container.appendChild(s);
    return s;
  }

  function register(container, render) {
    container.__rqrChartRender = render;
    if (registry.indexOf(container) === -1) registry.push(container);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', () => {
      for (const c of registry) if (c.isConnected && c.__rqrChartRender) c.__rqrChartRender();
    });
  }

  /* ------------------------------ 竖向柱状图 ------------------------------ */
  function bars(container, rows, opts = {}) {
    const height = opts.height || 220;
    const pad = { top: 16, right: 10, bottom: 26, left: 46 };
    const w = Math.max(container.clientWidth || 600, 240);
    const svg = mkSvg(container, w, height);

    const vals = rows.map((r) => Number(r.value) || 0);
    const max = niceMax(Math.max.apply(null, vals.concat([1])));
    const fmt = opts.valueFormat || ((v) => String(v));
    const color = opts.color || PALETTE[0];
    const innerW = w - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const n = Math.max(rows.length, 1);
    const slot = innerW / n;
    const barW = Math.max(Math.min(slot * 0.62, 34), 2);

    // 网格 + Y 轴刻度
    const TICKS = 4;
    for (let i = 0; i <= TICKS; i++) {
      const v = (max / TICKS) * i;
      const y = pad.top + innerH - (innerH * i) / TICKS;
      svg.appendChild(el('line', { x1: pad.left, y1: y, x2: w - pad.right, y2: y, stroke: '#21262d', 'stroke-width': 1 }));
      svg.appendChild(textNode(fmt(v), pad.left - 8, y + 4, 'rqr-chart-axis'));
    }

    rows.forEach((r, i) => {
      const v = Number(r.value) || 0;
      const h = (v / max) * innerH;
      const x = pad.left + slot * i + (slot - barW) / 2;
      const y = pad.top + innerH - h;
      const g = el('g');
      g.appendChild(el('rect', { x, y, width: barW, height: Math.max(h, 1), rx: 2, fill: color, opacity: v > 0 ? 0.92 : 0.25 }));
      // 悬浮提示
      const tip = el('title');
      tip.textContent = `${r.label}\n${fmt(v)}${r.tip ? ' · ' + r.tip : ''}`;
      g.appendChild(el('rect', { x: x - 2, y: pad.top, width: slot, height: innerH, fill: 'transparent' }));
      g.appendChild(tip);
      svg.appendChild(g);
      // X 轴标签（稀疏显示）
      const every = Math.max(1, Math.ceil(n / 12));
      if (i % every === 0 || i === n - 1) {
        svg.appendChild(textNode(shortDay(r.label), x + barW / 2, height - 8, 'rqr-chart-axis'));
      }
    });

    svg.appendChild(el('line', { x1: pad.left, y1: pad.top + innerH, x2: w - pad.right, y2: pad.top + innerH, stroke: '#30363d', 'stroke-width': 1 }));
    register(container, () => bars(container, rows, opts));
    return svg;
  }

  /* ------------------------------ 横向条形图 ------------------------------ */
  function hbar(container, rows, opts = {}) {
    const fmt = opts.valueFormat || ((v) => String(v));
    const max = niceMax(Math.max.apply(null, rows.map((r) => Number(r.value) || 0).concat([1])));
    const color = opts.color || PALETTE[0];

    container.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'rqr-hbars';
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'rqr-hbar';
      const lab = document.createElement('span');
      lab.className = 'rqr-hbar-label';
      lab.textContent = r.label;
      lab.title = r.tip || r.label;
      const track = document.createElement('span');
      track.className = 'rqr-hbar-track';
      const fill = document.createElement('span');
      fill.className = 'rqr-hbar-fill';
      fill.style.width = `${Math.max((Number(r.value) / max) * 100, r.value > 0 ? 2 : 0.5)}%`;
      fill.style.background = r.color || color;
      const tip = document.createElement('span');
      tip.className = 'rqr-hbar-val';
      tip.textContent = fmt(Number(r.value));
      track.appendChild(fill);
      row.appendChild(lab);
      row.appendChild(track);
      row.appendChild(tip);
      box.appendChild(row);
    }
    container.appendChild(box);
    return box;
  }

  /* ------------------------------ 环形图 ------------------------------ */
  function donut(container, rows, opts = {}) {
    const height = opts.height || 200;
    const w = Math.max(container.clientWidth || 600, 260);
    const svg = mkSvg(container, w, height);
    const total = rows.reduce((a, r) => a + (Number(r.value) || 0), 0) || 1;
    const cx = Math.min(w / 2 - 60, 90);
    const cy = height / 2;
    const R = Math.min(cx - 12, cy - 12);
    const sw = opts.strokeWidth || 20;
    const circ = 2 * Math.PI * R;

    let acc = 0;
    rows.forEach((r, i) => {
      const frac = (Number(r.value) || 0) / total;
      if (frac <= 0) return;
      const c = el('circle', {
        cx, cy, r: R, fill: 'none',
        stroke: r.color || PALETTE[i % PALETTE.length],
        'stroke-width': sw,
        'stroke-dasharray': `${(frac * circ).toFixed(2)} ${(circ).toFixed(2)}`,
        'stroke-dashoffset': `${(-acc * circ).toFixed(2)}`,
        transform: `rotate(-90 ${cx} ${cy})`,
      });
      const tip = el('title');
      tip.textContent = `${r.label}\n${Number(r.value)} 次`;
      c.appendChild(tip);
      svg.appendChild(c);
      acc += frac;
    });
    // 中心总计
    const g = el('g');
    g.appendChild(textNode(String(total), cx, cy - 2, 'rqr-chart-total'));
    g.appendChild(textNode(opts.centerLabel || '总计', cx, cy + 16, 'rqr-chart-axis'));
    svg.appendChild(g);
    // 图例
    const lx = cx + R + sw / 2 + 18;
    let ly = cy - (rows.length * 18) / 2 + 8;
    const legend = el('g');
    for (const r of rows) {
      const c = el('circle', { cx: lx, cy: ly, r: 5, fill: r.color || PALETTE[0] });
      const t = textNode(`${r.label} ${Number(r.value)}`, lx + 12, ly + 4, 'rqr-chart-axis');
      legend.appendChild(c);
      legend.appendChild(t);
      ly += 18;
    }
    svg.appendChild(legend);
    register(container, () => donut(container, rows, opts));
    return svg;
  }

  return { bars, hbar, donut, PALETTE };
})();

if (typeof window !== 'undefined') window.RqrCharts = RqrCharts;
