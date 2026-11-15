/* Oracle 2 — single-file app. No libraries, no build step. */
'use strict';

// ------------------------------------------------------------------ core utils
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const sum = (a, f = x => x) => a.reduce((s, x) => s + (+f(x) || 0), 0);
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? 0 : n; };
const r2 = n => Math.round(n * 100) / 100;
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const pd = s => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return iso(d); };
const diff = (a, b) => Math.round((pd(b) - pd(a)) / 864e5);
const maxd = (a, b) => a > b ? a : b, mind = (a, b) => a < b ? a : b;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dowi = s => (pd(s).getDay() + 6) % 7;
const monday = s => addDays(s, -dowi(s));
const fd = s => { const d = pd(s); return `${pad(d.getDate())} ${MON[d.getMonth()]}`; };
const fdl = s => `${DOW[dowi(s)]} ${fd(s)}`;
const eur = (n, dec = 2) => (n < 0 ? '−' : '') + '€' + Math.abs(n).toLocaleString('en-IE', {minimumFractionDigits: dec, maximumFractionDigits: dec});
const eur0 = n => eur(n, Math.abs(n) >= 1000 ? 0 : 2);
const daysIn = (y, m) => new Date(y, m, 0).getDate(); // m: 1-12
const qs = new URLSearchParams(location.search);
const TODAY = qs.get('date') || iso(new Date());

function lastWorkday(y, m) { // m 1-12
  let d = new Date(y, m - 1, daysIn(y, m));
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return iso(d);
}
function estNextPayday(date) {
  const d = pd(date), y = d.getFullYear(), m = d.getMonth() + 1;
  const same = lastWorkday(y, m);
  if (diff(date, same) > 20) return same; // paid early in the month
  return m === 12 ? lastWorkday(y + 1, 1) : lastWorkday(y, m + 1);
}
function parseDateWord(w) {
  if (!w) return null;
  w = w.toLowerCase();
  if (w === 'today') return TODAY;
  if (w === 'tomorrow' || w === 'tmr') return addDays(TODAY, 1);
  if (w === 'yesterday') return addDays(TODAY, -1);
  const di = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].indexOf(w.slice(0, 3));
  if (di >= 0 && /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*$/.test(w)) { let n = (di - dowi(TODAY) + 7) % 7; return addDays(TODAY, n || 7); }
  let m = w.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = w.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?$/);
  if (m) {
    let y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : TODAY.slice(0, 4);
    let s = `${y}-${pad(m[2])}-${pad(m[1])}`;
    if (!m[3] && s < TODAY) s = `${+y + 1}-${pad(m[2])}-${pad(m[1])}`;
    return s;
  }
  return null;
}

// ------------------------------------------------------------------ data, storage & sync
const APP_VERSION = '2.1.0', DATA_VERSION = 2;
const COLLS = ['wishlist', 'people', 'tasks', 'paychecks', 'transactions', 'savingsMoves', 'recurring', 'goals', 'workouts', 'body'];
let D = null, saveTimer = null, SNAP = {}, SYNC = null, NOTIFIED = {};
const UI = {view: 'today', moneyTab: 'overview', gymTab: 'overview', recTab: 'people', calMonth: TODAY.slice(0, 7), calSel: TODAY, gymEx: null, txFilter: 'period', search: '', importPreview: null, sync: {state: 'off', msg: ''}};

// Everything lives in this browser's IndexedDB on this device (works offline, survives updates).
const idb = (() => {
  let dbp = null;
  const open = () => dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('oracle2', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const run = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction('kv', mode), q = fn(t.objectStore('kv')); t.oncomplete = () => res(q.result); t.onerror = () => rej(t.error); }); };
  return {get: k => run('readonly', s => s.get(k)), set: (k, v) => run('readwrite', s => s.put(v, k)), del: k => run('readwrite', s => s.delete(k))};
})();
const store = {
  async get(k) { try { return await idb.get(k); } catch { return JSON.parse(localStorage.getItem('oracle2:' + k) || 'null'); } },
  async set(k, v) { try { await idb.set(k, v); } catch { localStorage.setItem('oracle2:' + k, JSON.stringify(v)); } },
};

function defaults() {
  return {version: DATA_VERSION, settings: {split: {needs: 50, wants: 30, savings: 20}, reminderDays: 7, startingSavings: 0, gymGoal: {weightMin: 0, weightMax: 0}, onboarded: false,
    categories: [['Bills', 'needs'], ['Subscriptions', 'needs'], ['Food', 'needs'], ['Transport', 'needs'], ['Health', 'needs'], ['Eating out', 'wants'], ['Entertainment', 'wants'], ['Hobbies', 'wants'], ['Shopping', 'wants'], ['Investing', 'savings'], ['Other', 'wants']].map(([name, bucket]) => ({name, bucket}))},
    wishlist: [], people: [], tasks: [], paychecks: [], transactions: [], savingsMoves: [], recurring: [], goals: [], workouts: [], body: [], meta: {tomb: {}, settingsU: {}}};
}
// Upgrades older saved data so updates never lose anything. Add a step here whenever the format changes.
function migrate(d) {
  const def = defaults();
  for (const k of COLLS) d[k] ||= [];
  d.settings = {...def.settings, ...(d.settings || {})};
  d.settings.gymGoal ||= def.settings.gymGoal; d.settings.split ||= def.settings.split;
  d.meta ||= {}; d.meta.tomb ||= {}; if (typeof d.meta.settingsU !== 'object' || !d.meta.settingsU) d.meta.settingsU = {}; delete d.meta.notified;
  if ((d.version || 1) < 2) { /* v1 → v2: nothing to convert, records get sync stamps on first save */ }
  d.version = DATA_VERSION;
  return d;
}
async function loadData() {
  D = migrate((await store.get('data')) || defaults());
  SYNC = await store.get('sync'); NOTIFIED = (await store.get('notified')) || {};
  SNAP = snapOf();
}

// change tracking: every record carries _u (last edit time); deletions leave a tombstone. That's what lets devices merge.
function snapOf() { const m = {}; for (const c of COLLS) for (const r of D[c]) m[c + ':' + r.id] = JSON.stringify({...r, _u: 0}); for (const k in D.settings) m['set:' + k] = JSON.stringify(D.settings[k]); return m; }
function stamp() {
  const now = Date.now(), cur = snapOf();
  for (const c of COLLS) for (const r of D[c]) { const k = c + ':' + r.id; if (SNAP[k] !== cur[k]) r._u = now; }
  for (const k in SNAP) if (!k.startsWith('set:') && !(k in cur)) D.meta.tomb[k] = now;
  for (const k in D.settings) if (SNAP['set:' + k] !== cur['set:' + k]) D.meta.settingsU[k] = now;
  SNAP = cur;
}
async function persist() { await store.set('data', D); }
function save() {
  stamp();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => { await persist(); if (SYNC) { clearTimeout(UI.syncSoon); UI.syncSoon = setTimeout(syncNow, 3000); } showSaveState(); }, 250);
}
function commit() { save(); render(); }
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2700); }
function ago(ms) { const s = (Date.now() - ms) / 1000; return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + 'm ago' : s < 86400 ? Math.round(s / 3600) + 'h ago' : Math.round(s / 86400) + 'd ago'; }
function showSaveState() {
  const el = $('#saveState'); if (!el) return;
  const s = UI.sync.state;
  el.className = s === 'error' ? 'bad' : s === 'syncing' ? 'warn' : '';
  el.textContent = !SYNC ? '● saved on this device' : s === 'syncing' ? '● syncing…' : s === 'error' ? '● sync problem' : `● synced ${SYNC.last ? ago(SYNC.last) : ''}`;
  el.title = UI.sync.msg || '';
}

// ---- merge two copies of the data: newest edit of each record wins, deletions win over older edits
function mergeData(L, R, preferRemote = false) {
  const out = JSON.parse(JSON.stringify(L)), tomb = {...(L.meta.tomb || {})};
  for (const [k, v] of Object.entries((R.meta || {}).tomb || {})) tomb[k] = Math.max(tomb[k] || 0, v);
  const cutoff = Date.now() - 120 * 864e5;
  for (const k in tomb) if (tomb[k] < cutoff) delete tomb[k];
  for (const c of COLLS) {
    const m = new Map();
    for (const r of [...(L[c] || []), ...(R[c] || [])]) { const ex = m.get(r.id); if (!ex || (r._u || 0) > (ex._u || 0)) m.set(r.id, r); }
    out[c] = [...m.values()].filter(r => !((tomb[c + ':' + r.id] || 0) >= (r._u || 0)));
  }
  // settings merge field by field (split, savings, categories…): newest edit of each wins
  const lu = L.meta.settingsU || {}, ru = (R.meta || {}).settingsU || {};
  out.meta.settingsU = {...lu};
  for (const k in R.settings || {}) if ((ru[k] || 0) > (lu[k] || 0) || (preferRemote && k in R.settings)) { out.settings[k] = R.settings[k]; out.meta.settingsU[k] = ru[k] || 0; }
  out.meta.tomb = tomb;
  return out;
}
const canon = d => JSON.stringify([COLLS.map(c => [...(d[c] || [])].sort((a, b) => a.id < b.id ? -1 : 1)), Object.keys(d.settings).sort().map(k => [k, d.settings[k]]), Object.keys(d.meta.tomb || {}).sort()]);

// ---- end-to-end encryption (AES-256-GCM, key from your passphrase; GitHub only ever sees scrambled bytes)
const b64 = buf => { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode(...a.subarray(i, i + 8192)); return btoa(s); };
const ub64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const keyCache = {};
async function deriveKey(pass, salt) {
  const id = pass + '|' + salt; if (keyCache[id]) return keyCache[id];
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return keyCache[id] = await crypto.subtle.deriveKey({name: 'PBKDF2', salt: ub64(salt), iterations: 250000, hash: 'SHA-256'}, base, {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
}
async function encryptData(d, pass, salt) {
  const iv = crypto.getRandomValues(new Uint8Array(12)), key = await deriveKey(pass, salt);
  const ct = await crypto.subtle.encrypt({name: 'AES-GCM', iv}, key, new TextEncoder().encode(JSON.stringify(d)));
  return JSON.stringify({app: 'oracle2', v: 1, salt, iv: b64(iv), ct: b64(ct), at: Date.now()});
}
async function decryptData(blob, pass) {
  const b = JSON.parse(blob), key = await deriveKey(pass, b.salt);
  try { return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name: 'AES-GCM', iv: ub64(b.iv)}, key, ub64(b.ct)))); }
  catch { throw new Error('Wrong sync passphrase — it must match the one used on your other devices.'); }
}

// ---- relay: one private (secret) gist on your own GitHub account holds the encrypted copy
const GIST_DESC = 'Oracle 2 sync (encrypted)', GIST_FILE = 'oracle2.sync';
async function gh(path, opt = {}) {
  const r = await fetch('https://api.github.com' + path, {cache: 'no-store', ...opt, headers: {Authorization: 'Bearer ' + SYNC.token, Accept: 'application/vnd.github+json', ...(opt.body ? {'Content-Type': 'application/json'} : {})}});
  if (r.status === 401) throw new Error('GitHub rejected the sync token. Create a new one in Settings → Sync.');
  if (r.status === 404 && SYNC.gistId && path.includes(SYNC.gistId)) { SYNC.gistId = null; throw new Error('Sync storage was deleted on GitHub — it will be recreated on the next sync.'); }
  if (!r.ok) throw new Error('GitHub error ' + r.status);
  return r.json();
}
async function readRelay() {
  if (!SYNC.gistId) {
    for (let page = 1; page <= 5 && !SYNC.gistId; page++) {
      const list = await gh(`/gists?per_page=100&page=${page}`);
      const g = list.find(g => g.description === GIST_DESC && g.files[GIST_FILE]); if (g) SYNC.gistId = g.id;
      if (list.length < 100) break;
    }
    if (!SYNC.gistId) return null;
  }
  const g = await gh('/gists/' + SYNC.gistId), f = g.files[GIST_FILE]; if (!f) return null;
  return f.truncated ? await (await fetch(f.raw_url, {cache: 'no-store'})).text() : f.content;
}
async function writeRelay(blob) {
  const body = JSON.stringify({description: GIST_DESC, files: {[GIST_FILE]: {content: blob}}});
  if (SYNC.gistId) await gh('/gists/' + SYNC.gistId, {method: 'PATCH', body});
  else SYNC.gistId = (await gh('/gists', {method: 'POST', body: JSON.stringify({description: GIST_DESC, public: false, files: {[GIST_FILE]: {content: blob}}})})).id;
}
let syncing = false;
async function syncNow(manual) {
  if (!SYNC || syncing) return;
  if (!navigator.onLine) { UI.sync = {state: 'error', msg: 'Offline — will sync when back online'}; showSaveState(); return; }
  syncing = true; UI.sync = {state: 'syncing', msg: ''}; showSaveState();
  try {
    stamp();
    const blob = await readRelay();
    let R = null, merged = D;
    if (blob) { const b = JSON.parse(blob); SYNC.salt = b.salt; R = migrate(await decryptData(blob, SYNC.pass)); merged = mergeData(D, R, !SYNC.last); }
    SYNC.salt ||= b64(crypto.getRandomValues(new Uint8Array(16)));
    const changedHere = canon(merged) !== canon(D);
    if (!R || canon(merged) !== canon(R)) await writeRelay(await encryptData({version: DATA_VERSION, ...Object.fromEntries(COLLS.map(c => [c, merged[c]])), settings: merged.settings, meta: {tomb: merged.meta.tomb, settingsU: merged.meta.settingsU}}, SYNC.pass, SYNC.salt));
    D = migrate(merged); SNAP = snapOf(); await persist();
    SYNC.last = Date.now(); await store.set('sync', SYNC);
    UI.sync = {state: 'ok', msg: ''};
    if (changedHere) { render(); if (manual) toast('Synced — changes from your other devices loaded'); } else if (manual) toast('Up to date');
  } catch (e) {
    UI.sync = {state: 'error', msg: e.message}; await store.set('sync', SYNC);
    if (manual) toast(e.message);
  } finally { syncing = false; showSaveState(); if (UI.view === 'settings' && !$('#modal:not(.hidden)')) render(); }
}

// ---- reminders as phone/desktop notifications (checked on open, every 30 min while open, and in the background where supported)
async function checkReminders() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker?.getRegistration();
  NOTIFIED = (await store.get('notified')) || {};
  for (const r of computeReminders(D, TODAY)) {
    if (NOTIFIED[r.key]) continue; NOTIFIED[r.key] = TODAY;
    if (reg) reg.showNotification(r.title, {body: r.body, tag: r.key, icon: 'icon-192.png'}); else new Notification(r.title, {body: r.body});
  }
  const cut = addDays(TODAY, -60); for (const k in NOTIFIED) if (NOTIFIED[k] < cut) delete NOTIFIED[k];
  await store.set('notified', NOTIFIED);
}
async function enableNotifications() {
  if (!('Notification' in window)) return toast('This browser does not support notifications. On iPhone, install the app to the Home Screen first.');
  const p = await Notification.requestPermission();
  if (p !== 'granted') return toast('Notifications are blocked — allow them in the browser/app settings.');
  try { const reg = await navigator.serviceWorker.ready; if ('periodicSync' in reg) await reg.periodicSync.register('oracle-reminders', {minInterval: 6 * 3600e3}); } catch {}
  const reg = await navigator.serviceWorker?.getRegistration();
  reg ? reg.showNotification('Oracle 2', {body: 'Notifications are on. You\'ll get birthday and bill reminders.', icon: 'icon-192.png'}) : new Notification('Oracle 2', {body: 'Notifications are on.'});
  checkReminders(); render();
}

// ------------------------------------------------------------------ money engine
const catBucket = name => (D.settings.categories.find(c => c.name === name) || {}).bucket || 'wants';
function currentPeriod(at = TODAY) {
  const pcs = D.paychecks.filter(p => p.date <= at).sort((a, b) => a.date < b.date ? -1 : 1);
  const pc = pcs[pcs.length - 1];
  if (!pc) return null;
  const next = D.paychecks.filter(p => p.date > pc.date).sort((a, b) => a.date < b.date ? -1 : 1)[0];
  const nextPay = next ? next.date : estNextPayday(pc.date);
  const end = addDays(nextPay, -1);
  const raw = {needs: pc.amount * pc.split.needs / 100, wants: pc.amount * pc.split.wants / 100, savings: pc.amount * pc.split.savings / 100};
  // leftover already moved to savings leaves the spendable budget (wants first, then needs)
  const moved = pc.leftoverMoved || 0, mw = Math.min(moved, raw.wants);
  const b = {needs: raw.needs - (moved - mw), wants: raw.wants - mw, savings: raw.savings};
  return {pc, start: pc.date, end, nextPay, estimated: !next, budget: b, raw, over: at > end};
}
const salaryTx = (from, to, bucket) => D.transactions.filter(t => t.source !== 'savings' && t.date >= from && t.date <= to && (!bucket || t.bucket === bucket));
function periodStats(p) {
  const tx = salaryTx(p.start, p.end);
  const spent = {needs: sum(tx.filter(t => t.bucket === 'needs'), t => t.amount), wants: sum(tx.filter(t => t.bucket === 'wants'), t => t.amount), savings: sum(tx.filter(t => t.bucket === 'savings'), t => t.amount)};
  const unpaid = billOccurrences(maxd(p.start, TODAY), p.end).filter(o => !o.paid);
  const committed = sum(unpaid, o => o.r.amount);
  const needsLeft = p.budget.needs - spent.needs, wantsLeft = p.budget.wants - spent.wants;
  return {tx, spent, unpaid, committed, needsLeft, wantsLeft, leftover: needsLeft - committed + wantsLeft};
}
function safeToSpend(p) {
  if (!p || p.over) return null;
  const wants = p.budget.wants, ws = monday(TODAY);
  const weekStart = maxd(ws, p.start), weekEnd = mind(addDays(ws, 6), p.end);
  const spentBefore = sum(salaryTx(p.start, addDays(weekStart, -1), 'wants'), t => t.amount);
  const remAtWeek = wants - spentBefore;
  const weekAllow = remAtWeek * (diff(weekStart, weekEnd) + 1) / (diff(weekStart, p.end) + 1);
  const spentPrev = sum(salaryTx(weekStart, addDays(TODAY, -1), 'wants'), t => t.amount);
  const spentToday = sum(salaryTx(TODAY, TODAY, 'wants'), t => t.amount);
  const daysLeft = diff(TODAY, weekEnd) + 1;
  const todayAllow = (weekAllow - spentPrev) / daysLeft;
  return {weekAllow, weekLeft: weekAllow - spentPrev - spentToday, todayAllow, todayLeft: todayAllow - spentToday, spentToday, spentWeek: spentPrev + spentToday, daysLeft, weekStart, weekEnd};
}
function savingsBalance(at = '9999') {
  const dep = sum(D.savingsMoves.filter(m => m.date <= at), m => m.kind === 'withdraw' ? -m.amount : m.amount);
  const spent = sum(D.transactions.filter(t => t.source === 'savings' && t.date <= at), t => t.amount);
  return (+D.settings.startingSavings || 0) + dep - spent;
}
function billOccurrences(from, to) {
  const out = [];
  let y = +from.slice(0, 4), m = +from.slice(5, 7);
  while (`${y}-${pad(m)}` <= to.slice(0, 7)) {
    for (const r of D.recurring) {
      if (r.active === false) continue;
      const date = `${y}-${pad(m)}-${pad(Math.min(+r.day || 1, daysIn(y, m)))}`;
      if (r.startDate && date < r.startDate) continue;
      if (date >= from && date <= to) { const ym = `${y}-${pad(m)}`; out.push({r, date, ym, paid: !!(r.payments || {})[ym]}); }
    }
    if (++m > 12) { m = 1; y++; }
  }
  return out.sort((a, b) => a.date < b.date ? -1 : 1);
}
function nextBirthday(b) {
  const m = (b || '').match(/(\d{2})-(\d{2})$/);
  if (!m) return null;
  for (const y of [+TODAY.slice(0, 4), +TODAY.slice(0, 4) + 1]) {
    let s = `${y}-${m[1]}-${m[2]}`;
    if (m[1] === '02' && m[2] === '29' && daysIn(y, 2) === 28) s = `${y}-03-01`;
    if (s >= TODAY) return s;
  }
}
const birthYear = b => /^\d{4}-/.test(b || '') ? +b.slice(0, 4) : null;

// ------------------------------------------------------------------ gym engine
const MUSCLES = [
  [/leg curl|hamstring/i, 'Legs'], [/leg ext|squat|leg press|lunge|calf|hip thrust|glute|hack|romanian|rdl|step.?up|adduct|abduct/i, 'Legs'],
  [/leg raise|crunch|plank|\bab\b|abs|sit.?up|russian twist|wood ?chop|hollow/i, 'Core'],
  [/lateral raise|shoulder|overhead|military|arnold|rear delt|face pull|upright row|front raise|reverse fly/i, 'Shoulders'],
  [/tricep|pushdown|skull|close.?grip|dip|overhead ext|kickback/i, 'Triceps'],
  [/curl|hammer|preacher/i, 'Biceps'],
  [/bench|chest|fly|flye|pec|push.?up|crossover/i, 'Chest'],
  [/deadlift|row|pulldown|pull.?up|chin.?up|lat\b|lats|pullover|back ext|shrug/i, 'Back'],
];
const goalBand = () => { const g = D.settings.gymGoal || {}; return g.weightMax > 0 ? [g.weightMin || g.weightMax, g.weightMax] : null; };
const muscleOf = n => (MUSCLES.find(([re]) => re.test(n)) || [0, 'Other'])[1];
const e1rm = s => s.w > 0 && s.r > 0 ? s.w * (1 + Math.min(s.r, 15) / 30) : 0;
const wVol = w => sum(w.exercises, e => sum(e.sets, s => (s.w || 0) * (s.r || 0)));
const wSets = w => sum(w.exercises, e => e.sets.length);
const workoutsSorted = () => [...D.workouts].sort((a, b) => a.date < b.date ? -1 : 1);

function parseHevy(text) {
  const out = [], DATE_RE = /([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4})(?:\s+at\s+(\d{1,2}):(\d{2})\s*(am|pm)?)?/i;
  const all = text.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
  const starts = all.map((l, i) => i + 1 < all.length && DATE_RE.test(all[i + 1]) && !/^set\s*\d/i.test(l) ? i : -1).filter(i => i >= 0);
  if (!starts.length && all.length) starts.push(0);
  const chunks = starts.map((s, k) => all.slice(s, starts[k + 1] ?? all.length));
  for (const chunk of chunks) {
    const link = (chunk.join('\n').match(/https?:\/\/(www\.)?hevy\.com\/workout\/\S+/i) || [])[0] || null;
    const lines = chunk.filter(l => !/^https?:\/\//.test(l) && !/^@hevyapp$/i.test(l));
    if (lines.length < 3) continue;
    let i = 0, title = lines[0], date = null;
    const dm = (lines[1] || '').match(DATE_RE);
    if (dm) {
      let h = +(dm[4] || 12); if (dm[6]) { if (/pm/i.test(dm[6]) && h < 12) h += 12; if (/am/i.test(dm[6]) && h === 12) h = 0; }
      date = `${dm[3]}-${pad(MON.findIndex(x => x.toLowerCase() === dm[1].toLowerCase()) + 1)}-${pad(dm[2])}T${pad(h)}:${dm[5] || '00'}`;
      i = 2;
    } else i = 1;
    const exercises = []; let cur = null;
    for (; i < lines.length; i++) {
      const l = lines[i];
      const sm = l.match(/^(?:set\s*\d+|w|warm.?up|d|drop|f|failure)[^:]*:\s*(.*)$/i);
      if (sm && cur) {
        const body = sm[1];
        const wr = body.match(/([\d.,]+)\s*(kg|lbs?)\s*[x×]\s*(\d+)/i);
        const ro = body.match(/^(\d+)\s*reps?/i);
        let w = 0, r = 0;
        if (wr) { w = num(wr[1]); if (/lb/i.test(wr[2])) w = r2(w * 0.4536); r = +wr[3]; }
        else if (ro) r = +ro[1];
        else continue; // time / distance sets are skipped
        cur.sets.push({w, r, warm: /^(w|warm)/i.test(l)});
      } else if (!sm) { cur = {name: l, sets: []}; exercises.push(cur); }
    }
    const ex = exercises.filter(e => e.sets.length);
    if (ex.length) out.push({id: uid(), title, date: date || TODAY + 'T12:00', exercises: ex, link, source: 'hevy-text'});
  }
  return out;
}
function addWorkouts(list) {
  let added = 0, replaced = 0;
  for (const w of list) {
    const i = D.workouts.findIndex(x => (w.link && x.link === w.link) || (x.date === w.date && x.title === w.title));
    if (i >= 0) { w.id = D.workouts[i].id; D.workouts[i] = w; replaced++; } else { D.workouts.push(w); added++; }
  }
  return {added, replaced};
}
function exerciseHistory(name) {
  return workoutsSorted().map(w => { const e = w.exercises.find(e => e.name === name); if (!e) return null;
    const work = e.sets.filter(s => !s.warm);
    return {date: w.date.slice(0, 10), e1rm: Math.max(0, ...work.map(e1rm)), top: Math.max(0, ...work.map(s => s.w)), reps: work.reduce((b, s) => s.w >= b.w ? s : b, {w: -1, r: 0}).r, vol: sum(work, s => s.w * s.r)}; }).filter(Boolean);
}
function regressionPerWeek(pts) { // pts [{x:iso,y}] → slope per week
  if (pts.length < 2) return null;
  const x0 = pts[0].x, xs = pts.map(p => diff(x0, p.x)), ys = pts.map(p => p.y);
  const mx = sum(xs) / xs.length, my = sum(ys) / ys.length;
  const den = sum(xs, x => (x - mx) ** 2); if (!den) return null;
  return sum(xs.map((x, i) => (x - mx) * (ys[i] - my))) / den * 7;
}
function gymInsights() {
  const out = [], ws = workoutsSorted(), from28 = addDays(TODAY, -27);
  const recent = ws.filter(w => w.date.slice(0, 10) >= from28);
  if (!ws.length) return [{ic: '›', t: 'Import your first Hevy workout to start seeing stats.'}];
  const perWeek = recent.length / 4;
  out.push(perWeek >= 3 ? {ic: '✓', c: 'good', t: `${perWeek.toFixed(1)} sessions/week over the last 4 weeks — solid frequency for strength and muscle.`}
    : {ic: '!', c: 'warn', t: `${perWeek.toFixed(1)} sessions/week over the last 4 weeks. 3–4 per week gives each muscle 2 hits — the main lever for growth.`});
  const sets = {}; for (const w of recent) for (const e of w.exercises) sets[muscleOf(e.name)] = (sets[muscleOf(e.name)] || 0) + e.sets.filter(s => !s.warm).length;
  const low = ['Chest', 'Back', 'Shoulders', 'Legs', 'Biceps', 'Triceps'].filter(g => (sets[g] || 0) / 4 < 8);
  if (low.length) out.push({ic: '!', c: 'warn', t: `Under 8 hard sets/week: ${low.join(', ')}. ~10–20 sets per muscle per week is the usual target for building muscle.`});
  if ((sets.Legs || 0) / 4 < 6) out.push({ic: '›', t: 'Legs are the biggest muscle group — heavy squats/presses also burn the most energy, which helps your fat-loss goal.'});
  const names = [...new Set(ws.flatMap(w => w.exercises.map(e => e.name)))];
  for (const n of names) {
    const h = exerciseHistory(n).filter(x => x.e1rm > 0); if (h.length < 4) continue;
    const last3 = Math.max(...h.slice(-3).map(x => x.e1rm)), before = Math.max(...h.slice(0, -3).map(x => x.e1rm));
    if (last3 <= before) out.push({ic: '→', c: 'warn', t: `${n}: no strength gain in the last 3 sessions. Try double progression — add reps until the top of your range, then add weight.`});
    else if (last3 > before * 1.05) out.push({ic: '↑', c: 'good', t: `${n}: est. 1RM up ${Math.round((last3 / before - 1) * 100)}% — keep this progression going.`});
  }
  const bw = D.body.filter(b => b.weight).sort((a, b) => a.date < b.date ? -1 : 1);
  const rw = bw.filter(b => b.date >= addDays(TODAY, -27)).map(b => ({x: b.date, y: +b.weight}));
  const slope = regressionPerWeek(rw), g = D.settings.gymGoal;
  if (slope !== null && rw.length >= 3) {
    const cur = rw[rw.length - 1].y, pct = slope / cur * 100;
    if (slope > 0.1) out.push({ic: '!', c: 'warn', t: `Weight trending up ${slope.toFixed(2)} kg/week. ${g.weightMax ? `To reach ${g.weightMin}–${g.weightMax} kg you` : 'To lose fat you'} need a small calorie deficit.`});
    else if (pct < -1) out.push({ic: '!', c: 'warn', t: `Losing ${Math.abs(slope).toFixed(2)} kg/week (>1% bodyweight) — fast enough to risk muscle. Aim for ~0.4–0.8 kg/week.`});
    else if (slope < -0.1) { const wks = Math.ceil((cur - g.weightMax) / -slope); out.push({ic: '✓', c: 'good', t: `Losing ${Math.abs(slope).toFixed(2)} kg/week — a good pace for keeping muscle.${g.weightMax && cur > g.weightMax ? ` At this rate you reach ${g.weightMax} kg in ~${wks} weeks.` : ''}`}); }
    else out.push({ic: '›', t: 'Weight is flat. If your waist is shrinking while lifts go up, you are recomposing — otherwise trim intake slightly.'});
  } else out.push({ic: '›', t: 'Log your weight 2–3× a week (same time, morning) to see a reliable trend.'});
  const wa = D.body.filter(b => b.waist).sort((a, b) => a.date < b.date ? -1 : 1);
  if (wa.length >= 2) { const d = wa[wa.length - 1].waist - wa[0].waist; out.push({ic: d < 0 ? '✓' : '›', c: d < 0 ? 'good' : '', t: `Waist ${d < 0 ? 'down' : 'up'} ${Math.abs(d).toFixed(1)} cm since ${fd(wa[0].date)} — the clearest sign of torso fat loss.`}); }
  return out;
}

// ------------------------------------------------------------------ charts (SVG, no libraries)
const PAL = {needs: 'var(--needs)', wants: 'var(--wants)', savings: 'var(--savings)', extra: 'var(--extra)', accent: 'var(--accent)'};
function niceMax(v) { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
function donut(segs, center = '', sub = '', size = 168) {
  const total = sum(segs, s => s.value) || 1, r = 62, c = 2 * Math.PI * r; let off = 0;
  const arcs = segs.filter(s => s.value > 0).map(s => {
    const len = s.value / total * c, gap = segs.filter(x => x.value > 0).length > 1 ? 2.5 : 0;
    const el = `<circle r="${r}" cx="80" cy="80" fill="none" stroke="${s.color}" stroke-width="16" stroke-dasharray="${Math.max(len - gap, 0.1)} ${c}" stroke-dashoffset="${-off}" transform="rotate(-90 80 80)" data-tip="${esc(s.tip || s.label + '\n' + eur(s.value))}"/>`;
    off += len; return el;
  }).join('');
  return `<svg viewBox="0 0 160 160" width="${size}" height="${size}"><circle r="${r}" cx="80" cy="80" fill="none" stroke="#1b1b20" stroke-width="16"/>${arcs}
    <text x="80" y="78" text-anchor="middle" fill="var(--text)" font-size="17">${esc(center)}</text><text x="80" y="96" text-anchor="middle" fill="var(--muted)" font-size="9.5" letter-spacing=".08em">${esc(sub)}</text></svg>`;
}
function columns(data, {h = 170, color = PAL.accent, fmt = v => Math.round(v), ref = null, W = 640} = {}) {
  const L = 44, B = 22, T = 10, max = niceMax(Math.max(ref || 0, ...data.map(d => d.value), 0));
  const bw = (W - L) / data.length, y = v => T + (h - T - B) * (1 - v / max);
  let g = '';
  const nt = max <= 6 && Number.isInteger(max) ? max : 4;
  for (let i = 0; i <= nt; i++) { const v = max * i / nt; g += `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="#1d1d22"/><text x="${L - 8}" y="${y(v) + 3}" fill="var(--faint)" font-size="10" text-anchor="end">${esc(fmt(v))}</text>`; }
  const bars = data.map((d, i) => {
    const x = L + i * bw + bw * 0.18, w = bw * 0.64, top = y(d.value), hh = Math.max(h - B - top, d.value > 0 ? 2 : 0);
    const rr = Math.min(4, w / 2, hh);
    const path = hh > 0 ? `M${x},${h - B} V${top + rr} Q${x},${top} ${x + rr},${top} H${x + w - rr} Q${x + w},${top} ${x + w},${top + rr} V${h - B} Z` : '';
    return `<g data-tip="${esc(d.tip || d.label + '\n' + fmt(d.value))}"><rect x="${L + i * bw}" y="${T}" width="${bw}" height="${h - T - B}" fill="transparent"/><path d="${path}" fill="${d.color || color}"/></g>
      <text x="${x + w / 2}" y="${h - 6}" fill="var(--muted)" font-size="10" text-anchor="middle">${esc(d.label)}</text>`;
  }).join('');
  const refl = ref ? `<line x1="${L}" x2="${W}" y1="${y(ref)}" y2="${y(ref)}" stroke="var(--muted)" stroke-dasharray="3 4"/><text x="${W}" y="${y(ref) - 5}" fill="var(--muted)" font-size="10" text-anchor="end">target</text>` : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${h}">${g}<line x1="${L}" x2="${W}" y1="${h - B}" y2="${h - B}" stroke="#2c2c33"/>${bars}${refl}</svg>`;
}
function lineChart(series, {h = 190, fmt = v => v, band = null, yPad = 0.15, unit = '', W = 640} = {}) {
  const pts = series.flatMap(s => s.points); if (!pts.length) return `<div class="empty">No data yet</div>`;
  const L = 44, R = 12, B = 22, T = 12;
  const xs = pts.map(p => p.x).sort(), x0 = xs[0], x1 = xs[xs.length - 1], span = Math.max(diff(x0, x1), 1);
  let lo = Math.min(...pts.map(p => p.y), ...(band || [])), hi = Math.max(...pts.map(p => p.y), ...(band || []));
  const pd_ = (hi - lo) * yPad || 1; lo -= pd_; hi += pd_;
  const X = s => L + (W - L - R) * (pts.length === 1 ? .5 : diff(x0, s) / span), Y = v => T + (h - T - B) * (1 - (v - lo) / (hi - lo));
  let g = '';
  for (let i = 0; i <= 3; i++) { const v = lo + (hi - lo) * i / 3; g += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#1d1d22"/><text x="${L - 8}" y="${Y(v) + 3}" fill="var(--faint)" font-size="10" text-anchor="end">${esc(fmt(v))}</text>`; }
  const ticks = [x0, ...(span > 20 ? [addDays(x0, Math.round(span / 2))] : []), x1].filter((v, i, a) => a.indexOf(v) === i);
  g += ticks.map((t, i) => `<text x="${X(t)}" y="${h - 6}" fill="var(--muted)" font-size="10" text-anchor="${i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}">${fd(t)}</text>`).join('');
  if (band) g += `<rect x="${L}" width="${W - L - R}" y="${Y(band[1])}" height="${Y(band[0]) - Y(band[1])}" fill="var(--accent)" opacity=".08"/><text x="${W - R - 4}" y="${Y(band[1]) + 12}" fill="var(--accent)" opacity=".8" font-size="10" text-anchor="end">goal ${band[0]}–${band[1]}${unit}</text>`;
  const lines = series.map(s => {
    const p = [...s.points].sort((a, b) => a.x < b.x ? -1 : 1);
    const d = p.map((q, i) => `${i ? 'L' : 'M'}${X(q.x).toFixed(1)},${Y(q.y).toFixed(1)}`).join('');
    const dots = p.map(q => `<g data-tip="${esc((s.name ? s.name + '\n' : '') + fdl(q.x) + '\n' + fmt(q.y) + unit)}"><circle cx="${X(q.x)}" cy="${Y(q.y)}" r="10" fill="transparent"/><circle cx="${X(q.x)}" cy="${Y(q.y)}" r="3.2" fill="${s.color}" stroke="var(--panel)" stroke-width="2"/></g>`).join('');
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" ${s.dash ? 'stroke-dasharray="4 4"' : ''}/>${dots}`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${h}">${g}${lines}</svg>`;
}
function hbars(rows, {fmt = v => v, ref = null} = {}) {
  const max = Math.max(ref ? ref * 1.4 : 0, ...rows.map(r => r.max ?? r.value), 1);
  return `<div class="list">${rows.map(r => `<div data-tip="${esc(r.tip || r.label + ': ' + fmt(r.value))}" style="margin:6px 0">
    <div class="row small"><span>${esc(r.label)}</span><span class="sp"></span><span class="muted">${r.right ?? esc(fmt(r.value))}</span></div>
    <div style="position:relative;height:8px;background:#1b1b20;border-radius:4px;margin-top:4px">
      <div style="position:absolute;left:0;top:0;bottom:0;width:${Math.min(100, Math.max(0, r.value) / max * 100)}%;background:${r.color || PAL.accent};border-radius:4px"></div>
      ${ref ? `<div style="position:absolute;left:${ref / max * 100}%;top:-3px;bottom:-3px;width:2px;background:var(--muted);opacity:.6"></div>` : ''}
    </div></div>`).join('')}</div>`;
}
const legend = items => `<div class="legend">${items.map(([c, l]) => `<span><i class="dot" style="background:${c}"></i>${esc(l)}</span>`).join('')}</div>`;

// ------------------------------------------------------------------ calendar events (shared)
function eventsOn(date) {
  const ev = [];
  for (const w of D.workouts) if (w.date.slice(0, 10) === date) ev.push({k: 'gym', g: '◆', c: 'var(--accent)', t: w.title, s: `${w.exercises.length} exercises · ${wSets(w)} sets`});
  for (const p of D.paychecks) if (p.date === date) ev.push({k: 'income', g: '+', c: 'var(--good)', t: 'Paycheck', s: eur(p.amount)});
  for (const t of D.transactions) if (t.date === date) ev.push({k: 'spend', g: '€', c: PAL[t.bucket] || 'var(--muted)', t: `${t.category}${t.note ? ' · ' + t.note : ''}`, s: eur(t.amount) + (t.source === 'savings' ? ' · from savings' : ''), amt: t.amount});
  for (const m of D.savingsMoves) if (m.date === date && !m.paycheckId) ev.push({k: 'save', g: '↗', c: 'var(--savings)', t: m.kind === 'withdraw' ? 'Savings withdrawal' : (m.note || 'To savings'), s: eur(m.amount)});
  for (const o of billOccurrences(date, date)) ev.push({k: 'bill', g: o.paid ? '✓' : '▲', c: o.paid ? 'var(--muted)' : 'var(--warn)', t: o.r.name, s: `${eur(o.r.amount)} · ${o.r.type}${o.paid ? ' · paid' : ''}`});
  for (const p of D.people) { const nb = nextBirthday(p.birthday); const md = (p.birthday || '').slice(-5);
    if (md && date.slice(5) === md) { const by = birthYear(p.birthday); ev.push({k: 'bday', g: '✦', c: 'var(--extra)', t: `${p.name}'s birthday`, s: by ? `turns ${+date.slice(0, 4) - by}` : ''}); } }
  for (const t of D.tasks) if (t.due === date) ev.push({k: 'task', g: t.done ? '☑' : '□', c: t.done ? 'var(--muted)' : 'var(--text)', t: t.title, s: t.done ? 'done' : ''});
  for (const b of D.body) if (b.date === date) ev.push({k: 'body', g: '○', c: 'var(--muted)', t: 'Body log', s: [b.weight && b.weight + ' kg', b.waist && b.waist + ' cm waist'].filter(Boolean).join(' · ')});
  return ev;
}

// ------------------------------------------------------------------ views
const V = {};

V.today = () => {
  const p = currentPeriod(), st = p && periodStats(p), s = safeToSpend(p), isMon = dowi(TODAY) === 0;
  const ws = monday(TODAY), days = [...Array(7)].map((_, i) => addDays(ws, i));
  const lead = Math.max(7, +D.settings.reminderDays || 7);
  // tiles
  let tiles;
  if (!p) tiles = `<div class="card stat hero" style="grid-column:1/-1"><div class="lbl">Start here</div><div class="val" style="font-size:20px">Add your paycheck to unlock budgets</div><div class="sub">Your split is ${D.settings.split.needs}/${D.settings.split.wants}/${D.settings.split.savings}. <a class="acc" onclick="A.paycheck()" style="cursor:pointer">Enter paycheck →</a></div></div>`;
  else if (!s) tiles = `<div class="card stat hero" style="grid-column:1/-1"><div class="lbl">Budget period ended ${fd(p.end)}</div><div class="val">${eur(st.leftover)} left over</div><div class="sub">Enter this month's paycheck to start the next period. <a class="acc" onclick="A.paycheck()" style="cursor:pointer">Enter paycheck →</a></div></div>`;
  else {
    const wkPct = s.weekAllow > 0 ? Math.max(0, s.weekLeft) / s.weekAllow * 100 : 0;
    tiles = `
    <div class="card stat hero"><div class="lbl">Safe to spend today</div><div class="val ${s.todayLeft < 0 ? 'bad' : ''}">${eur(s.todayLeft)}</div>
      <div class="sub">${s.spentToday ? `spent ${eur(s.spentToday)} of ${eur(s.todayAllow)}` : `of ${eur(s.todayAllow)} · wants only`}</div>
      <div class="meter"><i style="width:${s.todayAllow > 0 ? Math.max(0, Math.min(100, s.todayLeft / s.todayAllow * 100)) : 0}%;background:var(--accent)"></i></div></div>
    <div class="card stat"><div class="lbl">Left this week</div><div class="val ${s.weekLeft < 0 ? 'bad' : ''}">${eur(s.weekLeft)}</div>
      <div class="sub">of ${eur(s.weekAllow)} · ${s.daysLeft} day${s.daysLeft > 1 ? 's' : ''} left (to ${DOW[dowi(s.weekEnd)]})</div>
      <div class="meter"><i style="width:${wkPct}%;background:var(--wants)"></i></div></div>
    <div class="card stat"><div class="lbl">Needs left</div><div class="val">${eur(st.needsLeft - st.committed)}</div>
      <div class="sub">after ${eur(st.committed)} bills still due</div>
      <div class="meter"><i style="width:${Math.max(0, Math.min(100, (st.needsLeft - st.committed) / p.budget.needs * 100))}%;background:var(--needs)"></i></div></div>
    <div class="card stat"><div class="lbl">Savings</div><div class="val">${eur0(savingsBalance())}</div>
      <div class="sub">next payday ~${fdl(p.nextPay)} (${diff(TODAY, p.nextPay)}d)</div>
      <div class="meter"><i style="width:${Math.min(100, diff(p.start, TODAY) / (diff(p.start, p.end) + 1) * 100)}%;background:var(--savings)"></i></div></div>`;
  }
  // week strip & briefing
  const weekEv = days.map(d => ({d, ev: eventsOn(d).filter(e => e.k !== 'body')}));
  const billsWk = billOccurrences(ws, addDays(ws, 6)).filter(o => !o.paid);
  const bdaysWk = weekEv.flatMap(x => x.ev.filter(e => e.k === 'bday'));
  const tasksWk = D.tasks.filter(t => !t.done && t.due && t.due <= addDays(ws, 6));
  const lastWk = D.workouts.filter(w => w.date.slice(0, 10) >= addDays(ws, -7) && w.date.slice(0, 10) < ws).length;
  const thisWk = D.workouts.filter(w => w.date.slice(0, 10) >= ws && w.date.slice(0, 10) <= addDays(ws, 6)).length;
  const strip = `<div class="week">${weekEv.map(({d, ev}) => {
    const spend = sum(ev.filter(e => e.k === 'spend'), e => e.amt);
    const shown = ev.filter(e => e.k !== 'spend');
    return `<div class="wd ${d === TODAY ? 'today' : d < TODAY ? 'past' : ''}"><div class="h"><span>${DOW[dowi(d)].toUpperCase()}</span><b>${pd(d).getDate()}</b></div>
      ${shown.slice(0, 5).map(e => `<div class="ev" data-tip="${esc(e.t + (e.s ? '\n' + e.s : ''))}"><span class="g" style="color:${e.c}">${e.g}</span><span class="t" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.t)}</span></div>`).join('')}
      ${shown.length > 5 ? `<div class="faint">+${shown.length - 5} more</div>` : ''}
      ${spend ? `<div class="ev"><span class="g muted">€</span><span class="muted">${eur(spend)} spent</span></div>` : ''}
      ${!shown.length && !spend ? '<div class="faint">—</div>' : ''}</div>`; }).join('')}</div>`;
  const briefing = `<div class="card ${isMon ? 'briefing' : ''}"><h3><span>${isMon ? '▸ Monday briefing — your week' : 'This week'} · ${fd(ws)} – ${fd(addDays(ws, 6))}</span><span class="act faint small">${isMon ? 'shown every Monday' : ''}</span></h3>
    <div class="kv">
      <div><div class="k">Wants budget</div><div class="v">${s ? eur(s.weekAllow) : '—'}</div></div>
      <div><div class="k">Bills due</div><div class="v">${eur(sum(billsWk, o => o.r.amount))}</div><div class="small muted">${billsWk.length} unpaid</div></div>
      <div><div class="k">Birthdays</div><div class="v">${bdaysWk.length}</div><div class="small muted">${esc(bdaysWk.map(b => b.t.replace("'s birthday", '')).join(', ') || 'none')}</div></div>
      <div><div class="k">Tasks</div><div class="v">${tasksWk.length}</div><div class="small muted">${tasksWk.filter(t => t.due < TODAY).length} overdue</div></div>
      <div><div class="k">Workouts</div><div class="v">${thisWk}<span class="muted small"> / last wk ${lastWk}</span></div></div>
    </div>${strip}</div>`;
  // upcoming (reminders window)
  const up = [];
  for (const pp of D.people) { const nb = nextBirthday(pp.birthday); if (nb && diff(TODAY, nb) <= Math.max(lead, 14)) up.push({d: nb, g: '✦', c: 'var(--extra)', t: `${pp.name}'s birthday`, s: pp.gifts ? 'gift ideas: ' + pp.gifts : ''}); }
  for (const o of billOccurrences(TODAY, addDays(TODAY, Math.max(lead, 14)))) if (!o.paid) up.push({d: o.date, g: '▲', c: 'var(--warn)', t: `${o.r.name}`, s: eur(o.r.amount), bill: o});
  for (const t of D.tasks) if (!t.done && t.due && t.due <= addDays(TODAY, 14)) up.push({d: t.due, g: '□', c: t.due < TODAY ? 'var(--bad)' : 'var(--text)', t: t.title, s: t.due < TODAY ? 'overdue' : '', task: t});
  up.sort((a, b) => a.d < b.d ? -1 : 1);
  const upcoming = `<div class="card"><h3>Upcoming · next 14 days <span class="act faint">reminders ${lead}d ahead</span></h3><div class="list">${up.length ? up.map(u => {
    const dd = diff(TODAY, u.d), when = dd < 0 ? `${-dd}d ago` : dd === 0 ? 'today' : dd === 1 ? 'tomorrow' : `in ${dd}d`;
    return `<div class="li"><span style="color:${u.c};width:14px">${u.g}</span><span class="t">${esc(u.t)} <span class="muted small">${esc(u.s)}</span></span>
      ${u.bill ? `<button class="btn sm" onclick="A.payBill('${u.bill.r.id}','${u.bill.ym}')">Mark paid</button>` : ''}${u.task ? `<button class="btn sm" onclick="A.toggleTask('${u.task.id}')">Done</button>` : ''}
      <span class="small ${dd <= lead && dd >= 0 ? 'acc' : 'muted'}" style="width:74px;text-align:right">${when}</span></div>`; }).join('') : '<div class="empty">Nothing coming up</div>'}</div></div>`;
  // side: bucket bars + body
  const buckets = p ? `<div class="card"><h3>This pay period <span class="act faint small">${fd(p.start)} – ${fd(p.end)}</span></h3>${hbars(['needs', 'wants', 'savings'].map(k => ({label: k[0].toUpperCase() + k.slice(1), value: k === 'savings' ? p.budget.savings : st.spent[k], max: p.budget[k], color: PAL[k],
      right: k === 'savings' ? `${eur(p.budget.savings)} saved` : `${eur(st.spent[k])} / ${eur(p.budget[k])}`, tip: k === 'savings' ? 'Moved to savings on payday' : `${k}: ${eur(st.spent[k])} spent, ${eur(p.budget[k] - st.spent[k])} left`})))}</div>` : '';
  const bw = D.body.filter(b => b.weight).map(b => ({x: b.date, y: +b.weight})).filter(p => p.x >= addDays(TODAY, -90));
  const body = `<div class="card"><h3>Weight · 90 days <span class="act"><button class="btn sm" onclick="A.bodyLog()">+ Log</button></span></h3>${bw.length ? lineChart([{points: bw, color: 'var(--accent)'}], {h: 190, W: 440, fmt: v => v.toFixed(1), band: goalBand(), unit: ' kg'}) : '<div class="empty">Log your weight to see the trend</div>'}</div>`;
  return `<div class="grid g4">${tiles}</div><div class="mt">${briefing}</div><div class="grid g21 mt">${upcoming}<div class="grid">${buckets}${body}</div></div>`;
};

// ---------------- money
V.money = () => {
  const tabs = [['overview', 'Overview'], ['tx', 'Transactions'], ['bills', 'Bills & subscriptions'], ['wish', 'Wishlist'], ['savings', 'Savings & goals']];
  return `<div class="row"><div class="tabs" style="flex:1">${tabs.map(([k, l]) => `<a class="${UI.moneyTab === k ? 'on' : ''}" onclick="UI.moneyTab='${k}';render()">${l}</a>`).join('')}</div>
    <div class="row" style="margin-bottom:18px"><button class="btn" onclick="A.paycheck()">+ Paycheck</button><button class="btn pri" onclick="A.expense()">+ Expense</button></div></div>` + V['money_' + UI.moneyTab]();
};
V.money_overview = () => {
  const p = currentPeriod();
  if (!p) return `<div class="card"><div class="empty">No paycheck yet. Click <b class="acc">+ Paycheck</b>, enter the amount and approve the split — everything else builds on it.</div></div>`;
  const st = periodStats(p), sp = p.pc.split;
  const split = `<div class="card"><h3>Split · ${eur(p.pc.amount)} paid ${fd(p.start)}</h3><div class="row" style="gap:24px;align-items:center">
    ${donut([{label: 'Needs', value: p.raw.needs, color: PAL.needs}, {label: 'Wants', value: p.raw.wants, color: PAL.wants}, {label: 'Savings', value: p.raw.savings, color: PAL.savings}], `${sp.needs}/${sp.wants}/${sp.savings}`, 'SPLIT')}
    <div class="list" style="flex:1">${['needs', 'wants', 'savings'].map(k => `<div class="li"><i class="dot" style="background:${PAL[k]}"></i><span class="t">${k[0].toUpperCase() + k.slice(1)} <span class="muted small">${sp[k]}%</span></span><span>${eur(p.raw[k])}</span></div>`).join('')}</div></div></div>`;
  const left = `<div class="card"><h3>Left in this period <span class="act faint small">${fd(p.start)} – ${fd(p.end)}${p.estimated ? ' (est.)' : ''}</span></h3>
    ${hbars([{label: 'Needs', value: st.spent.needs, max: p.budget.needs, color: PAL.needs, right: `${eur(st.spent.needs)} spent · ${eur(st.needsLeft)} left`},
      {label: 'Needs — bills still due', value: st.committed, max: p.budget.needs, color: 'var(--warn)', right: eur(st.committed)},
      {label: 'Wants', value: st.spent.wants, max: p.budget.wants, color: PAL.wants, right: `${eur(st.spent.wants)} spent · ${eur(st.wantsLeft)} left`}])}
    <div class="row mt" style="padding-top:12px;border-top:1px solid var(--line)"><div><div class="small muted">Projected leftover → savings</div><div class="big ${st.leftover < 0 ? 'bad' : 'acc'}">${eur(st.leftover)}</div></div><span class="sp"></span>
      ${p.pc.leftoverMoved ? `<span class="small muted">✓ ${eur(p.pc.leftoverMoved)} moved</span>` : `<button class="btn ${diff(TODAY, p.end) <= 3 ? 'pri' : ''}" onclick="A.moveLeftover()" ${st.leftover <= 0 ? 'disabled' : ''}>Move to savings</button>`}</div></div>`;
  const cats = {}; for (const t of st.tx) cats[t.category] = (cats[t.category] || 0) + t.amount;
  const catRows = Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([c, v]) => ({label: c, value: v, color: PAL[catBucket(c)], right: eur(v)}));
  const catsCard = `<div class="card"><h3>Spending by category · this period</h3>${catRows.length ? hbars(catRows) : '<div class="empty">No spending yet</div>'}<div class="mt">${legend([[PAL.needs, 'needs'], [PAL.wants, 'wants'], [PAL.savings, 'savings']])}</div></div>`;
  // last 6 months spending
  const months = [...Array(6)].map((_, i) => { const d = pd(TODAY.slice(0, 8) + '01'); d.setMonth(d.getMonth() - 5 + i); return iso(d).slice(0, 7); });
  const mdata = months.map(m => { const v = sum(D.transactions.filter(t => t.date.startsWith(m)), t => t.amount); return {label: MON[+m.slice(5) - 1], value: v, tip: `${MON[+m.slice(5) - 1]} ${m.slice(0, 4)}\n${eur(v)} spent`}; });
  const monthly = `<div class="card"><h3>Spending per month</h3>${columns(mdata, {fmt: v => '€' + Math.round(v)})}</div>`;
  return `<div class="grid g2">${split}${left}</div><div class="grid g2 mt">${catsCard}${monthly}</div>`;
};
V.money_tx = () => {
  const p = currentPeriod();
  let tx = [...D.transactions];
  if (UI.txFilter === 'period' && p) tx = tx.filter(t => t.date >= p.start && t.date <= p.end);
  if (UI.txFilter === 'savings') tx = tx.filter(t => t.source === 'savings');
  tx.sort((a, b) => a.date < b.date ? 1 : -1);
  return `<div class="card"><h3><span class="seg">${[['period', 'This period'], ['all', 'All'], ['savings', 'From savings']].map(([k, l]) => `<button class="${UI.txFilter === k ? 'on' : ''}" onclick="UI.txFilter='${k}';render()">${l}</button>`).join('')}</span><span class="act muted">${tx.length} · ${eur(sum(tx, t => t.amount))}</span></h3>
  ${tx.length ? `<table><tr><th>Date</th><th>Category</th><th>Note</th><th>Bucket</th><th>Paid from</th><th class="n">Amount</th><th></th></tr>${tx.map(t => `<tr><td class="muted">${fdl(t.date)}</td><td>${esc(t.category)}</td><td class="muted">${esc(t.note || '')}</td><td><span class="tag ${t.bucket}">${t.bucket}</span></td><td class="${t.source === 'savings' ? 'warn' : 'muted'}">${t.source === 'savings' ? 'savings' : 'salary'}</td><td class="n">${eur(t.amount)}</td><td class="n"><button class="btn sm ghost" onclick="A.expense('${t.id}')">edit</button></td></tr>`).join('')}</table>` : '<div class="empty">No transactions</div>'}</div>`;
};
V.money_bills = () => {
  const from = TODAY, to = addDays(TODAY, 45), occ = billOccurrences(addDays(TODAY.slice(0, 8) + '01', 0), to);
  const monthly = sum(D.recurring.filter(r => r.active !== false), r => r.amount);
  const subs = D.recurring.filter(r => r.type === 'subscription' && r.active !== false), bills = D.recurring.filter(r => r.type !== 'subscription' && r.active !== false);
  const tl = `<div class="card"><h3>Timeline · this month → +45 days</h3><div class="list">${occ.length ? occ.map(o => `<div class="li"><span class="muted" style="width:96px">${fdl(o.date)}</span><span style="color:${o.paid ? 'var(--muted)' : o.date < TODAY ? 'var(--bad)' : 'var(--warn)'}">${o.paid ? '✓' : '▲'}</span><span class="t">${esc(o.r.name)} <span class="tag">${o.r.type}</span></span><span>${eur(o.r.amount)}</span>
    ${o.paid ? '<span class="small muted" style="width:76px;text-align:right">paid</span>' : `<button class="btn sm" style="width:76px" onclick="A.payBill('${o.r.id}','${o.ym}')">Mark paid</button>`}</div>`).join('') : '<div class="empty">Add bills and subscriptions to see what is coming</div>'}</div></div>`;
  const by = (list, label) => `<div class="card"><h3>${label} <span class="act muted">${eur(sum(list, r => r.amount))}/mo</span></h3><div class="list">${list.length ? list.sort((a, b) => a.day - b.day).map(r => `<div class="li"><span class="muted" style="width:60px">day ${r.day}</span><span class="t">${esc(r.name)}</span><span>${eur(r.amount)}</span><button class="btn sm ghost" onclick="A.recurring('${r.id}')">edit</button></div>`).join('') : '<div class="empty">None yet</div>'}</div></div>`;
  const pie = `<div class="card"><h3>Fixed costs per month</h3><div class="row" style="gap:20px">${donut([{label: 'Bills', value: sum(bills, r => r.amount), color: PAL.needs}, {label: 'Subscriptions', value: sum(subs, r => r.amount), color: PAL.extra}], eur0(monthly), 'PER MONTH', 150)}
    <div>${legend([[PAL.needs, 'Bills ' + eur(sum(bills, r => r.amount))], [PAL.extra, 'Subscriptions ' + eur(sum(subs, r => r.amount))]])}<div class="small muted mt">${eur(monthly * 12, 0)} per year</div>
    <button class="btn pri mt" onclick="A.recurring()">+ Bill / subscription</button></div></div></div>`;
  return `<div class="grid g21">${tl}<div class="grid">${pie}${by(bills, 'Bills')}${by(subs, 'Subscriptions')}</div></div>`;
};
V.money_wish = () => {
  const p = currentPeriod(), st = p && periodStats(p), s = safeToSpend(p), bal = savingsBalance();
  const f = UI.wishFilter || 'all', sort = UI.wishSort || 'added';
  let items = D.wishlist.filter(w => !w.bought && (f === 'all' || w.bucket === f));
  const sorters = {added: (a, b) => (a.added || '') < (b.added || '') ? 1 : -1, price: (a, b) => a.price - b.price, priceDesc: (a, b) => b.price - a.price, name: (a, b) => a.name.localeCompare(b.name)};
  items.sort(sorters[sort]);
  const bought = D.wishlist.filter(w => w.bought).sort((a, b) => (a.boughtAt || '') < (b.boughtAt || '') ? 1 : -1);
  const left = {needs: st ? st.needsLeft - st.committed : 0, wants: st ? st.wantsLeft : 0};
  const fit = w => {
    if (w.bucket === 'wants' && s && w.price <= s.weekLeft) return ['good', 'fits this week'];
    if (st && w.price <= left[w.bucket]) return ['acc', `fits ${w.bucket} this month`];
    if (w.price <= bal) return ['warn', 'savings only'];
    return ['bad', 'not yet'];
  };
  const linkOf = w => /^https?:\/\//i.test(w.link || '') ? `<a class="acc small" href="${esc(w.link)}" target="_blank" rel="noopener">store ↗</a>` : '';
  const row = w => { const [c, t] = fit(w); return `<div class="li wrow"><input type="checkbox" onchange="A.wishBuy('${w.id}')" title="Mark as bought">
    <span class="t">${esc(w.name)} ${linkOf(w)}${w.note ? ` <span class="muted small">— ${esc(w.note)}</span>` : ''}</span>
    <span class="tag ${w.bucket}">${w.bucket}</span><span class="small fit ${c}" style="width:150px;text-align:right">${t}</span><span style="width:96px;text-align:right">${eur(w.price)}</span><button class="btn sm ghost" onclick="A.wish('${w.id}')">edit</button></div>`; };
  const tot = b => sum(D.wishlist.filter(w => !w.bought && w.bucket === b), w => w.price);
  return `<div class="grid g4"><div class="card stat"><div class="lbl">Needs on list</div><div class="val">${eur0(tot('needs'))}</div><div class="sub">${eur(left.needs)} needs left this month</div></div>
    <div class="card stat"><div class="lbl">Wants on list</div><div class="val">${eur0(tot('wants'))}</div><div class="sub">${eur(left.wants)} wants left · ${s ? eur(s.weekLeft) : '—'} this week</div></div>
    <div class="card stat"><div class="lbl">Savings</div><div class="val">${eur0(bal)}</div><div class="sub">if paid from savings</div></div>
    <div class="card stat"><div class="lbl">Bought</div><div class="val">${bought.length}</div><div class="sub">${eur0(sum(bought, w => w.paid || w.price))} spent from this list</div></div></div>
  <div class="card mt"><h3><span class="row"><span class="seg">${[['all', 'All'], ['needs', 'Needs'], ['wants', 'Wants']].map(([k, l]) => `<button class="${f === k ? 'on' : ''}" onclick="UI.wishFilter='${k}';render()">${l}</button>`).join('')}</span>
      <select onchange="UI.wishSort=this.value;render()">${[['added', 'Newest first'], ['price', 'Cheapest first'], ['priceDesc', 'Most expensive first'], ['name', 'A–Z']].map(([k, l]) => `<option value="${k}" ${sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></span>
      <span class="act"><button class="btn pri sm" onclick="A.wish()">+ Add item</button></span></h3>
    <div class="list">${items.map(row).join('') || '<div class="empty">Nothing on the list. Add things you want or need to buy.</div>'}</div>
    <div class="small faint mt">Tick an item when you buy it — you choose salary or savings, and it's taken from the right budget.</div></div>
  ${bought.length ? `<div class="card mt"><h3>Bought</h3><div class="list">${bought.slice(0, 20).map(w => `<div class="li"><input type="checkbox" checked onchange="A.wishUnbuy('${w.id}')" title="Undo purchase"><span class="t faint" style="text-decoration:line-through">${esc(w.name)}</span><span class="tag ${w.bucket}">${w.bucket}</span><span class="small muted">${fd(w.boughtAt)} · ${w.source === 'savings' ? 'from savings' : 'from salary'}</span><span style="width:96px;text-align:right" class="muted">${eur(w.paid ?? w.price)}</span></div>`).join('')}</div></div>` : ''}`;
};
V.money_savings = () => {
  const bal = savingsBalance(), allocated = sum(D.goals, g => g.saved);
  const evDates = [...new Set([...D.savingsMoves.map(m => m.date), ...D.transactions.filter(t => t.source === 'savings').map(t => t.date)])].sort();
  const pts = evDates.map(d => ({x: d, y: savingsBalance(d)}));
  const hist = [...D.savingsMoves.map(m => ({d: m.date, t: m.kind === 'withdraw' ? 'Withdrawal' : (m.note || 'Deposit'), a: m.kind === 'withdraw' ? -m.amount : m.amount})),
    ...D.transactions.filter(t => t.source === 'savings').map(t => ({d: t.date, t: `${t.category}${t.note ? ' · ' + t.note : ''}`, a: -t.amount}))].sort((a, b) => a.d < b.d ? 1 : -1);
  const invested = sum(D.transactions.filter(t => t.category === 'Investing'), t => t.amount);
  return `<div class="grid g4"><div class="card stat hero"><div class="lbl">Savings balance</div><div class="val">${eur(bal)}</div><div class="sub">${eur(bal - allocated)} not assigned to goals</div></div>
    <div class="card stat"><div class="lbl">Invested (all time)</div><div class="val">${eur0(invested)}</div><div class="sub">category "Investing"</div></div>
    <div class="card stat"><div class="lbl">Added this year</div><div class="val">${eur0(sum(D.savingsMoves.filter(m => m.date.startsWith(TODAY.slice(0, 4)) && m.kind !== 'withdraw'), m => m.amount))}</div><div class="sub">from paychecks + leftovers</div></div>
    <div class="card stat"><div class="lbl">Manual</div><div class="row mt"><button class="btn sm" onclick="A.saveMove('deposit')">+ Deposit</button><button class="btn sm" onclick="A.saveMove('withdraw')">− Withdraw</button></div></div></div>
    <div class="grid g21 mt"><div class="card"><h3>Balance over time</h3>${pts.length ? lineChart([{points: pts, color: 'var(--savings)'}], {fmt: v => '€' + Math.round(v)}) : '<div class="empty">No savings activity yet</div>'}</div>
    <div class="card"><h3>Goals <span class="act"><button class="btn sm" onclick="A.goal()">+ Goal</button></span></h3>${D.goals.length ? D.goals.map(g => `<div style="margin:10px 0" data-tip="${esc(g.name)}\n${eur(g.saved)} of ${eur(g.target)}">
      <div class="row small"><span>${esc(g.name)}</span><span class="sp"></span><span class="muted">${eur0(g.saved)} / ${eur0(g.target)}</span></div>
      <div class="meter" style="height:8px"><i style="width:${Math.min(100, g.saved / g.target * 100)}%;background:var(--savings)"></i></div>
      <div class="row small mt" style="margin-top:6px"><span class="muted">${Math.round(g.saved / g.target * 100)}%</span><span class="sp"></span><button class="btn sm ghost" onclick="A.goalAdd('${g.id}')">+ assign</button><button class="btn sm ghost" onclick="A.goal('${g.id}')">edit</button></div></div>`).join('') : '<div class="empty">e.g. new PC, holiday, emergency fund</div>'}</div></div>
    <div class="card mt"><h3>History</h3><table>${hist.slice(0, 40).map(h => `<tr><td class="muted" style="width:120px">${fdl(h.d)}</td><td>${esc(h.t)}</td><td class="n ${h.a < 0 ? 'bad' : 'good'}">${h.a < 0 ? '' : '+'}${eur(h.a)}</td></tr>`).join('') || '<tr><td class="empty">Nothing yet</td></tr>'}</table></div>`;
};

// ---------------- gym
V.gym = () => {
  const tabs = [['overview', 'Overview'], ['progress', 'Exercises'], ['body', 'Body'], ['history', 'History'], ['import', 'Import']];
  return `<div class="row"><div class="tabs" style="flex:1">${tabs.map(([k, l]) => `<a class="${UI.gymTab === k ? 'on' : ''}" onclick="UI.gymTab='${k}';render()">${l}</a>`).join('')}</div>
    <div class="row" style="margin-bottom:18px"><button class="btn" onclick="A.bodyLog()">+ Weight / waist</button><button class="btn pri" onclick="UI.gymTab='import';render()">Import workout</button></div></div>` + V['gym_' + UI.gymTab]();
};
V.gym_overview = () => {
  const ws = workoutsSorted(), m0 = TODAY.slice(0, 7);
  const thisMonth = ws.filter(w => w.date.startsWith(m0));
  const weeks = [...Array(12)].map((_, i) => addDays(monday(TODAY), -7 * (11 - i)));
  const wk = weeks.map(s => { const l = ws.filter(w => w.date.slice(0, 10) >= s && w.date.slice(0, 10) <= addDays(s, 6)); return {label: fd(s).slice(0, 6), value: l.length, vol: sum(l, wVol), tip: `Week of ${fd(s)}\n${l.length} workouts · ${Math.round(sum(l, wVol)).toLocaleString()} kg volume`}; });
  let streak = 0; for (let i = wk.length - 1; i >= 0; i--) { if (wk[i].value > 0) streak++; else if (i !== wk.length - 1) break; }
  const from28 = addDays(TODAY, -27), sets = {};
  for (const w of ws.filter(w => w.date.slice(0, 10) >= from28)) for (const e of w.exercises) { const g = muscleOf(e.name); sets[g] = (sets[g] || 0) + e.sets.filter(s => !s.warm).length; }
  const groups = ['Chest', 'Back', 'Shoulders', 'Legs', 'Biceps', 'Triceps', 'Core'];
  const musc = hbars(groups.map(g => ({label: g, value: (sets[g] || 0) / 4, color: (sets[g] || 0) / 4 >= 10 ? 'var(--accent)' : (sets[g] || 0) / 4 >= 6 ? 'var(--wants)' : '#3a3a44', right: `${((sets[g] || 0) / 4).toFixed(1)} sets/wk`, tip: `${g}: ${sets[g] || 0} hard sets in 28 days`})), {ref: 10});
  const vols = ws.slice(-20).map(w => ({x: w.date.slice(0, 10), y: wVol(w)}));
  const bw = D.body.filter(b => b.weight).sort((a, b) => a.date < b.date ? -1 : 1), lastW = bw[bw.length - 1];
  return `<div class="grid g4">
    <div class="card stat hero"><div class="lbl">Workouts this month</div><div class="val">${thisMonth.length}</div><div class="sub">${ws.length} total logged</div></div>
    <div class="card stat"><div class="lbl">Avg / week (4 wk)</div><div class="val">${(ws.filter(w => w.date.slice(0, 10) >= from28).length / 4).toFixed(1)}</div><div class="sub">streak: ${streak} week${streak === 1 ? '' : 's'}</div></div>
    <div class="card stat"><div class="lbl">Volume this month</div><div class="val">${Math.round(sum(thisMonth, wVol) / 1000 * 10) / 10}t</div><div class="sub">weight × reps, all sets</div></div>
    <div class="card stat"><div class="lbl">Bodyweight</div><div class="val">${lastW ? lastW.weight + ' kg' : '—'}</div><div class="sub">${goalBand() ? `goal ${D.settings.gymGoal.weightMin}–${D.settings.gymGoal.weightMax} kg` : 'set a goal in Settings'}${goalBand() && lastW ? ` · ${Math.max(0, lastW.weight - D.settings.gymGoal.weightMax).toFixed(1)} to go` : ''}</div></div></div>
    <div class="grid g21 mt"><div class="card"><h3>Workouts per week · 12 weeks</h3>${columns(wk, {ref: 3, h: 180})}</div>
      <div class="card"><h3>Sets per muscle / week <span class="act faint small">28 days · line = 10</span></h3>${musc}</div></div>
    <div class="grid g2 mt"><div class="card"><h3>Session volume</h3>${lineChart([{points: vols, color: 'var(--accent)'}], {h: 170, fmt: v => Math.round(v).toLocaleString(), unit: ' kg'})}</div>
      <div class="card"><h3>Where to improve</h3>${gymInsights().map(i => `<div class="insight"><span class="ic ${i.c || 'muted'}">${i.ic}</span><span>${esc(i.t)}</span></div>`).join('')}</div></div>`;
};
V.gym_progress = () => {
  const names = Object.entries(D.workouts.flatMap(w => w.exercises.map(e => e.name)).reduce((m, n) => (m[n] = (m[n] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]).map(x => x[0]);
  if (!names.length) return `<div class="card"><div class="empty">No exercises yet — import a workout first.</div></div>`;
  if (!names.includes(UI.gymEx)) UI.gymEx = names[0];
  const h = exerciseHistory(UI.gymEx);
  const best = h.reduce((b, x) => x.e1rm > b.e1rm ? x : b, {e1rm: 0});
  const prs = names.map(n => { const hh = exerciseHistory(n); const b = hh.reduce((b, x) => x.e1rm > b.e1rm ? x : b, {e1rm: 0, top: 0}); const first = hh[0]; return {n, b, last: hh[hh.length - 1], count: hh.length, gain: first && first.e1rm ? (b.e1rm / first.e1rm - 1) * 100 : 0}; });
  return `<div class="grid g21"><div class="card"><h3><select onchange="UI.gymEx=this.value;render()">${names.map(n => `<option ${n === UI.gymEx ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select><span class="act muted small">${esc(muscleOf(UI.gymEx))} · ${h.length} sessions</span></h3>
      ${lineChart([{name: 'Est. 1RM', points: h.map(x => ({x: x.date, y: r2(x.e1rm)})), color: 'var(--accent)'}, {name: 'Top set', points: h.map(x => ({x: x.date, y: x.top})), color: 'var(--wants)', dash: true}], {fmt: v => v.toFixed(1), unit: ' kg'})}
      <div class="row mt">${legend([['var(--accent)', 'Estimated 1-rep max'], ['var(--wants)', 'Heaviest working set']])}<span class="sp"></span><span class="small muted">best e1RM ${best.e1rm ? r2(best.e1rm) + ' kg on ' + fd(best.date) : '—'}</span></div></div>
    <div class="card"><h3>Volume per session</h3>${columns(h.slice(-10).map(x => ({label: fd(x.date).slice(0, 6), value: x.vol, tip: `${fdl(x.date)}\n${Math.round(x.vol)} kg`})), {h: 300, W: 420, color: 'var(--wants)', fmt: v => Math.round(v)})}</div></div>
    <div class="card mt"><h3>Personal records</h3><table><tr><th>Exercise</th><th>Muscle</th><th class="n">Best set</th><th class="n">Est. 1RM</th><th class="n">Change</th><th class="n">Sessions</th><th class="n">Last</th></tr>
      ${prs.map(p => `<tr style="cursor:pointer" onclick="UI.gymEx=${esc(JSON.stringify(p.n))};render()"><td>${esc(p.n)}</td><td class="muted">${muscleOf(p.n)}</td><td class="n">${p.b.top} kg × ${p.b.reps}</td><td class="n">${r2(p.b.e1rm)} kg</td><td class="n ${p.gain > 0 ? 'good' : 'muted'}">${p.count > 1 ? (p.gain > 0 ? '+' : '') + p.gain.toFixed(0) + '%' : '—'}</td><td class="n muted">${p.count}</td><td class="n muted">${fd(p.last.date)}</td></tr>`).join('')}</table></div>`;
};
V.gym_body = () => {
  const g = D.settings.gymGoal, b = [...D.body].sort((a, b) => a.date < b.date ? -1 : 1);
  const w = b.filter(x => x.weight).map(x => ({x: x.date, y: +x.weight})), wa = b.filter(x => x.waist).map(x => ({x: x.date, y: +x.waist}));
  const slope = regressionPerWeek(w.filter(p => p.x >= addDays(TODAY, -27)));
  return `<div class="grid g2"><div class="card"><h3>Weight <span class="act muted small">${slope === null ? '' : `${slope > 0 ? '+' : ''}${slope.toFixed(2)} kg/week (4 wk trend)`}</span></h3>${lineChart([{points: w, color: 'var(--accent)'}], {fmt: v => v.toFixed(1), band: goalBand(), unit: ' kg'})}</div>
    <div class="card"><h3>Waist</h3>${lineChart([{points: wa, color: 'var(--extra)'}], {fmt: v => v.toFixed(1), unit: ' cm'})}</div></div>
    <div class="card mt"><h3>Log <span class="act"><button class="btn sm pri" onclick="A.bodyLog()">+ Add</button></span></h3><table><tr><th>Date</th><th class="n">Weight</th><th class="n">Waist</th><th></th></tr>
    ${[...b].reverse().map(x => `<tr><td class="muted">${fdl(x.date)}</td><td class="n">${x.weight ? x.weight + ' kg' : '—'}</td><td class="n">${x.waist ? x.waist + ' cm' : '—'}</td><td class="n"><button class="btn sm ghost danger" onclick="A.del('body','${x.id}')">×</button></td></tr>`).join('') || '<tr><td class="empty" colspan="4">Nothing logged yet</td></tr>'}</table></div>`;
};
V.gym_history = () => {
  const ws = workoutsSorted().reverse();
  return `<div class="grid g2">${ws.map(w => `<div class="card"><h3><span style="color:var(--text);text-transform:none;letter-spacing:0;font-size:13px">${esc(w.title)}</span><span class="act muted small">${fdl(w.date.slice(0, 10))} ${w.date.slice(11, 16)} ${w.link ? `· <a class="acc" href="${esc(w.link)}" target="_blank">hevy</a>` : ''} <button class="btn sm ghost danger" onclick="A.del('workouts','${w.id}')">×</button></span></h3>
    ${w.exercises.map(e => `<div class="li small"><span class="t">${esc(e.name)} <span class="faint">${muscleOf(e.name)}</span></span><span class="muted">${e.sets.map(s => s.w ? `${s.w}×${s.r}` : `${s.r}`).join('  ')}</span></div>`).join('')}
    <div class="row small muted mt"><span>${wSets(w)} sets</span><span>·</span><span>${Math.round(wVol(w)).toLocaleString()} kg volume</span></div></div>`).join('') || '<div class="card"><div class="empty">No workouts yet</div></div>'}</div>`;
};
V.gym_import = () => {
  const pv = UI.importPreview;
  return `<div class="grid g2"><div class="card"><h3>Paste Hevy export (plain text)</h3>
    <textarea id="hevyText" rows="14" placeholder="Share → Copy text in Hevy, then paste here. Several workouts at once are fine.">${esc(UI.hevyDraft || '')}</textarea>
    <div class="row mt"><button class="btn" onclick="A.hevyParse()">Preview</button><label class="btn ghost">Load .txt<input type="file" accept=".txt" hidden onchange="A.hevyFile(this)"></label><span class="sp"></span><button class="btn pri" onclick="A.hevySave()" ${pv && pv.length ? '' : 'disabled'}>Save ${pv ? pv.length : ''} workout${pv && pv.length === 1 ? '' : 's'}</button></div>
    <div class="small muted mt" style="line-height:1.8"><b class="acc">On Android:</b> in Hevy tap <i>Share → Oracle 2</i> and the workout lands here automatically.<br><b class="acc">Anywhere:</b> in Hevy tap <i>Share → Copy</i>, then paste above. Several workouts at once are fine.</div></div>
    <div class="card"><h3>Preview</h3>${pv ? (pv.length ? pv.map(w => `<div style="margin-bottom:14px"><div class="acc">${esc(w.title)} <span class="muted small">${fdl(w.date.slice(0, 10))} ${w.date.slice(11)}</span></div>${w.exercises.map(e => `<div class="li small"><span class="t">${esc(e.name)} <span class="faint">→ ${muscleOf(e.name)}</span></span><span class="muted">${e.sets.map(s => `${s.w}×${s.r}`).join('  ')}</span></div>`).join('')}</div>`).join('') : '<div class="empty bad">Couldn\'t find any sets in that text.</div>') : '<div class="empty">Paste a workout and press Preview</div>'}</div></div>`;
};

// ---------------- records
V.records = () => {
  const tabs = [['people', 'People & birthdays'], ['tasks', 'Tasks & notes']];
  const q = UI.search.toLowerCase();
  let body;
  if (UI.recTab === 'people') {
    const ppl = D.people.filter(p => !q || JSON.stringify(p).toLowerCase().includes(q)).map(p => ({p, nb: nextBirthday(p.birthday)})).sort((a, b) => (a.nb || '9') < (b.nb || '9') ? -1 : 1);
    body = `<div class="grid g3">${ppl.map(({p, nb}) => { const dd = nb ? diff(TODAY, nb) : null, by = birthYear(p.birthday);
      return `<div class="card"><h3><span style="color:var(--text);font-size:14px;text-transform:none;letter-spacing:0">${esc(p.name)}</span><span class="act"><button class="btn sm ghost" onclick="A.person('${p.id}')">edit</button></span></h3>
      <div class="small muted">${esc(p.relation || '')}</div>
      ${nb ? `<div class="row mt"><span style="color:var(--extra)">✦</span><span>${fd(nb)}${by ? ` · turns ${+nb.slice(0, 4) - by}` : ''}</span><span class="sp"></span><span class="small ${dd <= Math.max(7, D.settings.reminderDays) ? 'acc' : 'muted'}">${dd === 0 ? 'today!' : `in ${dd}d`}</span></div>` : '<div class="faint small mt">no birthday set</div>'}
      ${p.gifts ? `<div class="small mt"><span class="muted">Gift ideas:</span> ${esc(p.gifts)}</div>` : ''}${p.notes ? `<div class="small muted mt">${esc(p.notes)}</div>` : ''}</div>`; }).join('') || '<div class="card"><div class="empty">No one added yet</div></div>'}</div>`;
  } else {
    const ts = D.tasks.filter(t => !q || JSON.stringify(t).toLowerCase().includes(q));
    const open = ts.filter(t => !t.done).sort((a, b) => (a.due || '9') < (b.due || '9') ? -1 : 1), done = ts.filter(t => t.done).sort((a, b) => (a.doneAt || '') < (b.doneAt || '') ? 1 : -1);
    const row = t => `<div class="li"><input type="checkbox" ${t.done ? 'checked' : ''} onchange="A.toggleTask('${t.id}')"><span class="t ${t.done ? 'faint' : ''}" style="${t.done ? 'text-decoration:line-through' : ''}">${esc(t.title)}${t.notes ? ` <span class="muted small">— ${esc(t.notes)}</span>` : ''}</span>
      ${t.due ? `<span class="small ${!t.done && t.due < TODAY ? 'bad' : 'muted'}">${fdl(t.due)}</span>` : '<span class="tag">note</span>'}<button class="btn sm ghost" onclick="A.task('${t.id}')">edit</button></div>`;
    body = `<div class="grid g21"><div class="card"><h3>Open · ${open.length}</h3><div class="list">${open.map(row).join('') || '<div class="empty">All clear</div>'}</div></div>
      <div class="card"><h3>Done · ${done.length}</h3><div class="list">${done.slice(0, 15).map(row).join('') || '<div class="empty">—</div>'}</div></div></div>`;
  }
  return `<div class="row"><div class="tabs" style="flex:1">${tabs.map(([k, l]) => `<a class="${UI.recTab === k ? 'on' : ''}" onclick="UI.recTab='${k}';render()">${l}</a>`).join('')}</div>
    <div class="row" style="margin-bottom:18px"><input placeholder="Search…" value="${esc(UI.search)}" oninput="UI.search=this.value;clearTimeout(window._st);window._st=setTimeout(()=>{render();const i=document.querySelector('#view input');i.focus();i.setSelectionRange(99,99)},250)">
    <button class="btn pri" onclick="${UI.recTab === 'people' ? 'A.person()' : 'A.task()'}">+ ${UI.recTab === 'people' ? 'Person' : 'Task / note'}</button></div></div>${body}`;
};

// ---------------- calendar
V.calendar = () => {
  const [y, m] = UI.calMonth.split('-').map(Number), first = `${UI.calMonth}-01`, start = monday(first);
  const cells = [...Array(42)].map((_, i) => addDays(start, i)).filter((d, i) => i < 35 || d.slice(0, 7) === UI.calMonth || addDays(start, 35).slice(0, 7) === UI.calMonth);
  const mon = d => { const dt = new Date(y, m - 1 + d, 1); UI.calMonth = iso(dt).slice(0, 7); render(); };
  window._calMove = mon;
  const monthEv = cells.map(d => ({d, ev: eventsOn(d)}));
  const sel = eventsOn(UI.calSel);
  const mt = monthEv.filter(x => x.d.slice(0, 7) === UI.calMonth);
  const spentM = sum(mt.flatMap(x => x.ev.filter(e => e.k === 'spend')), e => e.amt), gymM = mt.filter(x => x.ev.some(e => e.k === 'gym')).length;
  return `<div class="row" style="margin-bottom:16px"><button class="btn" onclick="_calMove(-1)">‹</button><div style="font-size:18px;min-width:180px;text-align:center">${MON[m - 1]} ${y}</div><button class="btn" onclick="_calMove(1)">›</button>
      <button class="btn ghost" onclick="UI.calMonth=TODAY.slice(0,7);UI.calSel=TODAY;render()">Today</button><span class="sp"></span>
      <span class="small muted">${gymM} gym days · ${eur(spentM)} spent</span></div>
    <div class="grid" style="grid-template-columns:1fr 300px;align-items:start"><div>
      <div class="cal" style="margin-bottom:6px">${DOW.map(d => `<div class="dh">${d.toUpperCase()}</div>`).join('')}</div>
      <div class="cal">${monthEv.map(({d, ev}) => { const spend = sum(ev.filter(e => e.k === 'spend'), e => e.amt), inc = ev.filter(e => e.k === 'income');
        const items = ev.filter(e => !['spend', 'body'].includes(e.k));
        return `<div class="cd ${d.slice(0, 7) !== UI.calMonth ? 'out' : ''} ${d === TODAY ? 'today' : ''} ${d === UI.calSel ? 'sel' : ''}" onclick="UI.calSel='${d}';render()">
          <div class="row"><span class="n">${pd(d).getDate()}</span><span class="sp"></span>${ev.some(e => e.k === 'gym') ? '<span style="color:var(--accent)">◆</span>' : ''}</div>
          ${items.filter(e => e.k !== 'gym').slice(0, 3).map(e => `<div class="mk"><span style="color:${e.c}">${e.g}</span><span>${esc(e.t)}</span></div>`).join('')}
          ${spend ? `<div class="mk muted"><span>−${eur(spend).replace('−', '')}</span></div>` : ''}${inc.length ? `<div class="mk good"><span>+${eur(sum(D.paychecks.filter(p => p.date === d), p => p.amount), 0)}</span></div>` : ''}</div>`; }).join('')}</div>
      <div class="mt"><div class="legend">${[['var(--accent)', '◆', 'workout'], ['var(--warn)', '▲', 'bill due'], ['var(--muted)', '✓', 'bill paid'], ['var(--extra)', '✦', 'birthday'], ['var(--text)', '□', 'task'], ['var(--good)', '+€', 'income'], ['var(--muted)', '−€', 'spent'], ['var(--savings)', '↗', 'to savings']].map(([c, g, l]) => `<span><b style="color:${c};font-weight:400">${g}</b>${l}</span>`).join('')}</div></div></div>
    <div class="card" style="position:sticky;top:0"><h3>${fdl(UI.calSel)} ${UI.calSel.slice(0, 4)}</h3>
      ${sel.length ? sel.map(e => `<div class="li" style="align-items:flex-start"><span style="color:${e.c};width:14px">${e.g}</span><div style="flex:1;min-width:0"><div>${esc(e.t)}</div>${e.s ? `<div class="small muted">${esc(e.s)}</div>` : ''}</div></div>`).join('') : '<div class="empty">Nothing on this day</div>'}
      <div class="row wrap mt"><button class="btn sm" onclick="A.expense(null,'${UI.calSel}')">+ Expense</button><button class="btn sm" onclick="A.task(null,'${UI.calSel}')">+ Task</button></div></div></div>`;
};

// ---------------- settings
V.settings = () => {
  const s = D.settings, sp = s.split, nperm = 'Notification' in window ? Notification.permission : 'unsupported';
  const syncCard = `<div class="card"><h3>Sync between your devices <span class="act small ${UI.sync.state === 'error' ? 'bad' : 'muted'}">${SYNC ? (UI.sync.state === 'error' ? 'problem' : 'on') : 'off'}</span></h3>
    ${SYNC ? `<div class="small" style="line-height:1.8">Encrypted copy stored in a secret gist on your GitHub account.<br><span class="muted">Last sync:</span> ${SYNC.last ? ago(SYNC.last) : 'never'}${UI.sync.state === 'error' ? `<br><span class="bad">${esc(UI.sync.msg)}</span>` : ''}</div>
      <div class="row mt"><button class="btn pri" onclick="syncNow(true)">Sync now</button><button class="btn ghost" onclick="A.syncSetup()">Change token / passphrase</button><span class="sp"></span><button class="btn ghost danger" onclick="A.syncOff()">Turn off on this device</button></div>`
    : `<div class="small muted" style="line-height:1.8">Keep your phone and PC in sync. Your data is encrypted on this device with a passphrase only you know, then stored in a secret gist on <b>your own</b> GitHub account — GitHub can't read it, and no one else is involved.</div>
      <div class="row mt"><button class="btn pri" onclick="A.syncSetup()">Set up sync</button></div>`}</div>`;
  return `<div class="grid g2"><div class="card"><h3>Default income split</h3>
    <div class="formgrid" style="grid-template-columns:repeat(3,1fr)">${['needs', 'wants', 'savings'].map(k => `<label class="f">${k.toUpperCase()} %<input type="number" inputmode="numeric" min="0" max="100" id="sp_${k}" value="${sp[k]}" oninput="A.splitCheck()"></label>`).join('')}</div>
    <div class="meter" id="spBar" style="height:10px">${['needs', 'wants', 'savings'].map(k => `<i style="width:${sp[k]}%;background:${PAL[k]}"></i>`).join('')}</div><div class="row mt"><span id="spSum" class="small"></span><span class="sp"></span><button class="btn pri" id="spSave" onclick="A.splitSave()">Save split</button></div>
    <div class="small faint mt">Bills & subscriptions come out of Needs. "Safe to spend" uses Wants only.</div></div>
  <div class="card"><h3>General</h3><div class="formgrid">
    <label class="f">Remind me this many days ahead (min 7)<input type="number" inputmode="numeric" min="7" id="st_rem" value="${s.reminderDays}"></label>
    <label class="f">Savings you already have (€)<input type="number" inputmode="decimal" step="0.01" id="st_sav" value="${s.startingSavings}"></label>
    <label class="f">Goal weight min (kg, optional)<input type="number" inputmode="decimal" step="0.5" id="st_gmin" value="${s.gymGoal.weightMin || ''}"></label>
    <label class="f">Goal weight max (kg, optional)<input type="number" inputmode="decimal" step="0.5" id="st_gmax" value="${s.gymGoal.weightMax || ''}"></label></div>
    <div class="row mt">${nperm === 'granted' ? '<span class="small good">✓ Notifications on</span>' : `<button class="btn" onclick="enableNotifications()">Turn on notifications</button>`}<span class="sp"></span><button class="btn pri" onclick="A.generalSave()">Save</button></div></div></div>
  <div class="grid g2 mt">${syncCard}
  <div class="card"><h3>Data on this device</h3><div class="small muted" style="line-height:1.8">Everything is stored inside this app on this device. Nothing is sent anywhere unless you turn on sync.<br>Export a backup now and then — clearing the browser's site data would erase it.</div>
    <div class="row wrap mt"><button class="btn" onclick="A.exportData()">Export backup</button><label class="btn">Import backup<input type="file" accept=".json,application/json" hidden onchange="A.importData(this)"></label><span class="sp"></span><button class="btn ghost danger" onclick="A.wipe()">Erase all data</button></div></div></div>
  <div class="grid g2 mt"><div class="card"><h3>Spending categories <span class="act"><button class="btn sm" onclick="A.catAdd()">+ Category</button></span></h3><div class="list">${s.categories.map((c, i) => `<div class="li"><input value="${esc(c.name)}" style="flex:1" onchange="A.catEdit(${i},'name',this.value)">
      <select onchange="A.catEdit(${i},'bucket',this.value)">${['needs', 'wants', 'savings'].map(b => `<option ${c.bucket === b ? 'selected' : ''}>${b}</option>`).join('')}</select><button class="btn sm ghost danger" onclick="A.catDel(${i})">×</button></div>`).join('')}</div></div>
  <div class="card"><h3>About</h3><div class="small muted" style="line-height:1.9">Oracle 2 · version ${APP_VERSION}<br>Updates install themselves the next time you open the app — your data stays.<br><kbd>Ctrl K</kbd> quick add · <kbd>1</kbd>–<kbd>7</kbd> switch pages · <kbd>Esc</kbd> close</div>
    <div class="row wrap mt"><button class="btn" onclick="UI.view='help';render()">Open help</button><button class="btn ghost" onclick="A.checkUpdate()">Check for update</button></div></div></div>`;
};

// ---------------- help & welcome tour
const HELP = [
  ['Getting started', `<p>Oracle 2 keeps your money, gym progress, birthdays, tasks and plans in one place. Everything is stored <b>on this device</b> — nothing is uploaded unless you turn on sync.</p>
    <ol><li>Go to <b>Settings</b> and set your income split (needs / wants / savings — must add up to 100%) and how much you already have saved.</li>
    <li>When you get paid, press <b>+ Paycheck</b> (Money page), enter the amount and approve the split. Your budget runs from that payday until the next one.</li>
    <li>Add your <b>bills & subscriptions</b> once (Money → Bills & subscriptions). They repeat every month on the same day.</li>
    <li>Log spending as it happens — the quickest way is <b>Quick add</b>.</li></ol>`],
  ['Quick add', `<p>Press <kbd>Ctrl K</kbd> on a computer or the round <b>+</b> button on a phone, type one line, press Enter. The preview shows how it will be saved.</p>
    <table><tr><td><code>24.90 eating out pizza</code></td><td>expense (amount, category, note)</td></tr><tr><td><code>60 hobbies @savings</code></td><td>paid from savings instead of salary</td></tr><tr><td><code>15 food yesterday</code></td><td>for another day (also <code>fri</code>, <code>03.12</code>)</td></tr>
    <tr><td><code>task call bank fri</code></td><td>task with a due date</td></tr><tr><td><code>note gift idea: scarf</code></td><td>note without a date</td></tr><tr><td><code>bday Ivan 14.03</code></td><td>birthday (add the year to see ages: <code>14.03.1995</code>)</td></tr>
    <tr><td><code>want 89 headphones</code> / <code>need 120 boots</code></td><td>wishlist item</td></tr><tr><td><code>weight 86.4</code> · <code>waist 98</code></td><td>body log</td></tr><tr><td><code>income 2400</code> · <code>save 200</code></td><td>paycheck · deposit to savings</td></tr></table>`],
  ['Money: budget & safe to spend', `<p>Each paycheck is split by your percentages. <b>Savings</b> is moved to your savings balance straight away. <b>Needs</b> covers bills, subscriptions, food and other essentials. <b>Wants</b> is your free money.</p>
    <p><b>Safe to spend today / this week</b> only uses Wants. The money left is spread evenly across the remaining days until your next payday, week by week (Monday–Sunday). Spend less one day and later days get more; overspend and the rest of the week shrinks.</p>
    <p>Every expense is paid from <b>this month's salary</b> or from <b>savings</b>. Savings purchases don't touch your monthly budget — they lower your savings balance.</p>
    <p>Near the end of the period, Money → Overview shows the <b>leftover</b>. Press <i>Move to savings</i> to put it aside.</p>
    <p>Payday is assumed to be the last working day of the month; the real date is whatever day you enter the paycheck.</p>`],
  ['Bills, subscriptions & wishlist', `<p>Bills and subscriptions have a day of the month. They appear on the calendar and in <i>Upcoming</i>, and you're reminded ahead of time. Press <b>Mark paid</b> when paid (you can change the amount — handy for electricity).</p>
    <p>The <b>Wishlist</b> holds things you want or need to buy, with price, link and note. Each item shows whether it fits your budget this week, this month, only from savings, or not yet. Tick it when bought and choose salary or savings — it's booked to the right budget automatically.</p>`],
  ['Gym', `<p>Track workouts in Hevy as usual. To bring them in: in Hevy open the workout → <b>Share</b>. On Android pick <b>Oracle 2</b>; otherwise choose <i>Copy</i> and paste on Gym → Import. Several workouts at once are fine, and importing the same one twice just updates it.</p>
    <p>Gym shows workouts per week, sets per muscle group (aim for 10–20 hard sets a week per muscle), strength progress per exercise (estimated 1-rep max), personal records and tips under <i>Where to improve</i>. Log weight and waist regularly (morning, same conditions) to see real trends; set a goal weight in Settings.</p>`],
  ['Calendar, records & reminders', `<p>The <b>Calendar</b> shows everything per day: ◆ workouts, − spending, + income, ▲ bills due, ✓ bills paid, ✦ birthdays, □ tasks. Tap a day for the details.</p>
    <p><b>Records</b> holds people (birthday, relation, gift ideas) and tasks & notes.</p>
    <p><b>Reminders</b>: birthdays and bills at least 7 days ahead (change in Settings), the day before and on the day; a weekly summary every Monday. Turn on notifications in Settings. On Android and desktop they also arrive while the app is closed (checked a few times a day); on iPhone they show when you open the app.</p>`],
  ['Install on phone & computer', `<p><b>Android (Chrome):</b> open the app's address → menu ⋮ → <i>Add to Home screen / Install app</i>.</p>
    <p><b>iPhone (Safari):</b> open the address → Share button → <i>Add to Home Screen</i>. Notifications need iOS 16.4 or newer.</p>
    <p><b>Windows / Mac / Linux (Edge or Chrome):</b> open the address → the install icon in the address bar (or menu → <i>Apps → Install</i>). In Edge you can also tick <i>Start automatically when I sign in</i> under <code>edge://apps</code>.</p>
    <p><b>Updates</b> install themselves: the next time you open the app a banner says <i>Update ready</i>. Your data is never touched by updates.</p>`],
  ['Sync between devices', `<p>Sync keeps phone and computer identical. Your data is <b>encrypted on your device</b> with a passphrase only you know, then stored as a secret gist on your own GitHub account. GitHub only ever sees scrambled data.</p>
    <ol><li>Settings → <b>Set up sync</b> → follow the link to create a GitHub token (only the "gist" permission, no expiration).</li><li>Choose a passphrase. Use the <b>same token and passphrase on every device</b>.</li><li>Done — it syncs when you open the app, a few seconds after each change, and every few minutes.</li></ol>
    <p>If two devices change different things, both changes are kept. If the same item is edited on both, the latest edit wins. Forgetting the passphrase doesn't lose data on your devices — just set sync up again with a new passphrase and new gist.</p>`],
  ['Privacy & backups', `<p>No accounts, no tracking. If you share the app's link, other people get an empty app — your data is only on your devices (and encrypted in your gist if you use sync).</p>
    <p>Settings → <b>Export backup</b> saves everything as a file; <b>Import backup</b> restores it. Clearing your browser's site data for this app would delete its data, so keep sync on or export now and then.</p>`],
];
V.help = () => `<div class="grid g12"><div class="card help-toc" style="align-self:start"><h3>Help</h3>${HELP.map(([t], i) => `<a class="li" style="cursor:pointer" onclick="document.getElementById('h${i}').scrollIntoView({behavior:'smooth'})">${esc(t)}</a>`).join('')}
    <button class="btn mt" onclick="startTour()">Show welcome tour again</button><div class="small faint mt">Version ${APP_VERSION}</div></div>
  <div class="grid">${HELP.map(([t, h], i) => `<div class="card help" id="h${i}"><h3>${esc(t)}</h3>${h}</div>`).join('')}</div></div>`;

let TOUR = 0;
const TOUR_STEPS = [
  () => `<div class="tour-hero"><svg viewBox="0 0 32 32" width="44" height="44"><circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="16" cy="16" r="4.2" fill="var(--accent)"/><path d="M16 1v5M16 26v5M1 16h5M26 16h5" stroke="currentColor" stroke-width="2"/></svg></div>
    <h2>Welcome to Oracle 2</h2><p>Your day-to-day assistant: <b>money</b>, <b>gym progress</b>, <b>birthdays & tasks</b>, a <b>wishlist</b> and a <b>calendar</b> that shows it all.</p>
    <p class="muted">Everything stays on this device. Nothing is uploaded unless you turn on sync later.</p>`,
  () => `<h2>1 · Your money split</h2><p>Every paycheck is split three ways. Pick what suits you — it must add up to 100%.</p>
    <div class="formgrid" style="grid-template-columns:repeat(3,1fr)">${['needs', 'wants', 'savings'].map(k => `<label class="f">${k.toUpperCase()} %<input type="number" inputmode="numeric" id="tw_${k}" value="${D.settings.split[k]}" oninput="tourSplit()"></label>`).join('')}</div>
    <div class="meter" id="twBar" style="height:10px"></div><div class="small" id="twSum"></div>
    <label class="f mt">Savings you already have (€)<input type="number" inputmode="decimal" id="tw_sav" value="${D.settings.startingSavings || ''}" placeholder="0"></label>
    <p class="small muted">Needs = bills, food, essentials · Wants = free money ("safe to spend") · Savings = put aside on payday.</p>`,
  () => `<h2>2 · How you'll use it</h2><ul class="tour-list">
    <li><b>Payday:</b> Money → <i>+ Paycheck</i>, approve the split.</li>
    <li><b>Spending:</b> <span class="kbdish">+</span> button (phone) or <kbd>Ctrl K</kbd> → type <code>12.50 food lunch</code>.</li>
    <li><b>Bills & subscriptions:</b> add once, they repeat monthly with reminders.</li>
    <li><b>Today</b> shows what you can safely spend today and this week, plus what's coming up.</li>
    <li><b>Gym:</b> share workouts from Hevy into Oracle 2 for stats and tips.</li></ul>`,
  () => `<h2>3 · Last touches</h2><ul class="tour-list">
    <li><b>Install it</b> so it opens like an app — see Help → <i>Install</i>.</li>
    <li><b>Reminders</b> for birthdays and bills: <button class="btn sm" onclick="enableNotifications()">Turn on notifications</button></li>
    <li><b>Sync</b> with your other devices: Settings → <i>Set up sync</i> (optional).</li></ul>
    <p class="muted">Lost? The <b>Help</b> page explains everything and can replay this tour.</p>`,
];
function startTour() { TOUR = 0; tourShow(); }
function tourShow() {
  modal(`<div class="tour">${TOUR_STEPS[TOUR]()}<div class="row mt" style="margin-top:20px"><span class="dots">${TOUR_STEPS.map((_, i) => `<i class="${i === TOUR ? 'on' : ''}"></i>`).join('')}</span><span class="sp"></span>
    ${TOUR < TOUR_STEPS.length - 1 ? `<button class="btn ghost" onclick="tourEnd()">Skip</button>` : ''}${TOUR ? `<button class="btn ghost" onclick="tourNext(-1)">Back</button>` : ''}
    <button class="btn pri" id="twNext" onclick="tourNext(1)">${TOUR === TOUR_STEPS.length - 1 ? 'Start using Oracle 2' : 'Next'}</button></div></div>`);
  if (TOUR === 1) tourSplit();
}
function tourSplit() {
  const v = ['needs', 'wants', 'savings'].map(k => num(val('tw_' + k))), t = sum(v);
  $('#twBar').innerHTML = v.map((x, i) => `<i style="width:${x}%;background:${PAL[['needs', 'wants', 'savings'][i]]}"></i>`).join('');
  $('#twSum').innerHTML = t === 100 ? '<span class="good">✓ adds up to 100%</span>' : `<span class="bad">${t}% — must be 100%</span>`; $('#twNext').disabled = t !== 100;
}
function tourNext(d) {
  if (TOUR === 1 && d > 0) { ['needs', 'wants', 'savings'].forEach(k => D.settings.split[k] = num(val('tw_' + k))); D.settings.startingSavings = num(val('tw_sav')); }
  TOUR += d; if (TOUR >= TOUR_STEPS.length) return tourEnd(); tourShow();
}
function tourEnd() { closeModal(); if (!D.settings.onboarded) { D.settings.onboarded = true; } commit(); }

// ------------------------------------------------------------------ modals & actions
function modal(html) { $('#modalBox').innerHTML = html; $('#modal').classList.remove('hidden'); const f = $('#modalBox').querySelector('input,textarea,select'); f && setTimeout(() => f.focus(), 20); }
function closeModal() { $('#modal').classList.add('hidden'); }
const val = id => $('#' + id)?.value?.trim() ?? '';
const catOptions = sel => D.settings.categories.map(c => `<option ${c.name === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

const A = {
  paycheck(prefill) {
    const s = D.settings.split;
    modal(`<h2>Paycheck</h2><div class="formgrid"><label class="f">Amount received (€)<input type="number" step="0.01" id="pc_amt" value="${prefill || ''}" oninput="A.pcPreview()"></label><label class="f">Date<input type="date" id="pc_date" value="${TODAY}" oninput="A.pcPreview()"></label>
      ${['needs', 'wants', 'savings'].map(k => `<label class="f">${k.toUpperCase()} %<input type="number" id="pc_${k}" value="${s[k]}" oninput="A.pcPreview()"></label>`).join('')}</div>
      <div id="pc_pv" class="mt"></div><div class="row mt"><span class="sp"></span><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn pri" id="pc_ok" onclick="A.pcApprove()">Approve split</button></div>`);
    A.pcPreview();
  },
  pcPreview() {
    const amt = num(val('pc_amt')), sp = {needs: num(val('pc_needs')), wants: num(val('pc_wants')), savings: num(val('pc_savings'))}, tot = sp.needs + sp.wants + sp.savings;
    const next = val('pc_date') ? estNextPayday(val('pc_date')) : '';
    $('#pc_ok').disabled = tot !== 100 || amt <= 0;
    $('#pc_pv').innerHTML = `<div class="meter" style="height:10px">${['needs', 'wants', 'savings'].map(k => `<i style="width:${sp[k]}%;background:${PAL[k]}"></i>`).join('')}</div>
      <div class="list mt">${['needs', 'wants', 'savings'].map(k => `<div class="li"><i class="dot" style="background:${PAL[k]}"></i><span class="t">${k[0].toUpperCase() + k.slice(1)}${k === 'savings' ? ' <span class="muted small">→ added to savings now</span>' : k === 'needs' ? ' <span class="muted small">bills, food…</span>' : ' <span class="muted small">safe-to-spend money</span>'}</span><span>${eur(amt * sp[k] / 100)}</span></div>`).join('')}</div>
      <div class="small ${tot === 100 ? 'muted' : 'bad'}">${tot === 100 ? `Covers ${fd(val('pc_date') || TODAY)} until ~${next ? fd(addDays(next, -1)) : ''} (next payday est. ${next ? fdl(next) : ''})` : `Split adds up to ${tot}% — must be 100%`}</div>`;
  },
  pcApprove() {
    const amt = r2(num(val('pc_amt'))), date = val('pc_date'), split = {needs: num(val('pc_needs')), wants: num(val('pc_wants')), savings: num(val('pc_savings'))};
    const id = uid(); D.paychecks.push({id, date, amount: amt, split});
    if (split.savings) D.savingsMoves.push({id: uid(), date, amount: r2(amt * split.savings / 100), kind: 'deposit', note: 'From paycheck', paycheckId: id});
    closeModal(); toast(`Paycheck approved · ${eur(amt * split.wants / 100)} for wants`); commit();
  },
  expense(id, date) {
    const t = id ? D.transactions.find(x => x.id === id) : {date: date || TODAY, category: 'Food', source: 'salary', amount: ''};
    modal(`<h2>${id ? 'Edit' : 'New'} expense</h2><div class="formgrid"><label class="f">Amount (€)<input type="number" step="0.01" id="ex_amt" value="${t.amount}"></label><label class="f">Date<input type="date" id="ex_date" value="${t.date}"></label>
      <label class="f">Category<select id="ex_cat" onchange="$('#ex_b').value=catBucket(this.value)">${catOptions(t.category)}</select></label><label class="f">Bucket<select id="ex_b">${['needs', 'wants', 'savings'].map(b => `<option ${(t.bucket || catBucket(t.category)) === b ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
      <label class="f full">Note<input id="ex_note" value="${esc(t.note || '')}" placeholder="optional"></label>
      <div class="full"><div class="small muted" style="margin-bottom:4px">PAID FROM</div><span class="seg" id="ex_src">${['salary', 'savings'].map(s => `<button class="${t.source === s ? 'on' : ''}" onclick="this.parentNode.querySelectorAll('button').forEach(b=>b.classList.remove('on'));this.classList.add('on')">${s === 'salary' ? 'This month\'s salary' : 'Savings'}</button>`).join('')}</span></div></div>
      <div class="row mt">${id ? `<button class="btn ghost danger" onclick="A.del('transactions','${id}');closeModal()">Delete</button>` : ''}<span class="sp"></span><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn pri" onclick="A.expenseSave('${id || ''}')">Save</button></div>`);
  },
  expenseSave(id) {
    const amt = r2(num(val('ex_amt'))); if (amt <= 0) return toast('Enter an amount');
    const src = $('#ex_src button.on').textContent.startsWith('Savings') ? 'savings' : 'salary';
    const t = {id: id || uid(), amount: amt, date: val('ex_date'), category: val('ex_cat'), bucket: val('ex_b'), note: val('ex_note'), source: src};
    if (id) Object.assign(D.transactions.find(x => x.id === id), t); else D.transactions.push(t);
    closeModal(); commit();
  },
  recurring(id) {
    const r = id ? D.recurring.find(x => x.id === id) : {type: 'bill', day: 1, category: 'Bills', amount: ''};
    modal(`<h2>${id ? 'Edit' : 'New'} bill / subscription</h2><div class="formgrid"><label class="f full">Name<input id="rc_name" value="${esc(r.name || '')}" placeholder="Electricity, Netflix…"></label>
      <label class="f">Type<select id="rc_type" onchange="$('#rc_cat').value=this.value==='subscription'?'Subscriptions':'Bills'"><option value="bill" ${r.type === 'bill' ? 'selected' : ''}>Bill</option><option value="subscription" ${r.type === 'subscription' ? 'selected' : ''}>Subscription</option></select></label>
      <label class="f">Amount (€) — typical<input type="number" step="0.01" id="rc_amt" value="${r.amount}"></label><label class="f">Day of month due<input type="number" min="1" max="31" id="rc_day" value="${r.day}"></label>
      <label class="f">Category<select id="rc_cat">${catOptions(r.category)}</select></label></div>
      <div class="row mt">${id ? `<button class="btn ghost danger" onclick="A.del('recurring','${id}');closeModal()">Delete</button>` : ''}<span class="sp"></span><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn pri" onclick="A.recurringSave('${id || ''}')">Save</button></div>`);
  },
  recurringSave(id) {
    const r = {name: val('rc_name'), type: val('rc_type'), amount: r2(num(val('rc_amt'))), day: Math.min(31, Math.max(1, parseInt(val('rc_day')) || 1)), category: val('rc_cat'), active: true};
    if (!r.name) return toast('Give it a name');
    if (id) Object.assign(D.recurring.find(x => x.id === id), r); else D.recurring.push({id: uid(), payments: {}, startDate: TODAY.slice(0, 8) + '01', ...r});
    closeModal(); commit();
  },
  payBill(rid, ym) {
    const r = D.recurring.find(x => x.id === rid);
    modal(`<h2>Pay ${esc(r.name)}</h2><div class="formgrid"><label class="f">Amount this time (€)<input type="number" step="0.01" id="pb_amt" value="${r.amount}"></label><label class="f">Paid on<input type="date" id="pb_date" value="${TODAY}"></label></div>
      <div class="small muted mt">Recorded as Needs · paid from salary.</div><div class="row mt"><span class="sp"></span><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn pri" onclick="A.payBillSave('${rid}','${ym}')">Mark paid</button></div>`);
  },
  payBillSave(rid, ym) {
    const r = D.recurring.find(x => x.id === rid), tid = uid();
    D.transactions.push({id: tid, date: val('pb_date'), amount: r2(num(val('pb_amt'))), category: r.category || (r.type === 'subscription' ? 'Subscriptions' : 'Bills'), bucket: 'needs', source: 'salary', note: r.name, recurringId: rid});
    (r.payments ||= {})[ym] = tid; closeModal(); commit();
  },
  moveLeftover() {
    const p = currentPeriod(), st = periodStats(p), amt = r2(st.leftover);
    modal(`<h2>Move leftover to savings</h2><label class="f">Amount (€)<input type="number" step="0.01" id="lo_amt" value="${amt}"></label><div class="small muted mt">Projected leftover: ${eur(st.needsLeft)} needs − ${eur(st.committed)} bills still due + ${eur(st.wantsLeft)} wants.</div>
      <div class="row mt"><span class="sp"></span><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn pri" onclick="A.moveLeftoverSave()">Move</button></div>`);
  },
  moveLeftoverSave() {
    const p = currentPeriod(), a = r2(num(val('lo_amt'))); if (a <= 0) return;
    D.savingsMoves.push({id: uid(), date: TODAY, amount: a, kind: 'deposit', note: 'Leftover from ' + fd(p.start) + ' period'});
    p.pc.leftoverMoved = r2((p.pc.leftoverMoved || 0) + a); closeModal(); commit();
  },
  saveMove(kind) {
    modal(`<h2>${kind === 'withdraw' ? 'Withdraw from' : 'Deposit to'} savings</h2><div class="formgrid"><label class="f">Amount (€)<input type="number" step="0.01" id="sm_amt"></label><label class="f">Date<input type="date" id="sm_date" value="${TODAY}"></label><label class="f full">Note<input id="sm_note"></label></div>
      <div class="row mt"><span class="sp"></span><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn pri" onclick="A.saveMoveSave('${kind}')">Save</button></div>`);
  },
  saveMoveSave(kind) { const a = r2(num(val('sm_amt'))); if (a <= 0) return; D.savingsMoves.push({id: uid(), date: val('sm_date'), amount: a, kind, note: val('sm_note') || (kind === 'withdraw' ? 'Withdrawal' : 'Deposit')}); closeModal(); commit(); },
  goal(id) {
    const g = id ? D.goals.find(x => x.id === id) : {name: '', target: '', saved: 0};
    modal(`<h2>${id ? 'Edit' : 'New'} savings goal</h2><div class="formgrid"><label class="f full">Name<input id="gl_name" value="${esc(g.name)}"></label><label class="f">Target (€)<input type="number" id="gl_t" value="${g.target}"></label><label class="f">Already assigned (€)<input type="number" id="gl_s" value="${g.saved}"></label></div>
      <div class="row mt">${id ? `<button class="btn ghost danger" onclick="A.del('goals','${id}');closeModal()">Delete</button>` : ''}<span class="sp"></span><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn pri" onclick="A.goalSave('${id || ''}')">Save</button></div>`);
  },
  goalSave(id) { const g = {name: val('gl_name'), target: num(val('gl_t')), saved: num(val('gl_s'))}; if (!g.name || g.target <= 0) return toast('Name and target needed'); if (id) Object.assign(D.goals.find(x => x.id === id), g); else D.goals.push({id: uid(), ...g}); closeModal(); commit(); },
  goalAdd(id) { modal(`<h2>Assign savings to goal</h2><label class="f">Amount (€)<input type="number" id="ga_amt"></label><div class="small muted mt">Not assigned yet: ${eur(savingsBalance() - sum(D.goals, g => g.saved))}</div><div class="row mt"><span class="sp"></span><button class="btn pri" onclick="D.goals.find(g=>g.id==='${id}').saved+=num(val('ga_amt'));closeModal();commit()">Assign</button></div>`); },
  wish(id) {
    const w = id ? D.wishlist.find(x => x.id === id) : {bucket: 'wants', price: ''};
    modal(`<h2>${id ? 'Edit' : 'New'} wishlist item</h2><div class="formgrid"><label class="f full">Name<input id="wl_name" value="${esc(w.name || '')}" placeholder="Headphones, winter boots…"></label>
      <label class="f">Price (€)<input type="number" step="0.01" id="wl_price" value="${w.price}"></label>
      <div><div class="small muted" style="margin-bottom:4px">TYPE</div><span class="seg" id="wl_b">${['needs', 'wants'].map(b => `<button class="${w.bucket === b ? 'on' : ''}" onclick="this.parentNode.querySelectorAll('button').forEach(x=>x.classList.remove('on'));this.classList.add('on')">${b === 'needs' ? 'Need' : 'Want'}</button>`).join('')}</span></div>
      <label class="f full">Store link<input id="wl_link" value="${esc(w.link || '')}" placeholder="https://…"></label><label class="f full">Note<input id="wl_note" value="${esc(w.note || '')}" placeholder="size, colour, wait for sale…"></label>
      <label class="f">Category when bought<select id="wl_cat">${catOptions(w.category || (w.bucket === 'needs' ? 'Other' : 'Shopping'))}</select></label></div>
      <div class="row mt">${id ? `<button class="btn ghost danger" onclick="A.del('wishlist','${id}');closeModal()">Delete</button>` : ''}<span class="sp"></span><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn pri" onclick="A.wishSave('${id || ''}')">Save</button></div>`);
  },
  wishSave(id) {
    const w = {name: val('wl_name'), price: r2(num(val('wl_price'))), bucket: $('#wl_b button.on').textContent === 'Need' ? 'needs' : 'wants', link: val('wl_link'), note: val('wl_note'), category: val('wl_cat')};
    if (!w.name) return toast('Give it a name');
    if (id) Object.assign(D.wishlist.find(x => x.id === id), w); else D.wishlist.push({id: uid(), added: TODAY, bought: false, ...w});
    closeModal(); commit();
  },
  wishBuy(id) {
    const w = D.wishlist.find(x => x.id === id);
    modal(`<h2>Bought: ${esc(w.name)}</h2><div class="formgrid"><label class="f">Price paid (€)<input type="number" step="0.01" id="wb_amt" value="${w.price}"></label><label class="f">Date<input type="date" id="wb_date" value="${TODAY}"></label>
      <label class="f">Budget<select id="wb_b"><option value="needs" ${w.bucket === 'needs' ? 'selected' : ''}>needs</option><option value="wants" ${w.bucket === 'wants' ? 'selected' : ''}>wants</option></select></label><label class="f">Category<select id="wb_cat">${catOptions(w.category || 'Shopping')}</select></label>
      <div class="full"><div class="small muted" style="margin-bottom:4px">PAID FROM</div><span class="seg" id="wb_src">${['salary', 'savings'].map(s => `<button class="${s === 'salary' ? 'on' : ''}" onclick="this.parentNode.querySelectorAll('button').forEach(b=>b.classList.remove('on'));this.classList.add('on')">${s === 'salary' ? 'This month\'s salary' : 'Savings'}</button>`).join('')}</span></div></div>
      <div class="row mt"><span class="sp"></span><button class="btn ghost" onclick="closeModal();render()">Cancel</button><button class="btn pri" onclick="A.wishBuySave('${id}')">Mark bought</button></div>`);
  },
  wishBuySave(id) {
    const w = D.wishlist.find(x => x.id === id), amt = r2(num(val('wb_amt'))); if (amt <= 0) return toast('Enter the price');
    const src = $('#wb_src button.on').textContent.startsWith('Savings') ? 'savings' : 'salary', tid = uid();
    D.transactions.push({id: tid, date: val('wb_date'), amount: amt, category: val('wb_cat'), bucket: val('wb_b'), note: w.name, source: src, wishId: id});
    Object.assign(w, {bought: true, boughtAt: val('wb_date'), paid: amt, source: src, txId: tid, bucket: val('wb_b')});
    closeModal(); toast(`${w.name} · ${eur(amt)} from ${src}`); commit();
  },
  wishUnbuy(id) {
    const w = D.wishlist.find(x => x.id === id);
    if (!confirm(`Undo the purchase of "${w.name}"? The ${eur(w.paid ?? w.price)} expense will be removed.`)) return render();
    D.transactions = D.transactions.filter(t => t.id !== w.txId);
    Object.assign(w, {bought: false, boughtAt: null, paid: null, txId: null, source: null}); commit();
  },
  person(id) {
    const p = id ? D.people.find(x => x.id === id) : {};
    modal(`<h2>${id ? 'Edit' : 'New'} person</h2><div class="formgrid"><label class="f">Name<input id="pp_name" value="${esc(p.name || '')}"></label><label class="f">Relation<input id="pp_rel" value="${esc(p.relation || '')}" placeholder="friend, mum, cousin…"></label>
      <label class="f">Birthday<input type="date" id="pp_bd" value="${/^\d{4}/.test(p.birthday || '') ? p.birthday : ''}"></label><label class="f">…or just day.month (year unknown)<input id="pp_bd2" placeholder="14.03" value="${p.birthday && p.birthday.startsWith('--') ? p.birthday.slice(8) + '.' + p.birthday.slice(5, 7) : ''}"></label>
      <label class="f full">Gift ideas<input id="pp_gift" value="${esc(p.gifts || '')}"></label><label class="f full">Notes<input id="pp_notes" value="${esc(p.notes || '')}"></label></div>
      <div class="row mt">${id ? `<button class="btn ghost danger" onclick="A.del('people','${id}');closeModal()">Delete</button>` : ''}<span class="sp"></span><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn pri" onclick="A.personSave('${id || ''}')">Save</button></div>`);
  },
  personSave(id) {
    let bd = val('pp_bd'); const m = val('pp_bd2').match(/^(\d{1,2})[./-](\d{1,2})$/); if (!bd && m) bd = `--${pad(m[2])}-${pad(m[1])}`;
    const p = {name: val('pp_name'), relation: val('pp_rel'), birthday: bd, gifts: val('pp_gift'), notes: val('pp_notes')}; if (!p.name) return toast('Name needed');
    if (id) Object.assign(D.people.find(x => x.id === id), p); else D.people.push({id: uid(), ...p}); closeModal(); commit();
  },
  task(id, date) {
    const t = id ? D.tasks.find(x => x.id === id) : {due: date || ''};
    modal(`<h2>${id ? 'Edit' : 'New'} task / note</h2><div class="formgrid"><label class="f full">Title<input id="tk_t" value="${esc(t.title || '')}"></label><label class="f">Due date (empty = note)<input type="date" id="tk_d" value="${t.due || ''}"></label><label class="f full">Details<input id="tk_n" value="${esc(t.notes || '')}"></label></div>
      <div class="row mt">${id ? `<button class="btn ghost danger" onclick="A.del('tasks','${id}');closeModal()">Delete</button>` : ''}<span class="sp"></span><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn pri" onclick="A.taskSave('${id || ''}')">Save</button></div>`);
  },
  taskSave(id) { const t = {title: val('tk_t'), due: val('tk_d'), notes: val('tk_n')}; if (!t.title) return; if (id) Object.assign(D.tasks.find(x => x.id === id), t); else D.tasks.push({id: uid(), done: false, ...t}); closeModal(); commit(); },
  toggleTask(id) { const t = D.tasks.find(x => x.id === id); t.done = !t.done; t.doneAt = t.done ? TODAY : null; commit(); },
  bodyLog() {
    const last = [...D.body].sort((a, b) => a.date < b.date ? -1 : 1).pop() || {};
    modal(`<h2>Body log</h2><div class="formgrid"><label class="f">Weight (kg)<input type="number" step="0.1" id="bd_w" placeholder="${last.weight || ''}"></label><label class="f">Waist (cm) — at the navel<input type="number" step="0.1" id="bd_ws" placeholder="${last.waist || ''}"></label><label class="f">Date<input type="date" id="bd_d" value="${TODAY}"></label></div>
      <div class="small faint mt">Tip: weigh in the morning after the bathroom, before eating.</div><div class="row mt"><span class="sp"></span><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn pri" onclick="A.bodySave()">Save</button></div>`);
  },
  bodySave() {
    const w = num(val('bd_w')) || null, ws = num(val('bd_ws')) || null, d = val('bd_d'); if (!w && !ws) return;
    const ex = D.body.find(b => b.date === d); if (ex) { if (w) ex.weight = w; if (ws) ex.waist = ws; } else D.body.push({id: uid(), date: d, weight: w, waist: ws});
    closeModal(); commit();
  },
  del(coll, id) { if (coll === 'transactions') for (const w of D.wishlist) if (w.txId === id) Object.assign(w, {bought: false, txId: null, paid: null}); D[coll] = D[coll].filter(x => x.id !== id); if (coll === 'transactions') for (const r of D.recurring) for (const k in r.payments || {}) if (r.payments[k] === id) delete r.payments[k]; commit(); },
  hevyParse() { UI.hevyDraft = $('#hevyText').value; UI.importPreview = parseHevy(UI.hevyDraft); render(); },
  hevyFile(inp) { const f = inp.files[0]; if (!f) return; f.text().then(t => { UI.hevyDraft = t; UI.importPreview = parseHevy(t); render(); }); },
  hevySave() { const r = addWorkouts(UI.importPreview || []); UI.importPreview = null; UI.hevyDraft = ''; toast(`${r.added} added${r.replaced ? `, ${r.replaced} updated` : ''}`); UI.gymTab = 'history'; commit(); },
  syncSetup() {
    modal(`<h2>Set up sync</h2><div class="small" style="line-height:1.8">
      <b class="acc">1.</b> Make a GitHub token that can only touch gists: <a class="acc" href="https://github.com/settings/tokens/new?scopes=gist&description=Oracle%202%20sync" target="_blank" rel="noopener">open GitHub ↗</a> → set <i>Expiration</i> to <i>No expiration</i> → <i>Generate token</i> → copy it.<br>
      <b class="acc">2.</b> Pick a sync passphrase. Use the <b>same token and passphrase on every device</b>. The passphrase never leaves your devices — if you forget it, the synced copy can't be opened (your data on each device stays safe).</div>
      <div class="formgrid mt"><label class="f full">GitHub token<input id="sy_tok" autocomplete="off" spellcheck="false" placeholder="ghp_…" value="${esc(SYNC?.token || '')}"></label>
      <label class="f">Sync passphrase (8+ characters)<input id="sy_p1" type="password" autocomplete="new-password"></label><label class="f">Repeat passphrase<input id="sy_p2" type="password" autocomplete="new-password"></label></div>
      <div class="small faint mt">First device: creates the encrypted copy. Other devices: find it and merge it with whatever is already on them — nothing is overwritten.</div>
      <div class="row mt"><span class="sp"></span><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn pri" onclick="A.syncSave()">Connect</button></div>`);
  },
  async syncSave() {
    const token = val('sy_tok'), p1 = $('#sy_p1').value, p2 = $('#sy_p2').value;
    if (!/^(gh[pousr]_|github_pat_)\w+/.test(token)) return toast('That doesn\'t look like a GitHub token');
    if (p1.length < 8) return toast('Passphrase needs at least 8 characters');
    if (p1 !== p2) return toast('Passphrases don\'t match');
    const prev = SYNC; SYNC = {token, pass: p1, gistId: prev && prev.token === token ? prev.gistId : null, salt: null, last: 0};
    closeModal(); await syncNow(true);
    if (UI.sync.state === 'error') { toast(UI.sync.msg); if (/token|passphrase/i.test(UI.sync.msg)) { SYNC = prev; await store.set('sync', prev); UI.sync = {state: prev ? 'ok' : 'off', msg: ''}; } }
    render();
  },
  async syncOff() { if (!confirm('Stop syncing on this device? Your data here stays, and the encrypted copy on GitHub is kept for your other devices.')) return; SYNC = null; await idb.del('sync').catch(() => localStorage.removeItem('oracle2:sync')); UI.sync = {state: 'off', msg: ''}; render(); showSaveState(); },
  wipe() {
    modal(`<h2>Erase all data</h2><div class="small" style="line-height:1.8">This deletes everything in Oracle 2 on this device${SYNC ? ' <b class="bad">and, because sync is on, on your other devices too</b>' : ''}. Export a backup first if you might want it back.</div>
      <label class="f mt">Type ERASE to confirm<input id="wp_ok" autocomplete="off"></label><div class="row mt"><span class="sp"></span><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn danger" onclick="if(val('wp_ok')==='ERASE')A.wipeNow()">Erase everything</button></div>`);
  },
  wipeNow() { const keep = {onboarded: true}; for (const c of COLLS) D[c] = []; D.settings = {...defaults().settings, ...keep}; closeModal(); toast('All data erased'); commit(); },
  async checkUpdate() {
    const reg = await navigator.serviceWorker?.getRegistration(); if (!reg) return toast('Updates work once the app is installed from its web address');
    await reg.update(); setTimeout(() => toast(reg.waiting || reg.installing ? 'Update found — tap "Update now" in the banner' : `You have the latest version (${APP_VERSION})`), 1200);
  },
  splitCheck() { const v = ['needs', 'wants', 'savings'].map(k => num(val('sp_' + k))), t = sum(v);
    $('#spBar').innerHTML = v.map((x, i) => `<i style="width:${x}%;background:${PAL[['needs', 'wants', 'savings'][i]]}"></i>`).join('');
    $('#spSum').innerHTML = t === 100 ? '<span class="good">✓ adds up to 100%</span>' : `<span class="bad">${t}% — must be 100%</span>`; $('#spSave').disabled = t !== 100; },
  splitSave() { ['needs', 'wants', 'savings'].forEach(k => D.settings.split[k] = num(val('sp_' + k))); toast('Split saved — used for your next paycheck'); commit(); },
  generalSave() { const s = D.settings; s.reminderDays = Math.max(7, parseInt(val('st_rem')) || 7); s.startingSavings = num(val('st_sav')); s.gymGoal = {weightMin: num(val('st_gmin')), weightMax: num(val('st_gmax'))}; toast('Saved'); commit(); },
  catAdd() { D.settings.categories.push({name: 'New category', bucket: 'wants'}); commit(); },
  catEdit(i, k, v) { const old = D.settings.categories[i].name; D.settings.categories[i][k] = v; if (k === 'name') for (const t of D.transactions) if (t.category === old) t.category = v; save(); },
  catDel(i) { D.settings.categories.splice(i, 1); commit(); },
  exportData() { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(D, null, 1)], {type: 'application/json'})); a.download = `oracle2-${TODAY}.json`; a.click(); },
  importData(inp) { const f = inp.files[0]; if (!f) return; f.text().then(t => { try { const j = JSON.parse(t); if (!j.settings) throw 0; if (confirm('Replace ALL current data with this file?')) { D = migrate(j); commit(); toast('Imported'); } } catch { toast('Not an Oracle 2 file'); } }); },
};

// ------------------------------------------------------------------ quick add (Ctrl+K)
function qaParse(s) {
  s = s.trim(); if (!s) return null; let m;
  if ((m = s.match(/^(?:weight|w)\s+([\d.,]+)/i))) return {kind: 'weight', v: num(m[1]), d: `Log weight ${num(m[1])} kg today`};
  if ((m = s.match(/^waist\s+([\d.,]+)/i))) return {kind: 'waist', v: num(m[1]), d: `Log waist ${num(m[1])} cm today`};
  if ((m = s.match(/^(?:income|salary|paycheck|paid)\s+([\d.,]+)/i))) return {kind: 'pay', v: num(m[1]), d: `Paycheck ${eur(num(m[1]))} → review the split`};
  if ((m = s.match(/^(?:save|saved|savings)\s+([\d.,]+)/i))) return {kind: 'save', v: num(m[1]), d: `Deposit ${eur(num(m[1]))} to savings`};
  if ((m = s.match(/^(?:bday|birthday)\s+(.+?)\s+(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?|\d{4}-\d{2}-\d{2})$/i))) {
    const parts = m[2].split(/[./-]/); let bd;
    if (/^\d{4}-/.test(m[2])) bd = m[2]; else if (parts[2]) bd = `${parts[2].length === 2 ? '19' + parts[2] : parts[2]}-${pad(parts[1])}-${pad(parts[0])}`; else bd = `--${pad(parts[1])}-${pad(parts[0])}`;
    return {kind: 'bday', name: m[1], bd, d: `${m[1]} · birthday ${bd.replace(/^--/, '')}`};
  }
  if ((m = s.match(/^(?:task|todo|t)\s+(.+)$/i))) {
    const words = m[1].split(/\s+/), last = parseDateWord(words[words.length - 1]);
    const title = last ? words.slice(0, -1).join(' ') : m[1];
    return {kind: 'task', title, due: last || '', d: `Task “${title}”${last ? ' · due ' + fdl(last) : ''}`};
  }
  if ((m = s.match(/^(want|need|wish)\s+([\d.,]+)\s+(.+)$/i))) { const b = /need/i.test(m[1]) ? 'needs' : 'wants'; return {kind: 'wish', price: num(m[2]), name: m[3], bucket: b, d: `Wishlist (${b}) · ${m[3]} · ${eur(num(m[2]))}`}; }
  if ((m = s.match(/^note\s+(.+)$/i))) return {kind: 'task', title: m[1], due: '', d: `Note “${m[1]}”`};
  if ((m = s.match(/^([\d.,]+)\s*(.*)$/))) {
    let rest = m[2], src = 'salary';
    if (/(^|\s)@s(avings)?\b/i.test(rest)) { src = 'savings'; rest = rest.replace(/(^|\s)@s(avings)?\b/i, ' ').trim(); }
    const words = rest.split(/\s+/).filter(Boolean); let date = TODAY;
    if (words.length && parseDateWord(words[words.length - 1])) date = parseDateWord(words.pop());
    let cat = 'Other', note = words.join(' ');
    const restL = words.join(' ').toLowerCase();
    const full = [...D.settings.categories].sort((a, b) => b.name.length - a.name.length).find(c => restL === c.name.toLowerCase() || restL.startsWith(c.name.toLowerCase() + ' '));
    if (full) { cat = full.name; note = words.join(' ').slice(full.name.length).trim(); }
    else if (words.length) { const w0 = words[0].toLowerCase(); const c = D.settings.categories.find(c => c.name.toLowerCase().startsWith(w0) || c.name.toLowerCase().replace(' ', '') === w0); if (c) { cat = c.name; note = words.slice(1).join(' '); } }
    return {kind: 'exp', amount: num(m[1]), cat, note, date, src, d: `Expense ${eur(num(m[1]))} · ${cat} (${catBucket(cat)})${note ? ' · ' + note : ''} · ${date === TODAY ? 'today' : fdl(date)} · from ${src}`};
  }
  return {kind: 'task', title: s, due: '', d: `Note “${s}” (start with a number for spending)`};
}
function quickAdd() {
  modal(`<h2>Quick add</h2><div class="qa"><input id="qa" placeholder="12.50 food lunch" autocomplete="off" oninput="$('#qapv').textContent=(qaParse(this.value)||{d:''}).d" onkeydown="if(event.key==='Enter')qaGo()"><div class="pv" id="qapv"></div>
    <div class="help"><code>24.90 eating out pizza</code> expense · <code>60 hobbies @savings</code> paid from savings · <code>15 food yesterday</code><br>
    <code>task call bank fri</code> · <code>task renew ID 03.12</code> · <code>note gift idea for mum: scarf</code><br>
    <code>want 89 headphones</code> · <code>need 120 winter boots</code><br><code>bday Ivan 14.03</code> · <code>weight 86.4</code> · <code>waist 98</code> · <code>income 2400</code> · <code>save 200</code></div></div>`);
}
function qaGo() {
  const p = qaParse(val('qa')); if (!p) return; closeModal();
  if (p.kind === 'exp') D.transactions.push({id: uid(), date: p.date, amount: r2(p.amount), category: p.cat, bucket: catBucket(p.cat), note: p.note, source: p.src});
  if (p.kind === 'task') D.tasks.push({id: uid(), title: p.title, due: p.due, done: false});
  if (p.kind === 'weight' || p.kind === 'waist') { const ex = D.body.find(b => b.date === TODAY), k = p.kind; if (ex) ex[k] = p.v; else D.body.push({id: uid(), date: TODAY, weight: k === 'weight' ? p.v : null, waist: k === 'waist' ? p.v : null}); }
  if (p.kind === 'wish') D.wishlist.push({id: uid(), added: TODAY, bought: false, name: p.name, price: r2(p.price), bucket: p.bucket, link: '', note: '', category: p.bucket === 'needs' ? 'Other' : 'Shopping'});
  if (p.kind === 'save') D.savingsMoves.push({id: uid(), date: TODAY, amount: p.v, kind: 'deposit', note: 'Deposit'});
  if (p.kind === 'bday') { const ex = D.people.find(x => x.name.toLowerCase() === p.name.toLowerCase()); if (ex) ex.birthday = p.bd; else D.people.push({id: uid(), name: p.name, birthday: p.bd}); }
  if (p.kind === 'pay') return A.paycheck(p.v);
  toast('Added · ' + p.d.split(' · ')[0]); commit();
}

// ------------------------------------------------------------------ shell
const CRUMB = {today: 'TODAY', money: 'MONEY', gym: 'GYM', records: 'RECORDS', calendar: 'CALENDAR', settings: 'SETTINGS', help: 'HELP'};
function render() {
  document.querySelectorAll('[data-view]').forEach(a => a.classList.toggle('on', a.dataset.view === UI.view));
  const sub = UI.view === 'money' ? ' // ' + ({tx: 'TRANSACTIONS', wish: 'WISHLIST'}[UI.moneyTab] || UI.moneyTab.toUpperCase()) : UI.view === 'gym' ? ' // ' + (UI.gymTab === 'progress' ? 'EXERCISES' : UI.gymTab.toUpperCase()) : '';
  $('#crumb').textContent = `> DECODING // ${CRUMB[UI.view]}${sub}`;
  const sc = $('#view').scrollTop; $('#view').innerHTML = V[UI.view](); $('#view').scrollTop = sc;
  const p = currentPeriod(), segs = 22, done = p ? Math.round(Math.min(1, (diff(p.start, TODAY) + 1) / (diff(p.start, p.end) + 1)) * segs) : 0;
  $('#segs').innerHTML = [...Array(segs)].map((_, i) => `<i class="${i < done - 1 ? 'on' : i === done - 1 ? 'hi' : ''}"></i>`).join('');
  $('#segs').title = p ? `Pay period: day ${diff(p.start, TODAY) + 1} of ${diff(p.start, p.end) + 1}` : '';
  showSaveState();
}
function go(view) { UI.view = view; render(); $('#view').scrollTop = 0; }
function tick() { const d = new Date(); $('#clock').textContent = `TX ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
document.querySelectorAll('[data-view]').forEach(a => a.onclick = () => go(a.dataset.view));
$('#quickBtn').onclick = quickAdd; $('#fab').onclick = quickAdd;
$('#modal').onclick = e => { if (e.target.id === 'modal' && !e.target.querySelector('.tour')) closeModal(); };
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); quickAdd(); }
  else if (e.key === 'Escape' && !$('#modal .tour')) closeModal();
  else if (/^[1-7]$/.test(e.key) && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && $('#modal').classList.contains('hidden')) go(Object.keys(CRUMB)[+e.key - 1]);
});
const tip = $('#tip');
document.addEventListener('mouseover', e => { const t = e.target.closest('[data-tip]'); if (t) { tip.textContent = t.dataset.tip; tip.classList.add('on'); } else tip.classList.remove('on'); });
document.addEventListener('mousemove', e => { if (tip.classList.contains('on')) { tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; } });
document.addEventListener('touchstart', () => tip.classList.remove('on'), {passive: true});

// ---- updates: a new version downloads in the background; one tap applies it. Data is untouched.
function updateBanner(reg) {
  if ($('#updBar')) return;
  const b = document.createElement('div'); b.id = 'updBar'; b.className = 'updbar';
  b.innerHTML = `<span>▸ A new version of Oracle 2 is ready</span><button class="btn pri sm">Update now</button>`;
  b.querySelector('button').onclick = () => { reg.waiting && reg.waiting.postMessage('SKIP_WAITING'); };
  document.body.appendChild(b);
}
async function registerSW() {
  if (!('serviceWorker' in navigator) || qs.get('nosw')) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
    if (reg.waiting && navigator.serviceWorker.controller) updateBanner(reg);
    reg.addEventListener('updatefound', () => { const w = reg.installing; w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) updateBanner(reg); }); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  } catch (e) { console.warn('SW', e); }
}

// ---- things shared into the app (Hevy → Share → Oracle 2 on Android)
function handleShare() {
  if (!qs.has('text') && !qs.has('url') && !qs.has('share')) return;
  const text = [qs.get('title'), qs.get('text'), qs.get('url')].filter(Boolean).join('\n');
  history.replaceState(null, '', location.pathname);
  if (!text.trim()) return;
  UI.view = 'gym'; UI.gymTab = 'import'; UI.hevyDraft = text; UI.importPreview = parseHevy(text);
  if (!UI.importPreview.length) toast('Shared text had no workout sets — check it and press Preview');
}

// refresh at midnight so "today" is never stale; keep sync & reminders going while open
let lastDay = iso(new Date());
setInterval(() => { tick(); if (!qs.get('date') && iso(new Date()) !== lastDay && $('#modal').classList.contains('hidden')) location.reload(); }, 1000);
setInterval(() => { syncNow(); checkReminders(); }, 3 * 60e3);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
addEventListener('online', () => syncNow());
if (qs.get('view')) UI.view = qs.get('view');
['moneyTab', 'gymTab', 'recTab'].forEach(k => qs.get(k) && (UI[k] = qs.get(k)));
loadData().then(async () => {
  tick(); handleShare(); render();
  if (!D.settings.onboarded && !qs.get('notour')) startTour();
  registerSW(); await syncNow();
  if (!D.settings.onboarded && $('#modal').classList.contains('hidden') && !qs.get('notour')) startTour(); // sync may have brought settings from another device
  checkReminders();
});
