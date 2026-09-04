'use strict';
/* ============================================================================
 * 外发工作台桥接（父页面控制器）
 * - 传输内核（/hub）以同源 iframe 原样嵌入，字节不做任何修改
 * - 本脚本只做三件事：读内核页面上用户选择的载荷元数据、创建外发记录、
 *   联动内核的「开始发送 / 停止」把记录状态机走完（sending → completed/failed/stopped）
 * - 未经登记直接在内核里点「开始发送」会收到未登记提醒（不阻断使用）
 * ========================================================================== */
(function () {
  const $ = (id) => document.getElementById(id);
  const frame = $('hub-frame');

  const state = {
    csrf: '',
    destinations: [],
    backup: { enabled: false, maxFileBytes: 0 },
    activeRecord: null,   // { id, filename, size, destination }
    payload: null,        // { kind: 'file'|'text', file?, text?, filename, size, mime, isText }
    watching: false,
    finalized: false,
  };

  /* ------------------------------ 基础工具 ------------------------------ */
  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.csrf) headers['X-CSRF-Token'] = state.csrf;
    if (opts.body !== undefined && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
    const res = await fetch(path, { ...opts, headers: { ...headers, ...(opts.headers || {}) }, credentials: 'same-origin' });
    if (res.status === 401) { location.href = '/login'; throw new Error('未登录'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
    return data;
  }

  function fmtSize(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1048576).toFixed(2)} MB`;
  }

  function chunkedB64(bytes) {
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(bin);
  }

  async function sha256Hex(buf) {
    try {
      const digest = await crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch (_) { return ''; }
  }

  /* ------------------------------ 内核 DOM 访问（同源） ------------------------------ */
  function hubReady() {
    try {
      const doc = frame.contentDocument;
      return doc && doc.getElementById('root') && doc.body && doc.body.children.length > 0;
    } catch (_) { return false; }
  }

  function hubButtons() {
    const doc = frame.contentDocument;
    return Array.from(doc.querySelectorAll('#root button'));
  }

  function findButton(texts) {
    return hubButtons().find((b) => {
      const t = (b.textContent || '').trim();
      return texts.some((x) => t.includes(x));
    });
  }

  function findFileInput() {
    const doc = frame.contentDocument;
    return doc.querySelector('#root input[type="file"]');
  }

  function findTextarea() {
    const doc = frame.contentDocument;
    return doc.querySelector('#root textarea');
  }

  function hubStatusText() {
    const doc = frame.contentDocument;
    const el = doc.querySelector('#root [role="status"]');
    return el ? el.textContent.trim() : '';
  }

  function hubErrorText() {
    const doc = frame.contentDocument;
    const el = doc.querySelector('#root [role="alert"]');
    return el ? el.textContent.trim() : '';
  }

  /* ------------------------------ 载荷识别 ------------------------------ */
  async function collectPayload() {
    const input = hubReady() ? findFileInput() : null;
    if (input && input.files && input.files.length > 0) {
      const file = input.files[0];
      return { kind: 'file', file, filename: file.name, size: file.size, mime: file.type || 'application/octet-stream', isText: false };
    }
    const ta = hubReady() ? findTextarea() : null;
    if (ta && ta.value.trim().length > 0) {
      const bytes = new TextEncoder().encode(ta.value);
      const name = `文本_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.txt`;
      return { kind: 'text', text: ta.value, filename: name, size: bytes.length, mime: 'text/plain', isText: true };
    }
    return null;
  }

  /* ------------------------------ 登记条 UI ------------------------------ */
  function setBar({ file, recState, recOk } = {}) {
    if (file !== undefined) $('reg-file').textContent = file;
    const st = $('reg-state');
    st.textContent = recState !== undefined ? recState : st.textContent;
    st.className = `recstate${recOk ? ' ok' : ''}`;
    const hasActive = Boolean(state.activeRecord);
    $('reg-start').disabled = hasActive || !state.payload;
    $('reg-start').textContent = state.activeRecord ? '记录进行中…' : '① 登记并开始外发';
    $('reg-done').disabled = !hasActive;
    $('reg-fail').disabled = !hasActive;
    $('reg-cancel').disabled = !hasActive;
  }

  function toast(msg, type = 'error') {
    if (window.App && window.App.showAlert) window.App.showAlert(msg, type);
    else alert(msg);
    if (window.App && window.App.hideAlert) setTimeout(() => window.App.hideAlert(), 5000);
  }

  /* ------------------------------ 记录状态机 ------------------------------ */
  async function finalizeRecord(status, note) {
    if (!state.activeRecord || state.finalized) return;
    state.finalized = true;
    try {
      await api(`/api/records/${state.activeRecord.id}/status`, { method: 'POST', body: { status, note } });
    } catch (err) {
      toast(`更新记录状态失败：${err.message}`);
    }
    state.activeRecord = null;
    setBar({ recState: '' });
  }

  function startWatching() {
    if (state.watching) return;
    state.watching = true;
    let seenRunning = false; // 只有确认内核进入过运行态，才允许自动判完成，避免启动瞬间的误判
    const timer = setInterval(async () => {
      if (!state.activeRecord) {
        clearInterval(timer);
        state.watching = false;
        return;
      }
      if (!hubReady()) return;
      const errText = hubErrorText();
      if (errText) {
        clearInterval(timer);
        state.watching = false;
        toast(`内核报告错误：${errText}`);
        await finalizeRecord('failed', errText.slice(0, 200));
        return;
      }
      const status = hubStatusText();
      if (/正在发送|发送中|正在编码|运行中|Live QR/.test(status)) seenRunning = true;
      if (findButton(['停止'])) { seenRunning = true; return; } // 运行中
      if (!seenRunning) return; // 尚未真正开始（等待编码/初始化失败提示等）
      clearInterval(timer);
      state.watching = false;
      await finalizeRecord('completed');
      setBar({ recState: '记录已完成 ✓', recOk: true });
    }, 600);
  }

  /* ------------------------------ 登记并开始 ------------------------------ */
  async function registerAndStart() {
    const payload = await collectPayload();
    if (!payload) { toast('请先在下方应用中选择文件或输入文本'); return; }
    state.payload = payload;
    setBar({ file: `${payload.filename} · ${fmtSize(payload.size)}`, recState: '正在登记…' });

    let content = '';
    if (state.backup.enabled && payload.size <= state.backup.maxFileBytes) {
      try {
        const bytes = payload.kind === 'file' ? new Uint8Array(await payload.file.arrayBuffer()) : new TextEncoder().encode(payload.text);
        content = chunkedB64(bytes);
      } catch (_) { content = ''; }
    }
    let sha256 = '';
    try {
      sha256 = payload.kind === 'file'
        ? await sha256Hex(await payload.file.arrayBuffer())
        : await sha256Hex(new TextEncoder().encode(payload.text).buffer);
    } catch (_) { sha256 = ''; }

    let record;
    try {
      const resp = await api('/api/records', {
        method: 'POST',
        body: {
          destination: $('reg-dest').value,
          filename: payload.filename,
          size: payload.size,
          mime: payload.mime,
          isText: payload.isText,
          sha256,
          note: $('reg-note').value.trim(),
          content,
        },
      });
      record = resp.record;
    } catch (err) {
      setBar({ recState: '登记失败' });
      toast(`创建外发记录失败：${err.message}`);
      return;
    }

    state.activeRecord = { id: record.id, filename: record.filename, size: record.size, destination: record.destination };
    state.finalized = false;
    setBar({ recState: `记录 #${record.id} 外发中…` });

    // 联动内核开始发送
    const startBtn = findButton(['开始发送']);
    if (startBtn) {
      startBtn.click();
      startWatching();
    } else {
      toast('未找到内核「开始发送」按钮，请手动点击开始；记录将继续保持外发中');
      startWatching();
    }
  }

  /* ------------------------------ 未登记提醒 ------------------------------ */
  function bindFrameGuard() {
    const doc = frame.contentDocument;
    if (!doc) return;
    doc.addEventListener('click', (event) => {
      const btn = event.target && event.target.closest ? event.target.closest('button') : null;
      if (!btn || state.activeRecord) return;
      const t = (btn.textContent || '').trim();
      if (t.includes('开始发送') || t.includes('开始接收')) {
        toast('提示：本次操作未经「登记并开始外发」，不会产生外发记录', 'warn');
      }
    }, true);
  }

  /* ------------------------------ 初始化 ------------------------------ */
  async function init() {
    if (!window.App || !(await window.App.init('/app'))) return;
    const session = window.App.getSession();
    state.csrf = session.csrfToken || '';

    try {
      const cfg = await api('/api/bridge/config');
      state.destinations = cfg.destinations || [];
      state.backup = cfg.backup || state.backup;
    } catch (err) {
      toast(`加载工作台配置失败：${err.message}`);
    }
    const dest = $('reg-dest');
    dest.innerHTML = state.destinations.map((d) => `<option value="${d}">${d}</option>`).join('');

    $('reg-start').addEventListener('click', () => registerAndStart().catch((e) => toast(e.message)));
    $('reg-done').addEventListener('click', async () => {
      await finalizeRecord('completed');
      setBar({ recState: '记录已完成 ✓', recOk: true });
    });
    $('reg-fail').addEventListener('click', async () => {
      await finalizeRecord('failed');
      setBar({ recState: '记录已标记失败' });
    });
    $('reg-cancel').addEventListener('click', async () => {
      await finalizeRecord('stopped');
      setBar({ recState: '记录已取消' });
    });

    // 载荷变化：文件选择 / 文本输入（捕获阶段委托，兼容内核重渲染）
    const pollPayload = async () => {
      if (state.activeRecord) return;
      const payload = await collectPayload();
      state.payload = payload;
      setBar({
        file: payload ? `${payload.filename} · ${fmtSize(payload.size)}` : '在下方应用中选择文件或输入文本',
      });
    };
    frame.addEventListener('load', () => {
      setTimeout(() => { bindFrameGuard(); pollPayload(); }, 400);
      const doc = frame.contentDocument;
      if (doc) doc.addEventListener('change', (e) => {
        if (e.target && e.target.type === 'file') setTimeout(pollPayload, 100);
      }, true);
    });
    setInterval(pollPayload, 1200);
  }

  init().catch((err) => toast(err.message));
})();
