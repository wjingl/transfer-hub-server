/* ============================================================================
 * 统计页（总管理）：全局 + 每人 + 目的地 + 每日趋势（图形化）
 * - 每日趋势：范围 7/14/30/90 天 × 指标 次数/大小，柱状图，明细表可选展开
 * - 按目的地：环形图 + 表格
 * - 每人统计：横向条形图 + 表格
 * ========================================================================== */
'use strict';

(async () => {
  if (!(await App.init('/stats', { requireAdmin: true }))) return;

  const state = { days: 30, metric: 'n', daily: [] };

  function rowHtml(cells) {
    const tr = document.createElement('tr');
    tr.innerHTML = cells.map((c) => `<td>${c}</td>`).join('');
    return tr;
  }

  const BYTE_FMT = (v) => App.fmtSize(v);

  async function loadOverview() {
    const o = await App.api('/api/stats/overview');
    document.getElementById('sTotal').textContent = o.total;
    document.getElementById('sBytes').textContent = App.fmtSize(o.total_bytes);
    document.getElementById('sDone').textContent = o.completed;
    document.getElementById('sSending').textContent = o.sending;
  }

  async function loadDestinations() {
    const dest = await App.api('/api/stats/destinations');
    const db = document.getElementById('destBody');
    db.innerHTML = '';
    const rows = dest.rows.map((r) => ({ destination: r.destination, n: r.n, bytes: r.bytes, completed: r.completed }));
    if (!rows.length) db.appendChild(rowHtml(['暂无数据', '-', '-', '-']));
    for (const r of rows) db.appendChild(rowHtml([`<span class="badge blue">${App.escapeHtml(r.destination)}</span>`, r.n, App.fmtSize(r.bytes), r.completed]));
    // 环形图（次数分布）
    const chartEl = document.getElementById('destChart');
    if (rows.length) {
      RqrCharts.donut(chartEl, rows.map((r, i) => ({
        label: r.destination, value: r.n, color: RqrCharts.PALETTE[i % RqrCharts.PALETTE.length], tip: App.fmtSize(r.bytes),
      })), { centerLabel: '传出次数' });
    } else {
      chartEl.innerHTML = '<p style="color:#6e7681;font-size:13px;padding:8px 0;">暂无数据</p>';
    }
  }

  async function loadUsers() {
    const users = await App.api('/api/stats/users');
    const ub = document.getElementById('userBody');
    ub.innerHTML = '';
    const rows = users.rows.map((r) => ({ username: r.username, n: r.n, bytes: r.bytes, completed: r.completed }));
    if (!rows.length) ub.appendChild(rowHtml(['暂无数据', '-', '-', '-']));
    for (const r of rows) ub.appendChild(rowHtml([App.escapeHtml(r.username), r.n, App.fmtSize(r.bytes), r.completed]));
    const chartEl = document.getElementById('userChart');
    if (rows.length) {
      const sorted = rows.slice().sort((a, b) => b.n - a.n);
      RqrCharts.hbar(chartEl, sorted.map((r) => ({ label: r.username, value: r.n, tip: `${r.username} · ${App.fmtSize(r.bytes)}` })), { valueFormat: (v) => `${v} 次` });
    } else {
      chartEl.innerHTML = '<p style="color:#6e7681;font-size:13px;padding:8px 0;">暂无数据</p>';
    }
  }

  async function loadDaily() {
    const daily = await App.api(`/api/stats/daily?days=${state.days}`);
    state.daily = daily.rows;
    renderDailyChart();
    renderDailyTable();
  }

  function renderDailyChart() {
    const rows = state.daily;
    const chartEl = document.getElementById('dailyChart');
    if (!rows.length) { chartEl.innerHTML = '<p style="color:#6e7681;font-size:13px;padding:8px 0;">暂无数据</p>'; return; }
    RqrCharts.bars(chartEl, rows.map((r) => ({
      label: r.day,
      value: state.metric === 'bytes' ? r.bytes : r.n,
      tip: `${r.day} · 次数 ${r.n} · ${App.fmtSize(r.bytes)}`,
    })), {
      valueFormat: state.metric === 'bytes' ? BYTE_FMT : (v) => String(v),
      color: state.metric === 'bytes' ? '#3fb950' : '#58a6ff',
      height: 240,
    });
  }

  function renderDailyTable() {
    const dlb = document.getElementById('dailyBody');
    dlb.innerHTML = '';
    if (!state.daily.length) dlb.appendChild(rowHtml(['暂无数据', '-', '-']));
    for (const r of state.daily) dlb.appendChild(rowHtml([r.day, r.n, App.fmtSize(r.bytes)]));
  }

  // 工具栏
  document.querySelectorAll('#segDays button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#segDays button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.days = Number(btn.dataset.days);
      loadDaily().catch((e) => App.showAlert(e.message));
    });
  });
  document.querySelectorAll('#segMetric button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#segMetric button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.metric = btn.dataset.metric;
      renderDailyChart();
    });
  });
  document.getElementById('btnDailyDetail').addEventListener('click', () => {
    const box = document.getElementById('dailyDetail');
    const show = box.style.display === 'none';
    box.style.display = show ? '' : 'none';
    document.getElementById('btnDailyDetail').textContent = show ? '收起明细表' : '展开明细表';
  });

  try {
    await Promise.all([loadOverview(), loadDestinations(), loadUsers(), loadDaily()]);
  } catch (err) {
    App.showAlert(err.message);
  }
})();
