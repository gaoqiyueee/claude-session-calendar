// 会话日历插件前端：月历热力图 + 当天按项目分组的会话 + 当前会话/项目的目标、状态、完成度编辑。
const STATUS = {
  doing: { label: '进行中', color: '#3b82f6' },
  waiting: { label: '等待', color: '#f59e0b' },
  paused: { label: '挂起', color: '#8b5cf6' },
  done: { label: '已完成', color: '#10b981' },
  dropped: { label: '已放弃', color: '#9ca3af' },
};
const WEEK = ['一', '二', '三', '四', '五', '六', '日'];
const MODE_KEY = 'session-calendar:mode';
const CELL_ITEMS = 5; // 纯日历视图每格最多显示几个会话

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function css(dark) {
  const c = dark
    ? { bg: '#0f1115', card: '#171a21', line: '#262b36', text: '#e5e7eb', muted: '#8b93a3', heat: '59,130,246' }
    : { bg: '#ffffff', card: '#f7f8fa', line: '#e5e7eb', text: '#111827', muted: '#6b7280', heat: '37,99,235' };
  return `
  .sc{--bg:${c.bg};--card:${c.card};--line:${c.line};--text:${c.text};--muted:${c.muted};--heat:${c.heat};
    background:var(--bg);color:var(--text);font:13px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;
    height:100%;overflow:auto;padding:16px;box-sizing:border-box}
  .sc *{box-sizing:border-box}
  .sc .top{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr));gap:12px;margin-bottom:16px}
  .sc .card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}
  .sc .card h3{margin:0 0 8px;font-size:12px;color:var(--muted);font-weight:500}
  .sc .main{display:grid;grid-template-columns:minmax(300px,380px) minmax(0,1fr);gap:16px;align-items:start}
  @media (max-width:820px){.sc .main{grid-template-columns:1fr}}
  .sc .nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
  .sc .nav b{font-size:15px}
  .sc button{background:transparent;border:1px solid var(--line);color:var(--text);border-radius:6px;padding:3px 9px;cursor:pointer;font:inherit}
  .sc button:hover{border-color:var(--muted)}
  .sc .grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
  .sc .wk{text-align:center;color:var(--muted);font-size:11px;padding:2px 0}
  .sc .day{min-width:0;height:46px;border-radius:6px;border:1px solid var(--line);padding:3px 4px;cursor:pointer;position:relative;display:flex;flex-direction:column;justify-content:space-between}
  .sc .day.out{visibility:hidden}
  .sc .day.today{outline:2px solid rgba(var(--heat),.9);outline-offset:-2px}
  .sc .day.sel{border-color:var(--text)}
  .sc .day .n{font-size:11px}
  .sc .day .c{font-size:10px;color:var(--muted);text-align:right}
  .sc .dots{display:flex;gap:2px;flex-wrap:wrap}
  .sc .dot{width:6px;height:6px;border-radius:50%}
  .sc .legend{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;color:var(--muted);font-size:11px}
  .sc .legend span{display:inline-flex;align-items:center;gap:4px}
  .sc .proj{margin-bottom:14px}
  .sc .proj-h{display:flex;align-items:baseline;gap:8px;margin-bottom:6px}
  .sc .proj-h b{font-size:14px}
  .sc .proj-h .goal{color:var(--muted);font-size:12px}
  .sc .sess{border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin-bottom:6px;background:var(--card)}
  .sc .sess .row{display:flex;gap:8px;align-items:center}
  .sc .sess .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .sc .sess .meta{color:var(--muted);font-size:11px;white-space:nowrap}
  .sc .sess .sub{color:var(--muted);font-size:12px;margin-top:4px}
  .sc .badge{font-size:11px;border-radius:10px;padding:0 7px;color:#fff;white-space:nowrap}
  .sc .bar{height:4px;background:var(--line);border-radius:2px;margin-top:6px;overflow:hidden}
  .sc .bar i{display:block;height:100%;background:rgb(var(--heat))}
  .sc a{color:inherit}
  .sc .edit{display:grid;gap:6px;margin-top:6px}
  .sc .edit input[type=text],.sc .edit textarea,.sc .edit select{width:100%;background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:5px 7px;font:inherit}
  .sc .edit textarea{resize:vertical;min-height:40px}
  .sc .edit .line{display:flex;gap:8px;align-items:center}
  .sc .edit .line input[type=range]{flex:1}
  .sc .muted{color:var(--muted)}
  .sc .err{color:#ef4444}
  .sc .empty{color:var(--muted);padding:24px 0;text-align:center}
  .sc .modes{display:flex;gap:6px;align-items:center;margin-bottom:12px}
  .sc .modes .sp{flex:1}
  .sc button.on{background:rgb(var(--heat));color:#fff;border-color:transparent}
  .sc .cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}
  .sc .cell{min-width:0;min-height:118px;border:1px solid var(--line);border-radius:8px;padding:5px 6px;background:var(--card);display:flex;flex-direction:column;gap:3px}
  .sc .cell.out{visibility:hidden}
  .sc .cell.today{border-color:rgb(var(--heat))}
  .sc .cell .h{display:flex;justify-content:space-between;align-items:baseline;font-size:12px;cursor:pointer;margin-bottom:1px}
  .sc .cell .h:hover b{text-decoration:underline}
  .sc .cell .h span{font-size:10px;color:var(--muted)}
  .sc .it{display:block;font-size:11px;line-height:1.4;padding:1px 5px;border-left:3px solid var(--line);border-radius:3px;background:var(--bg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-decoration:none}
  .sc .it:hover{background:rgba(var(--heat),.15)}
  .sc .more{font-size:11px;color:var(--muted);border:none;padding:0 5px;text-align:left}`;
}
function badge(status) {
  const s = STATUS[status];
  return s ? `<span class="badge" style="background:${s.color}">${s.label}</span>` : '';
}

function bar(progress) {
  return progress == null ? '' : `<div class="bar" title="完成度 ${progress}%"><i style="width:${progress}%"></i></div>`;
}

function editor(rec, kind, key) {
  const r = rec ?? {};
  const opts = ['<option value="">（未设）</option>']
    .concat(Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${r.status === k ? 'selected' : ''}>${v.label}</option>`))
    .join('');
  const prog = r.progress ?? 0;
  return `<form class="edit" data-kind="${kind}" data-key="${esc(key)}">
    <input type="text" name="goal" placeholder="目标：做完之后，什么会变得不一样？" value="${esc(r.goal)}">
    <div class="line">
      <select name="status" style="width:auto">${opts}</select>
      <input type="range" name="progress" min="0" max="100" step="5" value="${prog}">
      <output>${r.progress == null ? '未评' : prog + '%'}</output>
    </div>
    <textarea name="note" placeholder="备注 / 自评（AI 用 session-goal skill 自评时会写在这里）">${esc(r.note)}</textarea>
    <div class="line"><button type="submit">保存</button><span class="muted msg">${r.updated_at ? '更新于 ' + esc(new Date(r.updated_at).toLocaleString()) : ''}</span></div>
  </form>`;
}

function sessionRow(s, opts = {}) {
  const r = s.record ?? {};
  const time = opts.dayView && s.day ? `${hm(s.day.first)}–${hm(s.day.last)} · ${s.day.prompts} 条` : `${s.prompts ?? 0} 条 · ${hm(s.end)}`;
  const sub = [r.goal ? `🎯 ${esc(r.goal)}` : '', r.note ? `📝 ${esc(r.note)}` : ''].filter(Boolean).join('<br>');
  return `<div class="sess" data-sid="${esc(s.id)}">
    <div class="row">
      ${badge(r.status)}
      <a class="t" href="/session/${encodeURIComponent(s.id)}" title="${esc(s.title)}">${esc(s.title || s.id)}</a>
      ${r.progress != null ? `<span class="meta">${r.progress}%</span>` : ''}
      <span class="meta">${time}</span>
      <button data-act="toggle">编辑</button>
    </div>
    ${opts.showProject && s.project ? `<div class="sub">📁 ${esc(s.project)}</div>` : ''}
    ${sub ? `<div class="sub">${sub}</div>` : ''}
    ${bar(r.progress)}
    <div class="slot" hidden>${editor(r, 'session', s.id)}</div>
  </div>`;
}

export function mount(container, api) {
  const today = new Date();
  const state = {
    month: `${today.getFullYear()}-${pad(today.getMonth() + 1)}`, date: ymd(today), monthData: null, dayData: null, view: 'day',
    mode: localStorage.getItem(MODE_KEY) === 'detail' ? 'detail' : 'calendar',
  };
  const root = document.createElement('div');
  root.className = 'sc';
  const style = document.createElement('style');
  container.append(style, root);

  const get = (p) => api.rpc('GET', p);
  const post = (p, body) => api.rpc('POST', p, body);
  const monthUrl = () => `/month?month=${state.month}&detail=1`;

  async function load() {
    root.innerHTML = '<div class="empty">加载中…</div>';
    try {
      const ctx = api.context;
      const q = new URLSearchParams({ session: ctx.session?.id ?? '', project: ctx.project?.path ?? '' });
      const [cur, m, d, open] = await Promise.all([
        get(`/current?${q}`), get(monthUrl()),
        get(`/day?date=${state.date}`), get('/open'),
      ]);
      Object.assign(state, { cur, monthData: m, dayData: d, open: open.sessions });
      render();
    } catch (err) {
      root.innerHTML = `<div class="empty err">加载失败：${esc(err?.message ?? err)}</div>`;
    }
  }

  function renderTop() {
    const { session, project } = state.cur ?? {};
    const sessCard = session
      ? `<div class="card"><h3>当前会话 · ${esc(session.title || session.id.slice(0, 8))}</h3>${editor(session.record, 'session', session.id)}</div>`
      : '<div class="card"><h3>当前会话</h3><div class="muted">在左侧选中一个会话后，这里可以设目标和状态。</div></div>';
    const projCard = project
      ? `<div class="card"><h3>当前项目 · ${esc(project.name)}</h3>${editor(project.record, 'project', project.path)}</div>`
      : '';
    return `<div class="top">${sessCard}${projCard}</div>`;
  }
  function renderCalendar() {
    const [y, m] = state.month.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const daysIn = new Date(y, m, 0).getDate();
    const lead = (first.getDay() + 6) % 7; // 周一为第一列
    const days = state.monthData?.days ?? {};
    const max = Math.max(1, ...Object.values(days).map((d) => d.prompts));
    const cells = WEEK.map((w) => `<div class="wk">${w}</div>`);
    for (let i = 0; i < lead; i++) cells.push('<div class="day out"></div>');
    for (let n = 1; n <= daysIn; n++) {
      const key = `${state.month}-${pad(n)}`;
      const d = days[key];
      const alpha = d ? 0.12 + 0.6 * Math.sqrt(d.prompts / max) : 0;
      const dots = d ? Object.entries(d.statuses).map(([s, c]) =>
        Array.from({ length: Math.min(c, 6) }, () => `<i class="dot" style="background:${STATUS[s]?.color}"></i>`).join('')).join('') : '';
      cells.push(`<div class="day ${key === ymd(today) ? 'today' : ''} ${key === state.date ? 'sel' : ''}" data-date="${key}"
        style="background:rgba(var(--heat),${alpha.toFixed(2)})" title="${d ? `${d.sessions} 个会话 · ${d.prompts} 条提问` : '无记录'}">
        <span class="n">${n}</span><div class="dots">${dots}</div><span class="c">${d ? d.sessions : ''}</span></div>`);
    }
    const legend = Object.values(STATUS).map((s) => `<span><i class="dot" style="background:${s.color}"></i>${s.label}</span>`).join('');
    return `<div class="card">
      <div class="nav"><button data-act="prev">‹</button><b>${y} 年 ${m} 月</b><button data-act="next">›</button></div>
      <div class="grid">${cells.join('')}</div>
      <div class="legend">${legend}<span>颜色深浅 = 提问数，右下角 = 会话数</span></div>
    </div>`;
  }

  function renderDay() {
    const projects = state.dayData?.projects ?? [];
    const total = projects.reduce((s, p) => s + p.sessions.length, 0);
    const head = `<div class="nav"><b>${esc(state.date)} · ${total} 个会话</b>
      <span><button data-act="view-day" ${state.view === 'day' ? 'disabled' : ''}>当天</button>
      <button data-act="view-open" ${state.view === 'open' ? 'disabled' : ''}>未完结 (${state.open?.length ?? 0})</button></span></div>`;
    if (state.view === 'open') {
      const list = state.open ?? [];
      return head + (list.length ? list.map((s) => sessionRow(s, { showProject: true })).join('')
        : '<div class="empty">没有标记为进行中 / 等待 / 挂起的会话</div>');
    }
    if (!projects.length) return head + '<div class="empty">这一天没有会话记录</div>';
    return head + projects.map((p) => `<div class="proj">
      <div class="proj-h"><b title="${esc(p.path)}">📁 ${esc(p.name)}</b>
        ${p.record?.goal ? `<span class="goal">🎯 ${esc(p.record.goal)}</span>` : ''}
        ${p.record?.progress != null ? `<span class="goal">${p.record.progress}%</span>` : ''}
        ${badge(p.record?.status)}</div>
      ${p.sessions.map((s) => sessionRow(s, { dayView: true })).join('')}
    </div>`).join('');
  }

  function renderModes() {
    const [y, m] = state.month.split('-').map(Number);
    const nav = state.mode === 'calendar'
      ? `<button data-act="prev">‹</button><b>${y} 年 ${m} 月</b><button data-act="next">›</button><button data-act="this-month">本月</button>`
      : '';
    return `<div class="modes">${nav}<span class="sp"></span>
      <button data-act="mode-calendar" class="${state.mode === 'calendar' ? 'on' : ''}">日历</button>
      <button data-act="mode-detail" class="${state.mode === 'detail' ? 'on' : ''}">热力图 + 详情</button></div>`;
  }

  function renderFullCalendar() {
    const [y, m] = state.month.split('-').map(Number);
    const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;
    const daysIn = new Date(y, m, 0).getDate();
    const days = state.monthData?.days ?? {};
    const cells = WEEK.map((w) => `<div class="wk">${w}</div>`);
    for (let i = 0; i < lead; i++) cells.push('<div class="cell out"></div>');
    for (let n = 1; n <= daysIn; n++) {
      const key = `${state.month}-${pad(n)}`;
      const d = days[key];
      const list = d?.list ?? [];
      const items = list.slice(0, CELL_ITEMS).map((s) => {
        const st = STATUS[s.status];
        const tip = [s.title, s.project, `${s.prompts} 条`, st?.label, s.progress != null ? `${s.progress}%` : ''].filter(Boolean).join(' · ');
        return `<a class="it" href="/session/${encodeURIComponent(s.id)}" title="${esc(tip)}"
          style="border-left-color:${st?.color ?? 'var(--line)'}">${esc(s.title)}</a>`;
      }).join('');
      const more = list.length > CELL_ITEMS ? `<button class="more" data-detail="${key}">+${list.length - CELL_ITEMS} 个</button>` : '';
      cells.push(`<div class="cell ${key === ymd(today) ? 'today' : ''}">
        <div class="h" data-detail="${key}" title="查看这一天的详情"><b>${n}</b><span>${d ? `${d.sessions} 会话 · ${d.prompts} 条` : ''}</span></div>
        ${items}${more}</div>`);
    }
    const legend = Object.values(STATUS).map((s) => `<span><i class="dot" style="background:${s.color}"></i>${s.label}</span>`).join('');
    return `<div class="cal">${cells.join('')}</div>
      <div class="legend">${legend}<span>左边色条 = 会话状态；点日期看当天详情</span></div>`;
  }

  function render() {
    style.textContent = css(api.context.theme === 'dark');
    root.innerHTML = state.mode === 'calendar'
      ? renderModes() + renderFullCalendar()
      : `${renderModes()}${renderTop()}<div class="main">${renderCalendar()}<div>${renderDay()}</div></div>`;
  }

  async function refreshMonthDay() {
    const [m, d] = await Promise.all([get(monthUrl()), get(`/day?date=${state.date}`)]);
    state.monthData = m;
    state.dayData = d;
    render();
  }

  function shiftMonth(delta) {
    const [y, m] = state.month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    state.month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    get(monthUrl()).then((md) => { state.monthData = md; render(); });
  }

  function setMode(mode) {
    state.mode = mode;
    localStorage.setItem(MODE_KEY, mode);
    render();
  }

  root.addEventListener('click', (e) => {
    // 会话链接走宿主的前端路由，不整页刷新；带修饰键时保留浏览器默认行为（新标签打开）
    const link = e.target.closest('a[href^="/session/"]');
    if (link && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) {
      e.preventDefault();
      history.pushState({}, '', link.getAttribute('href'));
      window.dispatchEvent(new PopStateEvent('popstate'));
      return;
    }
    const t = e.target.closest('[data-act],[data-date],[data-detail]');
    if (!t) return;
    if (t.dataset.detail) { state.date = t.dataset.detail; state.view = 'day'; state.mode = 'detail'; localStorage.setItem(MODE_KEY, 'detail'); refreshMonthDay(); return; }
    if (t.dataset.date) { state.date = t.dataset.date; state.view = 'day'; refreshMonthDay(); return; }
    const act = t.dataset.act;
    if (act === 'prev') shiftMonth(-1);
    else if (act === 'next') shiftMonth(1);
    else if (act === 'this-month') { state.month = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`; shiftMonth(0); }
    else if (act === 'mode-calendar' || act === 'mode-detail') setMode(act.slice(5));
    else if (act === 'view-day' || act === 'view-open') { state.view = act.slice(5); render(); }
    else if (act === 'toggle') {
      const slot = t.closest('.sess').querySelector('.slot');
      slot.hidden = !slot.hidden;
    }
  });

  root.addEventListener('input', (e) => {
    if (e.target.name === 'progress') e.target.nextElementSibling.textContent = `${e.target.value}%`;
  });

  root.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const msg = f.querySelector('.msg');
    const body = { goal: f.goal.value, status: f.status.value, note: f.note.value };
    // 滑块没动过（仍显示「未评」）就不写完成度，避免存成 0%
    if (f.querySelector('output').textContent !== '未评') body.progress = Number(f.progress.value);
    const kind = f.dataset.kind;
    if (kind === 'session') body.id = f.dataset.key; else body.path = f.dataset.key;
    msg.textContent = '保存中…';
    try {
      await post(kind === 'session' ? '/session' : '/project', body);
      const q = new URLSearchParams({ session: api.context.session?.id ?? '', project: api.context.project?.path ?? '' });
      const [cur, open] = await Promise.all([get(`/current?${q}`), get('/open')]);
      state.cur = cur;
      state.open = open.sessions;
      await refreshMonthDay();
    } catch (err) {
      msg.textContent = `保存失败：${err?.message ?? err}`;
      msg.classList.add('err');
    }
  });

  const unsub = api.onContextChange(() => load());
  const timer = setInterval(() => { if (!root.querySelector('.slot:not([hidden]), .edit :focus')) refreshMonthDay().catch(() => {}); }, 60000);
  container._scCleanup = () => { unsub(); clearInterval(timer); };
  load();
}

export function unmount(container) {
  container._scCleanup?.();
  container.innerHTML = '';
}