// 会话日历插件后端：扫描 ~/.claude/projects 的会话日志按天汇总，读写 ~/.claude/session-goals 里的目标/状态/完成度。
// 只用 Node 内置模块；会话标题和项目名优先取 CloudCLI 数据库（只读）。
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const HOME = os.homedir();
const LOG_ROOT = path.join(HOME, '.claude', 'projects');
const GOAL_ROOT = path.join(HOME, '.claude', 'session-goals');
const SCAN_CACHE = path.join(GOAL_ROOT, '.scan-cache.json');
const CLOUDCLI_DB = path.join(HOME, '.cloudcli', 'auth.db');
const SCAN_VERSION = 2;
const HISTORY_LIMIT = 50;
const STATUSES = ['doing', 'waiting', 'paused', 'done', 'dropped'];
const NOISE = ['<task-notification>', '[Request interrupted', 'This session is being continued',
  '<command-', '<local-command', 'Caveat:', '<system-reminder>'];

// ── 日期 ──────────────────────────────────────────────────────────────

function localDay(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ── 会话日志扫描（按文件大小增量解析，日志是只追加的）──────────────────

let scan = loadScanCache();

function loadScanCache() {
  try {
    const data = JSON.parse(fs.readFileSync(SCAN_CACHE, 'utf-8'));
    if (data.version === SCAN_VERSION) return data;
  } catch { /* 首次运行或损坏，重扫 */ }
  return { version: SCAN_VERSION, files: {} };
}

function saveScanCache() {
  fs.mkdirSync(GOAL_ROOT, { recursive: true });
  const tmp = `${SCAN_CACHE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(scan));
  fs.renameSync(tmp, SCAN_CACHE);
}

function promptText(rec) {
  if (rec.type !== 'user' || rec.isMeta || rec.isSidechain) return null;
  if (rec.origin && typeof rec.origin === 'object' && rec.origin.kind !== 'human') return null;
  const content = rec.message?.content;
  let text = null;
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    if (content.some((c) => c?.type === 'tool_result')) return null;
    text = content.find((c) => c?.type === 'text')?.text ?? null;
  }
  if (!text) return null;
  text = text.trim();
  if (!text || NOISE.some((n) => text.startsWith(n))) return null;
  return text;
}

function parseChunk(entry, chunk) {
  for (const line of chunk.split('\n')) {
    if (!line) continue;
    const ts = /"timestamp":"([^"]+)"/.exec(line)?.[1];
    const day = ts && localDay(ts);
    if (!entry.cwd && line.includes('"cwd"')) {
      try { entry.cwd = JSON.parse(line).cwd || ''; } catch { /* 半行，忽略 */ }
    }
    if (!day) continue;
    const d = (entry.days[day] ??= { prompts: 0, first: ts, last: ts, firstPrompt: '' });
    if (ts < d.first) d.first = ts;
    if (ts > d.last) d.last = ts;
    if (!entry.start || ts < entry.start) entry.start = ts;
    if (!entry.end || ts > entry.end) entry.end = ts;
    if (!line.includes('"type":"user"')) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    const text = promptText(rec);
    if (!text) continue;
    d.prompts += 1;
    if (!d.firstPrompt) d.firstPrompt = text.slice(0, 200);
    if (!entry.firstPrompt) entry.firstPrompt = text.slice(0, 200);
  }
}

function scanFile(file, stat) {
  const sid = path.basename(file, '.jsonl');
  let entry = scan.files[file];
  if (entry && entry.size === stat.size && entry.mtimeMs === stat.mtimeMs) return false;
  if (!entry || stat.size < entry.parsed) {
    entry = { sid, cwd: '', firstPrompt: '', start: '', end: '', days: {}, parsed: 0 };
  }
  const fd = fs.openSync(file, 'r');
  try {
    const len = stat.size - entry.parsed;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, entry.parsed);
    // 只解析到最后一个换行，剩下的半行留到下次
    const lastNl = buf.lastIndexOf(0x0a);
    if (lastNl >= 0) {
      parseChunk(entry, buf.subarray(0, lastNl + 1).toString('utf-8'));
      entry.parsed += lastNl + 1;
    }
  } finally {
    fs.closeSync(fd);
  }
  entry.size = stat.size;
  entry.mtimeMs = stat.mtimeMs;
  scan.files[file] = entry;
  return true;
}

let lastRefresh = 0;
function refreshScan() {
  if (Date.now() - lastRefresh < 5000) return;
  lastRefresh = Date.now();
  const seen = new Set();
  let changed = false;
  let dirs = [];
  try { dirs = fs.readdirSync(LOG_ROOT, { withFileTypes: true }); } catch { /* 没有日志 */ }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const full = path.join(LOG_ROOT, dir.name);
    let names = [];
    try { names = fs.readdirSync(full); } catch { continue; }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      const file = path.join(full, name);
      seen.add(file);
      try {
        if (scanFile(file, fs.statSync(file))) changed = true;
      } catch (err) {
        console.error(`扫描失败 ${file}: ${err.message}`);
      }
    }
  }
  // Claude Code 默认会清理 30 天前的日志；文件没了也保留已扫描的摘要，日历才看得到更早的日子
  for (const [file, entry] of Object.entries(scan.files)) {
    if (!seen.has(file) && !entry.gone) { entry.gone = true; changed = true; }
  }
  if (changed) saveScanCache();
}
// ── CloudCLI 里的会话标题、项目名（只读，失败就退回日志里的首条提问）─────

let names = { at: 0, sessions: new Map(), projects: new Map(), aliases: new Map() };

async function loadNames() {
  if (Date.now() - names.at < 30000) return names;
  const next = { at: Date.now(), sessions: new Map(), projects: new Map(), aliases: new Map() };
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(CLOUDCLI_DB, { readOnly: true });
    try {
      for (const r of db.prepare('SELECT session_id, provider_session_id, custom_name FROM sessions').all()) {
        const sid = r.provider_session_id || r.session_id;
        if (r.custom_name) next.sessions.set(sid, r.custom_name);
        if (r.session_id !== sid) next.aliases.set(r.session_id, sid);
      }
      for (const r of db.prepare('SELECT project_path, custom_project_name FROM projects').all()) {
        if (r.custom_project_name) next.projects.set(r.project_path, r.custom_project_name);
      }
    } finally {
      db.close();
    }
  } catch (err) {
    if (!names.warned) console.error(`读取 CloudCLI 数据库失败，改用日志标题：${err.message}`);
    next.warned = true;
  }
  names = next;
  return names;
}

// ── 目标 / 状态 / 完成度记录（格式与 skill 里的 sg.py 一致）──────────────

function projectKey(p) {
  return crypto.createHash('sha1').update(p, 'utf-8').digest('hex').slice(0, 16);
}

function recordFile(kind, key) {
  if (kind === 'sessions' && !/^[A-Za-z0-9-]+$/.test(key)) throw new Error('会话 ID 不合法');
  return path.join(GOAL_ROOT, kind, `${kind === 'sessions' ? key : projectKey(key)}.json`);
}

function loadRecord(kind, key) {
  try {
    return JSON.parse(fs.readFileSync(recordFile(kind, key), 'utf-8'));
  } catch {
    return null;
  }
}

function saveRecord(kind, key, fields) {
  const rec = loadRecord(kind, key) ?? { id: key, goal: '', status: '', progress: null, note: '', updated_at: '', history: [] };
  const changes = {};
  if (typeof fields.goal === 'string') changes.goal = fields.goal.trim().slice(0, 500);
  if (typeof fields.note === 'string') changes.note = fields.note.trim().slice(0, 500);
  if (fields.status !== undefined) {
    if (fields.status !== '' && !STATUSES.includes(fields.status)) throw new Error('状态不合法');
    changes.status = fields.status;
  }
  if (fields.progress !== undefined) {
    const n = fields.progress === null ? null : Math.round(Number(fields.progress));
    if (n !== null && !(n >= 0 && n <= 100)) throw new Error('完成度必须在 0–100');
    changes.progress = n;
  }
  if (kind === 'sessions' && !rec.project && typeof fields.project === 'string') rec.project = fields.project;
  Object.assign(rec, changes);
  rec.updated_at = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  rec.history = [...(rec.history ?? []), { at: rec.updated_at, by: 'user', ...changes }].slice(-HISTORY_LIMIT);
  const file = recordFile(kind, key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rec, null, 2));
  fs.renameSync(tmp, file);
  return rec;
}

function allSessionRecords() {
  const dir = path.join(GOAL_ROOT, 'sessions');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return []; }
  return files.map((f) => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')); } catch { return null; }
  }).filter(Boolean);
}
// ── 汇总 ──────────────────────────────────────────────────────────────

function oneLine(s, n = 80) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function entriesBySid() {
  const map = new Map();
  for (const e of Object.values(scan.files)) map.set(e.sid, e);
  return map;
}

function projectInfo(p, nm) {
  return { path: p, name: nm.projects.get(p) || path.basename(p) || p, record: loadRecord('projects', p) };
}

function sessionInfo(e, nm, day) {
  const d = day ? e.days[day] : null;
  return {
    id: e.sid,
    title: oneLine(nm.sessions.get(e.sid) || e.firstPrompt || e.sid),
    project: e.cwd,
    start: e.start,
    end: e.end,
    prompts: Object.values(e.days).reduce((s, x) => s + x.prompts, 0),
    day: d ? { prompts: d.prompts, first: d.first, last: d.last, firstPrompt: oneLine(d.firstPrompt, 120) } : null,
    gone: !!e.gone,
    record: loadRecord('sessions', e.sid),
  };
}

// detail=true 时每天附带会话列表，供纯日历视图在格子里直接显示
function month(m, nm, detail) {
  if (!/^\d{4}-\d{2}$/.test(m)) throw new Error('month 格式应为 YYYY-MM');
  const days = {};
  for (const e of Object.values(scan.files)) {
    const rec = loadRecord('sessions', e.sid);
    const status = rec?.status || '';
    for (const [day, d] of Object.entries(e.days)) {
      if (!day.startsWith(m) || d.prompts === 0) continue;
      const x = (days[day] ??= { sessions: 0, prompts: 0, statuses: {}, ...(detail ? { list: [] } : {}) });
      x.sessions += 1;
      x.prompts += d.prompts;
      if (status) x.statuses[status] = (x.statuses[status] ?? 0) + 1;
      if (detail) {
        x.list.push({
          id: e.sid,
          title: oneLine(nm.sessions.get(e.sid) || d.firstPrompt || e.firstPrompt || e.sid, 40),
          project: nm.projects.get(e.cwd) || path.basename(e.cwd || ''),
          prompts: d.prompts,
          status,
          progress: rec?.progress ?? null,
        });
      }
    }
  }
  if (detail) for (const x of Object.values(days)) x.list.sort((a, b) => b.prompts - a.prompts);
  return { month: m, days };
}

// 侧边栏用：所有设过状态的会话 → 状态。CloudCLI 侧边栏可能用应用侧 ID，两种 ID 都给
function statuses(nm) {
  const out = {};
  for (const r of allSessionRecords()) if (r.status) out[r.id] = r.status;
  for (const [appId, sid] of nm.aliases) if (out[sid]) out[appId] = out[sid];
  return out;
}

function day(date, nm) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date 格式应为 YYYY-MM-DD');
  const groups = new Map();
  for (const e of Object.values(scan.files)) {
    const d = e.days[date];
    if (!d || d.prompts === 0) continue;
    const key = e.cwd || '(未知目录)';
    if (!groups.has(key)) groups.set(key, { ...projectInfo(key, nm), sessions: [] });
    groups.get(key).sessions.push(sessionInfo(e, nm, date));
  }
  const projects = [...groups.values()];
  for (const g of projects) g.sessions.sort((a, b) => a.day.first.localeCompare(b.day.first));
  projects.sort((a, b) => b.sessions.reduce((s, x) => s + x.day.prompts, 0) - a.sessions.reduce((s, x) => s + x.day.prompts, 0));
  return { date, projects };
}

function openSessions(nm) {
  const bySid = entriesBySid();
  return allSessionRecords()
    .filter((r) => ['doing', 'waiting', 'paused'].includes(r.status))
    .map((r) => {
      const e = bySid.get(r.id);
      return e ? sessionInfo(e, nm) : { id: r.id, title: oneLine(r.goal || r.id), project: r.project || '', end: r.updated_at, prompts: 0, record: r };
    })
    .sort((a, b) => String(b.end).localeCompare(String(a.end)));
}

function current(sessionId, projectPath, nm) {
  const sid = sessionId ? (nm.aliases.get(sessionId) || sessionId) : '';
  const e = sid ? entriesBySid().get(sid) : null;
  const session = sid ? (e ? sessionInfo(e, nm) : { id: sid, title: '', project: projectPath, record: loadRecord('sessions', sid) }) : null;
  const proj = projectPath || e?.cwd || '';
  return { session, project: proj ? projectInfo(proj, nm) : null };
}

// ── HTTP ──────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e5) reject(new Error('请求体过大')); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('JSON 无效')); } });
    req.on('error', reject);
  });
}

async function handle(req) {
  const url = new URL(req.url, 'http://localhost');
  const q = (k) => url.searchParams.get(k) ?? '';
  const nm = await loadNames();
  if (req.method === 'GET') {
    refreshScan();
    if (url.pathname === '/month') return month(q('month'), nm, q('detail') === '1');
    if (url.pathname === '/statuses') return statuses(nm);
    if (url.pathname === '/day') return day(q('date'), nm);
    if (url.pathname === '/open') return { sessions: openSessions(nm) };
    if (url.pathname === '/current') return current(q('session'), q('project'), nm);
  }
  if (req.method === 'POST') {
    const body = await readBody(req);
    if (url.pathname === '/session') {
      const sid = nm.aliases.get(body.id) || body.id;
      const project = entriesBySid().get(sid)?.cwd || body.project;
      return saveRecord('sessions', String(sid ?? ''), { ...body, project });
    }
    if (url.pathname === '/project') {
      if (typeof body.path !== 'string' || !path.isAbsolute(body.path)) throw new Error('项目路径不合法');
      return saveRecord('projects', body.path, body);
    }
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    const out = await handle(req);
    if (out === null) { res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); return; }
    res.end(JSON.stringify(out));
  } catch (err) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(0, '127.0.0.1', () => {
  const addr = server.address();
  console.log(JSON.stringify({ ready: true, port: addr.port }));
  // 首次扫描可能要几秒，放到报 ready 之后，避免宿主 10 秒超时
  setImmediate(() => { try { refreshScan(); } catch (err) { console.error(err); } });
});
