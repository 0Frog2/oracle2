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
function eur(n, dec = 2) { if (typeof HIDE !== 'undefined' && HIDE) return '€••••'; return (n < 0 ? '−' : '') + '€' + Math.abs(n).toLocaleString('en-IE', {minimumFractionDigits: dec, maximumFractionDigits: dec}); }
const eur0 = n => eur(n, Math.abs(n) >= 1000 ? 0 : 2);
const daysIn = (y, m) => new Date(y, m, 0).getDate(); // m: 1-12
const nf = (v, dec = 2) => (+v || 0).toLocaleString('en-IE', {maximumFractionDigits: dec}); // never shows 177.45000000000002
const stripTags = h => String(h).replace(/<[^>]*>/g, '');
const qs = new URLSearchParams(location.search);
const TODAY = qs.get('date') || iso(new Date());

function lastWorkday(y, m) { // m 1-12 — skips weekends and Bulgarian public holidays
  let d = new Date(y, m - 1, daysIn(y, m));
  const bg = typeof BG !== 'undefined' && !(D && D.settings && D.settings.bgCalendar === false);
  while (d.getDay() === 0 || d.getDay() === 6 || (bg && !BG.isWorkday(iso(d)))) d.setDate(d.getDate() - 1);
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
  if (di >= 0 && /^(mon(day)?|tue(s|sday)?|wed(nesday)?|thu(r|rs|rsday)?|fri(day)?|sat(urday)?|sun(day)?)$/.test(w)) { let n = (di - dowi(TODAY) + 7) % 7; return addDays(TODAY, n || 7); }
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
const APP_VERSION = '2.7.0', DATA_VERSION = 2;
const COLLS = ['lifeGoals', 'wishlist', 'people', 'tasks', 'paychecks', 'transactions', 'savingsMoves', 'recurring', 'goals', 'workouts', 'body', 'focus', 'media', 'assets', 'gifts'];
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
  return {version: DATA_VERSION, settings: {split: {needs: 50, wants: 30, savings: 20}, reminderDays: 7, startingSavings: 0, gymGoal: {weightMin: 0, weightMax: 0}, onboarded: false, limits: {}, bgCalendar: true, training: {days: {}, remind: true}, focusLabels: [],
    categories: [['Bills', 'needs'], ['Subscriptions', 'needs'], ['Food', 'needs'], ['Transport', 'needs'], ['Health', 'needs'], ['Eating out', 'wants'], ['Entertainment', 'wants'], ['Hobbies', 'wants'], ['Gifts', 'wants'], ['Shopping', 'wants'], ['Investing', 'savings'], ['Other', 'wants']].map(([name, bucket]) => ({name, bucket}))},
    lifeGoals: [], wishlist: [], people: [], tasks: [], paychecks: [], transactions: [], savingsMoves: [], recurring: [], goals: [], workouts: [], body: [], focus: [], media: [], assets: [], gifts: [], meta: {tomb: {}, settingsU: {}}};
}
// Upgrades older saved data so updates never lose anything. Add a step here whenever the format changes.
function migrate(d) {
  const def = defaults();
  for (const k of COLLS) d[k] ||= [];
  d.settings = {...def.settings, ...(d.settings || {})};
  d.settings.gymGoal ||= def.settings.gymGoal; d.settings.split ||= def.settings.split; d.settings.limits ||= {}; if (!d.settings.giftsCat) { d.settings.giftsCat = 1; if (!d.settings.categories.some(c => c.name.toLowerCase() === 'gifts')) { const i = d.settings.categories.findIndex(c => c.name === 'Hobbies'); d.settings.categories.splice(i < 0 ? d.settings.categories.length : i + 1, 0, {name: 'Gifts', bucket: 'wants'}); d.meta ||= {}; d.meta.settingsU ||= {}; d.meta.settingsU.categories = Date.now(); } } d.settings.training ||= {days: {}, remind: true}; d.settings.training.days ||= {}; d.settings.focusLabels ||= [];
  d.meta ||= {}; d.meta.tomb ||= {}; if (typeof d.meta.settingsU !== 'object' || !d.meta.settingsU) d.meta.settingsU = {}; delete d.meta.notified;
  if ((d.version || 1) < 2) { /* v1 → v2: nothing to convert, records get sync stamps on first save */ }
  d.version = DATA_VERSION;
  return d;
}
async function loadData() {
  const raw = await store.get('data'); UI.fresh = !raw;
  D = migrate(raw || defaults());
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

// ------------------------------------------------------------------ this device only: theme, hidden amounts, app lock (never synced)
let PREFS = {}, HIDE = false, LOCKED = false, hiddenAt = 0;
const ACCENTS = [['Mint', '#6fd6c0'], ['Ice', '#7cc4ff'], ['Amber', '#f0b35a'], ['Crimson', '#ff6b7a'], ['Violet', '#b39dff'], ['Lime', '#a8e06a'], ['Gold', '#d8b45a'], ['Rose', '#f39ac7']];
const BGS = [['Midnight', '#0b0b0d', '#111114', '#16161a', '#0a0a0c'], ['Pure black', '#000000', '#0a0a0b', '#111113', '#000000'], ['Graphite', '#15161a', '#1b1c21', '#212228', '#121317'], ['Deep navy', '#0a0e14', '#0f141c', '#141a24', '#080b10']];
const SIZES = [['Small', .92], ['Normal', 1], ['Large', 1.1], ['Extra large', 1.22]];
async function loadPrefs() { PREFS = (await store.get('prefs')) || {}; HIDE = !!(PREFS.hideOnOpen || PREFS.hide); applyTheme(); }
async function savePrefs() { await store.set('prefs', PREFS); }
const darken = (hex, f) => { const n = parseInt(hex.slice(1), 16); return '#' + [n >> 16, n >> 8 & 255, n & 255].map(c => Math.round(c * f).toString(16).padStart(2, '0')).join(''); };
function applyTheme() {
  const t = PREFS.theme || {}, st = document.documentElement.style, acc = /^#[0-9a-f]{6}$/i.test(t.accent || '') ? t.accent : '#6fd6c0', bg = BGS.find(b => b[0] === t.bg) || BGS[0];
  st.setProperty('--accent', acc); st.setProperty('--accent-dim', darken(acc, .42));
  st.setProperty('--bg', bg[1]); st.setProperty('--panel', bg[2]); st.setProperty('--panel2', bg[3]); st.setProperty('--navbg', bg[4]);
  st.setProperty('--zoom', t.zoom || 1);
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = bg[1];
  const hb = $('#hideBtn'); if (hb) { hb.classList.toggle('on', HIDE); hb.title = HIDE ? 'Show amounts' : 'Hide amounts'; hb.innerHTML = HIDE ? EYE_OFF : EYE; }
  const lb = $('#lockBtn'); if (lb) lb.style.display = PREFS.lock ? '' : 'none';
}
const EYE = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.9 17.9A10.8 10.8 0 0 1 12 19c-7 0-11-7-11-7a19.8 19.8 0 0 1 5.1-5.9M9.9 5.2A10 10 0 0 1 12 5c7 0 11 7 11 7a19.6 19.6 0 0 1-2.2 3.2M1 1l22 22"/></svg>';
function toggleHide() { HIDE = !HIDE; PREFS.hide = HIDE; savePrefs(); applyTheme(); render(); }
function setTheme(k, v) { PREFS.theme = {...(PREFS.theme || {}), [k]: v}; savePrefs(); applyTheme(); render(); }

// ---- app lock: a PIN (4–8 digits) per device; phones can also use fingerprint / face. It keeps casual eyes out — it is not encryption.
const rnd = n => crypto.getRandomValues(new Uint8Array(n));
async function pinHash(pin, salt) { const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']); return b64(await crypto.subtle.deriveBits({name: 'PBKDF2', salt: ub64(salt), iterations: 150000, hash: 'SHA-256'}, k, 256)); }
const isPhone = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
async function bioAvailable() { try { return isPhone() && !!window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch { return false; } }
let pinBuf = '';
function lockNow() { if (!PREFS.lock) return; LOCKED = true; pinBuf = ''; closeModal(); showLock(); if (PREFS.lock.cred && document.visibilityState === 'visible') setTimeout(bioUnlock, 350); }
// The lock screen is drawn once; key presses only update the dots and the message.
let lockTimer = 0;
function showLock(msg) {
  let l = $('#lockLayer'); if (!l) { l = document.createElement('div'); l.id = 'lockLayer'; document.body.appendChild(l); }
  const KEY = (k, inner, lbl) => `<button type="button" class="pk${k === 'del' || k === 'bio' ? ' fn' : ''}" data-k="${k}" aria-label="${lbl || k}">${inner || k}</button>`;
  const BIO = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 11v3m-4-3a4 4 0 0 1 8 0v1.5M5.5 9a7 7 0 0 1 13 0M8 17.5c.6-1 1-2.6 1-4.5m6 1.5c0 2-.4 3.4-1 4.5M3 13c0-1 .1-2 .4-3m17.2 0c.3 1 .4 2 .4 3"/></svg>';
  const DEL = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 5H9l-6 7 6 7h12z"/><path d="M17 9l-6 6m0-6l6 6"/></svg>';
  l.innerHTML = `<div class="lockbox"><div class="lockhead"><svg viewBox="0 0 32 32" width="40" height="40"><circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="16" cy="16" r="4.2" fill="var(--accent)"/><path d="M16 1v5M16 26v5M1 16h5M26 16h5" stroke="currentColor" stroke-width="2"/></svg>
      <div class="crumb" style="margin:14px 0 8px">&gt; ORACLE 2 // LOCKED</div><div class="small muted" id="lockMsg"></div>
      <div class="pindots" id="pinDots">${[...Array(PREFS.lock.len || 4)].map(() => '<i></i>').join('')}</div></div>
    <div class="pinpad" id="pinPad">${['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(k => KEY(k)).join('')}${PREFS.lock.cred ? KEY('bio', BIO, 'Fingerprint or face') : '<span></span>'}${KEY('0')}${KEY('del', DEL, 'Delete')}</div>
    <div class="lockfoot"><a onclick="forgotPin()">Forgot PIN?</a></div></div>`;
  $('#pinPad').addEventListener('pointerdown', e => { const b = e.target.closest('.pk'); if (!b) return; e.preventDefault(); b.classList.add('down'); setTimeout(() => b.classList.remove('down'), 140); try { navigator.vibrate?.(8); } catch {} pinKey(b.dataset.k); });
  lockMsg(msg);
}
function lockMsg(msg) {
  const el = $('#lockMsg'); if (!el) return; clearInterval(lockTimer);
  const upd = () => { const w = Math.ceil(((PREFS.lock?.until || 0) - Date.now()) / 1000); if (w > 0) { el.textContent = `Too many tries — wait ${w}s`; el.className = 'small bad'; } else { clearInterval(lockTimer); el.textContent = msg || 'Enter your PIN'; el.className = 'small ' + (msg ? 'warn' : 'muted'); msg = ''; } };
  upd(); if ((PREFS.lock?.until || 0) > Date.now()) lockTimer = setInterval(upd, 500);
}
function pinDots(shake) { const d = $('#pinDots'); if (!d) return; [...d.children].forEach((i, n) => i.classList.toggle('on', n < pinBuf.length)); if (shake) { d.classList.remove('shake'); void d.offsetWidth; d.classList.add('shake'); } }
let pinBusy = false;
async function pinKey(k) {
  if (!LOCKED || pinBusy) return;
  if (k === 'bio') return bioUnlock();
  if (Date.now() < (PREFS.lock.until || 0)) return;
  if (k === 'del') pinBuf = pinBuf.slice(0, -1); else if (pinBuf.length < 8) pinBuf += k;
  pinDots();
  if (pinBuf.length !== (PREFS.lock.len || 4)) return;
  pinBusy = true; const ok = await pinHash(pinBuf, PREFS.lock.salt) === PREFS.lock.hash; pinBusy = false; pinBuf = '';
  if (ok) { PREFS.lock.fails = 0; PREFS.lock.until = 0; savePrefs(); return unlock(); }
  PREFS.lock.fails = (PREFS.lock.fails || 0) + 1;
  if (PREFS.lock.fails >= 5) PREFS.lock.until = Date.now() + 30e3 * 2 ** (PREFS.lock.fails - 5);
  savePrefs(); pinDots(true); try { navigator.vibrate?.([30, 40, 30]); } catch {}
  lockMsg(PREFS.lock.fails >= 5 ? '' : `Wrong PIN — ${5 - PREFS.lock.fails} ${5 - PREFS.lock.fails === 1 ? 'try' : 'tries'} before a short wait`);
}
function unlock() { LOCKED = false; clearInterval(lockTimer); $('#lockLayer')?.remove(); render(); if (UI.pendingDo) { runShortcut(UI.pendingDo); UI.pendingDo = null; } }
async function bioUnlock() {
  if (!LOCKED || !PREFS.lock?.cred) return;
  try { await navigator.credentials.get({publicKey: {challenge: rnd(32), allowCredentials: [{type: 'public-key', id: ub64(PREFS.lock.cred)}], userVerification: 'required', timeout: 60000}}); unlock(); }
  catch { lockMsg('Use your PIN, or tap the fingerprint key to try again'); }
}
function forgotPin() {
  const box = $('#lockLayer .lockbox'); box.classList.add('forgotmode');
  box.innerHTML = SYNC ? `<h2 class="acc" style="font-size:13px;letter-spacing:.08em">FORGOT PIN</h2><div class="small muted" style="margin:8px 0 12px;line-height:1.7">Enter your <b>sync passphrase</b> to remove the PIN from this device. You can set a new one in Settings.</div>
      <input type="password" id="fpPass" style="width:100%" placeholder="Sync passphrase"><div class="row mt"><button class="btn ghost" onclick="showLock()">Back</button><span class="sp"></span><button class="btn pri" onclick="forgotPinCheck()">Remove PIN</button></div>`
    : `<h2 class="acc" style="font-size:13px;letter-spacing:.08em">FORGOT PIN</h2><div class="small muted" style="margin:8px 0 12px;line-height:1.7">Sync isn't on, so the only way in is to <b>erase Oracle 2's data on this device</b> and start fresh (or restore a backup file afterwards).</div>
      <input id="fpErase" style="width:100%" placeholder="Type ERASE"><div class="row mt"><button class="btn ghost" onclick="showLock()">Back</button><span class="sp"></span><button class="btn danger" onclick="forgotPinErase()">Erase this device</button></div>`;
}
function forgotPinCheck() { if (SYNC && $('#fpPass').value === SYNC.pass) { delete PREFS.lock; savePrefs(); applyTheme(); unlock(); toast('PIN removed — set a new one in Settings → Privacy'); } else { $('#fpPass').value = ''; toast('That passphrase doesn\'t match'); } }
async function forgotPinErase() { if ($('#fpErase').value !== 'ERASE') return toast('Type ERASE to confirm'); for (const k of ['data', 'prefs', 'sync', 'notified', 'focusRun']) await idb.del(k).catch(() => {}); location.reload(); }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') hiddenAt = Date.now();
  else if (PREFS.lock && !LOCKED && hiddenAt && Date.now() - hiddenAt >= (+PREFS.lock.after || 0) * 60e3) lockNow();
});
document.addEventListener('keydown', e => { if (!LOCKED || e.target.tagName === 'INPUT') return; if (/^\d$/.test(e.key)) { e.preventDefault(); pinKey(e.key); } else if (e.key === 'Backspace') { e.preventDefault(); pinKey('del'); } }, true);

// ------------------------------------------------------------------ money engine
const catBucket = name => (D.settings.categories.find(c => c.name === name) || {}).bucket || 'wants';
function currentPeriod(at = TODAY) {
  const pcs = D.paychecks.filter(p => p.date <= at).sort((a, b) => a.date < b.date ? -1 : 1);
  const pc = pcs[pcs.length - 1];
  return pc ? periodOf(pc, at) : null;
}
function periodOf(pc, at = TODAY) {
  const next = D.paychecks.filter(p => p.date > pc.date).sort((a, b) => a.date < b.date ? -1 : 1)[0];
  const nextPay = next ? next.date : estNextPayday(pc.date);
  const end = addDays(nextPay, -1);
  const raw = {needs: pc.amount * pc.split.needs / 100, wants: pc.amount * pc.split.wants / 100, savings: pc.amount * pc.split.savings / 100};
  // leftover already moved to savings leaves the spendable budget (wants first, then needs)
  const moved = pc.leftoverMoved || 0, mw = Math.min(moved, raw.wants);
  const b = {needs: raw.needs - (moved - mw), wants: raw.wants - mw, savings: raw.savings};
  return {pc, start: pc.date, end, nextPay, estimated: !next, budget: b, raw, over: at > end};
}
// Ended pay periods whose leftover you haven't reviewed yet. Nothing is ever moved automatically.
function periodsToReview() {
  return D.paychecks.filter(pc => !pc.closed).map(pc => periodOf(pc)).filter(p => p.end < TODAY).sort((a, b) => a.start < b.start ? 1 : -1);
}
const salaryTx = (from, to, bucket) => D.transactions.filter(t => t.source !== 'savings' && t.date >= from && t.date <= to && (!bucket || t.bucket === bucket));
function periodStats(p) {
  const tx = salaryTx(p.start, p.end);
  const spent = {needs: sum(tx.filter(t => t.bucket === 'needs'), t => t.amount), wants: sum(tx.filter(t => t.bucket === 'wants'), t => t.amount), savings: sum(tx.filter(t => t.bucket === 'savings'), t => t.amount)};
  const unpaid = billOccurrences(maxd(p.start, TODAY), p.end).filter(o => !o.paid);
  const committed = sum(unpaid, o => o.r.amount);
  const giftsAside = giftReserve(p.start, p.end), needsLeft = p.budget.needs - spent.needs, wantsLeft = p.budget.wants - spent.wants - giftsAside;
  return {tx, spent, unpaid, committed, giftsAside, needsLeft, wantsLeft, leftover: needsLeft - committed + wantsLeft};
}
function safeToSpend(p) {
  if (!p || p.over) return null;
  const wants = p.budget.wants, ws = monday(TODAY);
  const weekStart = maxd(ws, p.start), weekEnd = mind(addDays(ws, 6), p.end);
  const spentBefore = sum(salaryTx(p.start, addDays(weekStart, -1), 'wants'), t => t.amount);
  const remAtWeek = wants - giftReserve(p.start, p.end) - spentBefore;
  const weekAllow = remAtWeek * (diff(weekStart, weekEnd) + 1) / (diff(weekStart, p.end) + 1);
  const spentPrev = sum(salaryTx(weekStart, addDays(TODAY, -1), 'wants'), t => t.amount);
  const spentToday = sum(salaryTx(TODAY, TODAY, 'wants'), t => t.amount);
  const daysLeft = diff(TODAY, weekEnd) + 1;
  const todayAllow = (weekAllow - spentPrev) / daysLeft;
  return {weekAllow, weekLeft: weekAllow - spentPrev - spentToday, todayAllow, todayLeft: todayAllow - spentToday, spentToday, spentWeek: spentPrev + spentToday, daysLeft, weekStart, weekEnd};
}
const moveVal = m => m.kind === 'withdraw' ? -m.amount : m.amount; // a 'correction' is signed: + adds, − removes
const isCorr = m => m.kind === 'correction';
function savingsBalance(at = '9999', skipId) {
  const dep = sum(D.savingsMoves.filter(m => m.date <= at && m.id !== skipId), moveVal);
  const spent = sum(D.transactions.filter(t => t.source === 'savings' && t.date <= at), t => t.amount);
  return (+D.settings.startingSavings || 0) + dep - spent;
}
function billOccurrences(from, to) {
  const out = [];
  let y = +from.slice(0, 4), m = +from.slice(5, 7);
  while (`${y}-${pad(m)}` <= to.slice(0, 7)) {
    for (const r of D.recurring) {
      if (r.active === false) continue;
      if (r.freq === 'year' && +r.month !== m) continue;
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

// Reads Hevy's text export (and similar formats: other languages, kg/lbs, "40kg × 12", "Сет 1: …").
const MONTHS = {jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12, 'яну': 1, 'фев': 2, 'мар': 3, 'апр': 4, 'май': 5, 'юни': 6, 'юли': 7, 'авг': 8, 'сеп': 9, 'окт': 10, 'ное': 11, 'дек': 12};
function parseDateLine(l) {
  let y, m, d, x;
  if ((x = l.match(/([A-Za-zА-Яа-я]{3})[A-Za-zА-Яа-я]*\.?\s+(\d{1,2}),?\s+(\d{4})/)) && MONTHS[x[1].toLowerCase()]) [m, d, y] = [MONTHS[x[1].toLowerCase()], +x[2], +x[3]];
  else if ((x = l.match(/(\d{1,2})\.?\s+([A-Za-zА-Яа-я]{3})[A-Za-zА-Яа-я]*\.?,?\s+(\d{4})/)) && MONTHS[x[2].toLowerCase()]) [d, m, y] = [+x[1], MONTHS[x[2].toLowerCase()], +x[3]];
  else if ((x = l.match(/(\d{4})-(\d{1,2})-(\d{1,2})/))) [y, m, d] = [+x[1], +x[2], +x[3]];
  else if ((x = l.match(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/))) [d, m, y] = [+x[1], +x[2], +x[3]];
  else return null;
  let h = 12, mi = 0; const t = l.match(/(\d{1,2}):(\d{2})\s*([ap])?\.?\s*m?\.?/i);
  if (t) { h = +t[1]; mi = +t[2]; if (t[3]) { if (/p/i.test(t[3]) && h < 12) h += 12; if (/a/i.test(t[3]) && h === 12) h = 0; } }
  return `${y}-${pad(m)}-${pad(d)}T${pad(h)}:${pad(mi)}`;
}
const SET_WR = /([\d]+(?:[.,]\d+)?)\s*(kg|кг|lbs?)\s*[x×х*]\s*(\d+)/i;
const SET_REPS = /^(?:[^:]{0,20}:\s*)?(\d+)\s*(reps?|повт)/i;
const SET_OTHER = /^(set|сет|серия|w|warm.?up|d|drop|f|failure)\s*\d*\s*:|^\d+\s*[:.)]\s/i; // timed/distance sets → ignored
function parseHevy(text) {
  const out = [];
  const all = text.replace(/\r/g, '').replace(/[  ]/g, ' ').split('\n').map(l => l.trim()).filter(Boolean);
  const isLink = l => /^https?:\/\//i.test(l) || /^@hevy/i.test(l);
  const starts = all.map((l, i) => i + 1 < all.length && parseDateLine(all[i + 1]) && !SET_WR.test(l) && !isLink(l) ? i : -1).filter(i => i >= 0);
  if (!starts.length && all.length) starts.push(0);
  const chunks = starts.map((st, k) => all.slice(st, starts[k + 1] ?? all.length));
  for (const chunk of chunks) {
    const link = (chunk.join('\n').match(/https?:\/\/(www\.)?hevy\.com\/workout\/[A-Za-z0-9]+/i) || [])[0] || null;
    const lines = chunk.filter(l => !isLink(l));
    let title = 'Workout', date = null, i = 0;
    if (lines[0] && !SET_WR.test(lines[0]) && !parseDateLine(lines[0])) { title = lines[0]; i = 1; }
    if (lines[i] && parseDateLine(lines[i]) && !SET_WR.test(lines[i])) { date = parseDateLine(lines[i]); i++; }
    const exercises = []; let cur = null;
    for (; i < lines.length; i++) {
      const l = lines[i], wr = l.match(SET_WR), ro = !wr && l.match(SET_REPS);
      if (wr || ro) {
        if (!cur) { cur = {name: 'Exercise', sets: []}; exercises.push(cur); }
        let w = 0, r = 0;
        if (wr) { w = num(wr[1]); if (/lb/i.test(wr[2])) w = r2(w * 0.4536); r = +wr[3]; } else r = +ro[1];
        cur.sets.push({w, r, warm: /^(w\b|w:|warm)/i.test(l)});
      } else if (SET_OTHER.test(l)) continue;
      else { cur = {name: l, sets: []}; exercises.push(cur); }
    }
    const ex = exercises.filter(e => e.sets.length);
    if (ex.length) out.push({id: uid(), title, date: date || TODAY + 'T12:00', noDate: !date, exercises: ex, link, source: 'hevy-text'});
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
function lineChart(series, {h = 190, fmt = v => nf(v), band = null, yPad = 0.15, unit = '', W = 640} = {}) {
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
function hbars(rows, {fmt = v => nf(v), ref = null} = {}) {
  const max = Math.max(ref ? ref * 1.4 : 0, ...rows.map(r => r.max ?? r.value), 1);
  return `<div class="list">${rows.map(r => `<div data-tip="${esc(r.tip || r.label + ': ' + (r.right != null ? stripTags(r.right) : fmt(r.value)))}" style="margin:6px 0">
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
  for (const m of D.savingsMoves) if (m.date === date && !m.paycheckId) ev.push({k: 'save', g: '↗', c: 'var(--savings)', t: isCorr(m) ? 'Savings correction' : m.kind === 'withdraw' ? 'Savings withdrawal' : (m.note || 'To savings'), s: (isCorr(m) && m.amount > 0 ? '+' : '') + eur(m.amount)});
  for (const o of billOccurrences(date, date)) ev.push({k: 'bill', g: o.paid ? '✓' : '▲', c: o.paid ? 'var(--muted)' : 'var(--warn)', t: o.r.name, s: `${eur(o.r.amount)} · ${o.r.type}${o.paid ? ' · paid' : ''}`});
  for (const p of D.people) { const nb = nextBirthday(p.birthday); const md = (p.birthday || '').slice(-5);
    if (md && date.slice(5) === md) { const by = birthYear(p.birthday); ev.push({k: 'bday', g: '✦', c: 'var(--extra)', t: `${p.name}'s birthday`, s: by ? `turns ${+date.slice(0, 4) - by}` : ''}); } }
  for (const g of D.lifeGoals) { if (g.targetDate === date && g.status !== 'done') ev.push({k: 'goal', g: '◎', c: 'var(--wants)', t: `Goal deadline: ${g.title}`, s: `${Math.round(goalProgress(g) * 100)}% done`}); if (g.doneAt === date) ev.push({k: 'goal', g: '★', c: 'var(--good)', t: `Achieved: ${g.title}`, s: ''}); }
  for (const t of D.tasks) if (t.due === date) ev.push({k: 'task', g: t.done ? '☑' : '□', c: t.done ? 'var(--muted)' : 'var(--text)', t: t.title, s: t.done ? 'done' : ''});
  const hol = holidayOn(date); if (hol) ev.unshift({k: 'holiday', g: '⚑', c: 'var(--bad)', t: hol, s: 'Public holiday in Bulgaria'});
  if (bgOn()) for (const p of D.people) { const n = nameDayOf(p, +date.slice(0, 4)); if (n && n.date === date) ev.push({k: 'nameday', g: '✧', c: 'var(--extra)', t: `${p.name}'s name day`, s: n.feast}); }
  if (date >= TODAY && !trainedOn(date) && planOn(date)) ev.push({k: 'plan', g: '◇', c: 'var(--muted)', t: `Plan: ${planOn(date)}`, s: 'planned workout'});
  for (const g of D.gifts) if (g.date === date && isRecv(g)) ev.push({k: 'gift', g: '❖', c: 'var(--extra)', t: `Received: ${g.item || 'gift'}`, s: `from ${giftWho(g) || '?'}`});
  for (const g of D.gifts) if (g.date === date && !isRecv(g)) ev.push({k: 'gift', g: '❖', c: PAL.wants, t: `Gift: ${giftTitle(g)}`, s: g.status === 'bought' ? `bought · ${eur0(+g.paid || 0)}` : (g.budget ? eur0(+g.budget) + ' planned' : 'planned')});
  for (const m of D.media) if (m.status === 'done' && m.finished === date) ev.push({k: 'media', g: mKind(m.kind)[2], c: 'var(--accent)', t: `Finished: ${m.title}`, s: m.rating ? '★'.repeat(m.rating) : mKind(m.kind)[1]});
  for (const f of D.focus) if (f.date === date) { const x = ev.find(e => e.k === 'focus'); if (x) { x.min += f.min; x.s = hm(x.min); } else ev.push({k: 'focus', g: '◷', c: 'var(--muted)', t: 'Focus', s: hm(f.min), min: f.min}); }
  for (const b of D.body) if (b.date === date) ev.push({k: 'body', g: '○', c: 'var(--muted)', t: 'Body log', s: [b.weight && b.weight + ' kg', b.waist && b.waist + ' cm waist'].filter(Boolean).join(' · ')});
  return ev;
}

function ensureGiftsCategory() { if (!D.settings.categories.some(c => c.name === 'Gifts')) D.settings.categories.push({name: 'Gifts', bucket: 'wants'}); }
// ------------------------------------------------------------------ gifts: plan what you'll spend on people, set it aside from Wants
const OCCASIONS = [['birthday', 'Birthday'], ['nameday', 'Name day'], ['christmas', 'Christmas'], ['wedding', 'Wedding'], ['anniversary', 'Anniversary'], ['other', 'Other event']];
const occName = o => (OCCASIONS.find(x => x[0] === o) || OCCASIONS[5])[1];
const giftWho = g => g.personId ? ((D.people.find(p => p.id === g.personId) || {}).name || g.who || '?') : (g.who || '');
const giftTitle = g => `${giftWho(g) || g.title || 'Gift'}${g.occasion ? ' · ' + (g.occasion === 'other' ? (g.title || 'event') : occName(g.occasion).toLowerCase()) : ''}`;
const isRecv = g => g.dir === 'in';
const giftsPlanned = () => D.gifts.filter(g => !isRecv(g) && g.status !== 'bought');
const giftsReceived = () => D.gifts.filter(isRecv).sort((a, b) => a.date < b.date ? 1 : -1);
// planned (not yet bought) gift budgets dated inside [from, to] — these are set aside from Wants
const giftReserve = (from, to) => sum(giftsPlanned().filter(g => g.date >= from && g.date <= to), g => +g.budget || 0);
function occasionDate(o, p) {
  if (o === 'birthday' && p) return nextBirthday(p.birthday);
  if (o === 'nameday' && p) return (nextNameDay(p) || {}).date || null;
  if (o === 'christmas') { const c = TODAY.slice(0, 4) + '-12-25'; return c >= TODAY ? c : (+TODAY.slice(0, 4) + 1) + '-12-25'; }
  return null;
}
const hasGiftFor = (pid, occ, date) => D.gifts.some(g => !isRecv(g) && g.personId === pid && g.occasion === occ && g.date === date);
// occasions in the next `days` days that have no gift planned yet
function giftGaps(days = 45) {
  const out = [], lim = addDays(TODAY, days);
  for (const p of D.people) {
    const nb = nextBirthday(p.birthday); if (nb && nb <= lim && !hasGiftFor(p.id, 'birthday', nb)) out.push({p, occ: 'birthday', date: nb});
    const nd = nextNameDay(p); if (nd && nd.date <= lim && !hasGiftFor(p.id, 'nameday', nd.date)) out.push({p, occ: 'nameday', date: nd.date});
  }
  return out.sort((a, b) => a.date < b.date ? -1 : 1);
}
// fields shared by "received as a gift" (wishlist) and "+ Received gift" (Records → Gifts)
function recvFields(g = {}) {
  return `<label class="f">From<select id="rg_p" onchange="$('#rg_whow').style.display=this.value?'none':''"><option value="">— someone not in People —</option>${D.people.slice().sort((a, b) => a.name.localeCompare(b.name)).map(x => `<option value="${x.id}" ${g.personId === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
    <label class="f" id="rg_whow" style="${g.personId ? 'display:none' : ''}">Name<input id="rg_who" value="${esc(g.who || '')}" placeholder="who gave it"></label>
    <label class="f">Date<input type="date" id="rg_d" value="${g.date || TODAY}"></label>
    <label class="f">Occasion (optional)<select id="rg_o"><option value="">—</option>${OCCASIONS.map(([k, l]) => `<option value="${k}" ${g.occasion === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="f">What<input id="rg_i" value="${esc(g.item || '')}" placeholder="the gift"></label>
    <label class="f">Worth about (€, optional)<input type="number" inputmode="decimal" step="0.01" id="rg_w" value="${g.worth || ''}"></label>`;
}
function recvRead() {
  const g = {personId: val('rg_p'), who: val('rg_p') ? '' : val('rg_who'), date: val('rg_d') || TODAY, occasion: val('rg_o'), item: val('rg_i'), worth: val('rg_w') === '' ? null : r2(num(val('rg_w')))};
  if (!g.personId && !g.who) { toast('Who gave it to you?'); return null; } return g;
}
function giftsBody(q) {
  const yr = TODAY.slice(0, 4), per = currentPeriod(), match = g => !q || (giftTitle(g) + ' ' + (g.idea || '')).toLowerCase().includes(q);
  const plan = giftsPlanned().filter(match).sort((a, b) => a.date < b.date ? -1 : 1), given = D.gifts.filter(g => !isRecv(g) && g.status === 'bought' && match(g)).sort((a, b) => (a.boughtAt || a.date) < (b.boughtAt || b.date) ? 1 : -1);
  const spentYr = sum(D.transactions.filter(t => t.category === 'Gifts' && t.date.startsWith(yr)), t => t.amount), gaps = giftGaps(45);
  const byP = {}; for (const t of D.transactions.filter(t => t.category === 'Gifts' && t.date.startsWith(yr))) { const g = D.gifts.find(x => x.txId === t.id), k = g ? giftWho(g) || 'Other' : 'Other'; byP[k] = (byP[k] || 0) + t.amount; }
  for (const g of giftsPlanned().filter(g => g.date.startsWith(yr))) { const k = giftWho(g) || 'Other'; byP[k] = (byP[k] || 0) + (+g.budget || 0); }
  const dd = d => { const n = diff(TODAY, d); return n < 0 ? `<span class="bad">${-n}d ago</span>` : n === 0 ? '<span class="acc">today</span>' : `in ${n}d`; };
  const prow = g => `<div class="li wrow"><span class="small muted" style="width:62px">${fd(g.date)}</span><span class="t" style="white-space:normal;cursor:pointer" onclick="A.gift('${g.id}')">${esc(giftTitle(g))}${g.idea ? `<div class="small faint">${esc(g.idea)}</div>` : ''}</span><span class="small muted hide-m">${dd(g.date)}</span><span>${eur(+g.budget || 0)}</span><button class="btn sm" onclick="A.giftBuy('${g.id}')">Bought</button></div>`;
  return `<div class="grid g4" style="margin-bottom:16px">
      <div class="card stat hero"><div class="lbl">Set aside now</div><div class="val">${eur0(per ? giftReserve(per.start, per.end) : 0)}</div><div class="sub">gifts due this pay period — taken out of Wants</div></div>
      <div class="card stat"><div class="lbl">Next 30 days</div><div class="val">${eur0(giftReserve(TODAY, addDays(TODAY, 30)))}</div><div class="sub">${(n => `${n} gift${n === 1 ? '' : 's'} planned`)(giftsPlanned().filter(g => g.date >= TODAY && g.date <= addDays(TODAY, 30)).length)}</div></div>
      <div class="card stat"><div class="lbl">Gifts ${yr}</div><div class="val">${eur0(spentYr)}</div><div class="sub">spent · ${eur0(giftReserve(TODAY, yr + '-12-31'))} still planned</div></div>
      <div class="card stat"><div class="lbl">No gift planned</div><div class="val ${gaps.length ? 'warn' : ''}">${gaps.length}</div><div class="sub">occasions in the next 45 days</div></div></div>
    <div class="grid g21"><div class="grid" style="align-content:start">
      ${gaps.length ? `<div class="card briefing"><h3>Coming up — no gift yet</h3><div class="list">${gaps.map(x => `<div class="li wrow"><span class="small muted" style="width:62px">${fd(x.date)}</span><span class="t">${esc(x.p.name)} <span class="muted small">· ${occName(x.occ).toLowerCase()}</span>${x.p.gifts ? `<div class="small faint">ideas: ${esc(x.p.gifts)}</div>` : ''}</span><span class="small muted hide-m">${dd(x.date)}</span><button class="btn sm pri" onclick="A.gift(null,{personId:'${x.p.id}',occasion:'${x.occ}',date:'${x.date}'})">Plan gift</button></div>`).join('')}</div></div>` : ''}
      <div class="card"><h3>Planned · ${plan.length} <span class="act muted">${eur0(sum(plan, g => +g.budget || 0))}</span></h3><div class="list">${plan.map(prow).join('') || '<div class="empty">Plan a gift for a birthday, name day, Christmas or any event — its budget is set aside from Wants in that pay period.</div>'}</div></div>
      <div class="card"><h3>Given · ${given.length}</h3><div class="list">${given.slice(0, 20).map(g => `<div class="li wrow"><span class="small muted" style="width:62px">${fd(g.boughtAt || g.date)}</span><span class="t" style="cursor:pointer" onclick="A.gift('${g.id}')">${esc(giftTitle(g))}${g.idea ? ` <span class="small faint">· ${esc(g.idea)}</span>` : ''}</span><span>${eur(+g.paid || 0)}</span><span class="small ${(+g.paid || 0) > (+g.budget || 0) && g.budget ? 'warn' : 'faint'} hide-m" style="width:78px;text-align:right">${g.budget ? 'budget ' + eur0(+g.budget) : ''}</span></div>`).join('') || '<div class="empty small">—</div>'}</div></div></div>
      <div class="card"><h3>Received · ${giftsReceived().length} <span class="act"><button class="btn sm" onclick="A.recvGift()">+ Received gift</button></span></h3><div class="list">${giftsReceived().filter(match).slice(0, 25).map(g => `<div class="li wrow" style="cursor:pointer" onclick="A.recvGift('${g.id}')"><span class="small muted" style="width:62px">${fd(g.date)}</span><span class="t" style="white-space:normal">${esc(g.item || 'Gift')}<div class="small faint">from ${esc(giftWho(g) || '?')}${g.occasion ? ' · ' + (g.occasion === 'other' ? (g.title || 'event') : occName(g.occasion).toLowerCase()) : ''}${g.wishId ? ' · from your wishlist' : ''}</div></span><span class="small muted">${g.worth ? '≈ ' + eur0(+g.worth) : ''}</span></div>`).join('') || '<div class="empty small">Gifts you get — from your wishlist or not — are listed here, so you remember who gave you what.</div>'}</div></div></div>
      <div class="grid" style="align-content:start"><div class="card"><h3>By person · ${yr}</h3>${Object.keys(byP).length ? hbars(Object.entries(byP).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([l, v]) => ({label: l, value: v, color: PAL.wants, right: eur0(v)}))) : '<div class="empty small">Spent and planned gifts per person show here</div>'}
        <div class="small faint mt">Includes gifts still planned this year.</div></div>
      <div class="card"><h3>How it works</h3><div class="small muted" style="line-height:1.8">Plan a gift with a budget → that amount is <b>set aside from Wants</b> in the pay period of the gift's date, so "safe to spend" already accounts for it.<br>Press <b>Bought</b> → it becomes a <b>Gifts</b> expense and the set-aside amount is released.<br>Gift ideas from each person's card are filled in for you.</div></div></div></div>`;
}

const V = {};
// ------------------------------------------------------------------ Bulgarian holidays & name days
const bgOn = () => D.settings.bgCalendar !== false;
const holidayOn = d => bgOn() ? BG.holidays(+d.slice(0, 4))[d] || null : null;
const feastsOn = d => bgOn() ? (BG.list(+d.slice(0, 4))[d] || []) : [];
const nameDayOf = (p, y = +TODAY.slice(0, 4)) => bgOn() ? personNameDay(p, y) : null;
function nextNameDay(p) { for (const y of [+TODAY.slice(0, 4), +TODAY.slice(0, 4) + 1]) { const n = nameDayOf(p, y); if (n && n.date >= TODAY) return n; } return null; }
// keep in touch
function touchDue(p) { if (!(+p.keepEvery > 0)) return null; const last = p.lastContact || p.keepSince || TODAY; return addDays(last, 7 * p.keepEvery); }
const touchList = () => D.people.filter(p => +p.keepEvery > 0).map(p => ({p, due: touchDue(p)})).sort((a, b) => a.due < b.due ? -1 : 1);

// ------------------------------------------------------------------ training plan (fixed weekdays, Mon = 0)
const TR_TEMPLATES = [['Push / Pull / Legs', {0: 'Push', 2: 'Pull', 4: 'Legs'}], ['Upper / Lower', {0: 'Upper', 1: 'Lower', 3: 'Upper', 4: 'Lower'}], ['Full body ×3', {0: 'Full body', 2: 'Full body', 4: 'Full body'}], ['PPL ×2', {0: 'Push', 1: 'Pull', 2: 'Legs', 3: 'Push', 4: 'Pull', 5: 'Legs'}], ['Bro split', {0: 'Chest', 1: 'Back', 2: 'Legs', 3: 'Shoulders', 4: 'Arms'}]];
const trDays = () => (D.settings.training || {}).days || {};
const planOn = d => trDays()[dowi(d)] || null;
const trainedOn = d => D.workouts.some(w => w.date.slice(0, 10) === d);
function trAdherence(weeks = 8) {
  const out = [], ms = monday(TODAY);
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = addDays(ms, -7 * i), days = [...Array(7)].map((_, j) => addDays(ws, j));
    const planned = days.filter(d => planOn(d) && d <= TODAY).length, done = days.filter(d => d <= TODAY && trainedOn(d)).length;
    out.push({ws, days, planned, done, hit: Math.min(done, planned)});
  }
  return out;
}
V.gym_plan = () => {
  const days = trDays(), any = Object.values(days).some(Boolean), A8 = trAdherence(8), cur = A8[A8.length - 1];
  const pl = sum(A8.slice(0, -1), w => w.planned), ht = sum(A8.slice(0, -1), w => w.hit);
  const grid = A8.slice(-4).map(w => `<div class="row small" style="gap:4px;margin:4px 0"><span class="muted" style="width:56px">${fd(w.ws)}</span>${w.days.map(d => { const p = planOn(d), t = trainedOn(d), fut = d > TODAY;
    const [g, c, tip] = fut ? (p ? ['◇', 'var(--muted)', p + ' (planned)'] : ['·', 'var(--faint)', 'rest']) : p ? (t ? ['✓', 'var(--good)', p + ' — done'] : ['✗', 'var(--bad)', p + ' — missed']) : t ? ['◆', 'var(--accent)', 'extra workout'] : ['·', 'var(--faint)', 'rest'];
    return `<span class="trc" style="color:${c}" data-tip="${esc(DOW[dowi(d)] + ' ' + fd(d) + '\n' + tip)}">${g}</span>`; }).join('')}<span class="sp"></span><span class="muted">${w.hit}/${w.planned}</span></div>`).join('');
  return `<div class="grid g21"><div class="card"><h3>Weekly plan <span class="act faint small" style="text-transform:none;letter-spacing:0">synced to all your devices</span></h3>
    <div class="list">${WEEKDAYS.map((d, i) => `<div class="li"><span style="width:96px" class="${dowi(TODAY) === i ? 'acc' : 'muted'}">${d}</span><input style="flex:1;min-width:0" placeholder="Rest day" value="${esc(days[i] || '')}" onchange="A.trDay(${i},this.value)"></div>`).join('')}</div>
    <div class="small muted mt">Type a workout name for each training day, leave rest days empty.</div>
    <div class="qk" style="margin-top:14px">Start from a template</div><div class="row wrap" style="gap:6px;margin-top:6px">${TR_TEMPLATES.map(([n], i) => `<button class="btn sm" onclick="A.trTemplate(${i})">${n}</button>`).join('')}${any ? '<button class="btn sm ghost danger" onclick="A.trTemplate(-1)">Clear</button>' : ''}</div></div>
    <div class="grid" style="align-content:start"><div class="card stat hero"><div class="lbl">Today</div><div class="val" style="font-size:22px">${planOn(TODAY) ? esc(planOn(TODAY)) : 'Rest day'}</div><div class="sub">${planOn(TODAY) ? (trainedOn(TODAY) ? '<span class="good">✓ done</span>' : 'planned — import it afterwards to tick it off') : 'recover, walk, stretch'}</div></div>
    <div class="card"><h3>Sticking to the plan</h3>${any ? `<div class="row" style="align-items:baseline;gap:8px"><span class="big">${pl ? Math.round(ht / pl * 100) : 0}%</span><span class="muted small">of planned workouts done · last 7 weeks</span></div>
      <div class="small muted" style="margin:4px 0 8px">This week: ${cur.done} of ${Object.values(days).filter(Boolean).length} so far</div>${grid}
      <div class="legend mt"><span><b style="color:var(--good);font-weight:400">✓</b>done</span><span><b style="color:var(--bad);font-weight:400">✗</b>missed</span><span><b style="color:var(--accent);font-weight:400">◆</b>extra</span><span><b style="color:var(--muted);font-weight:400">◇</b>coming</span></div>` : '<div class="empty small">Set your plan to see how well you stick to it.</div>'}</div></div></div>`;
};

// ------------------------------------------------------------------ focus timer (state per device; sessions synced)
let FOCUS = null; // {start, end, min, label, goalId, mode, pausedLeft}
const FOCUS_PRESETS = [['Pomodoro', 25, 5], ['Long', 50, 10], ['Short', 15, 3]];
const focusLeft = () => !FOCUS ? 0 : FOCUS.pausedLeft != null ? FOCUS.pausedLeft : Math.max(0, FOCUS.end - Date.now());
const mmss = ms => { const s = Math.ceil(ms / 1000); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };
function focusStart(min, label, goalId) {
  min = Math.max(1, Math.min(240, +min || 25));
  FOCUS = {start: Date.now(), end: Date.now() + min * 60e3, min, label: (label || '').trim() || 'Focus', goalId: goalId || '', mode: 'focus'};
  store.set('focusRun', FOCUS); if (!D.settings.focusLabels?.includes(FOCUS.label)) { D.settings.focusLabels = [FOCUS.label, ...(D.settings.focusLabels || [])].slice(0, 8); save(); }
  render();
}
function focusBreak(min) { FOCUS = {start: Date.now(), end: Date.now() + min * 60e3, min, mode: 'break'}; store.set('focusRun', FOCUS); render(); }
function focusPause() { if (!FOCUS) return; if (FOCUS.pausedLeft != null) { FOCUS.end = Date.now() + FOCUS.pausedLeft; delete FOCUS.pausedLeft; } else FOCUS.pausedLeft = focusLeft(); store.set('focusRun', FOCUS); render(); }
function focusStop(save_ = true) {
  if (!FOCUS) return;
  const doneMin = Math.round((FOCUS.min * 60e3 - focusLeft()) / 60e3);
  if (save_ && FOCUS.mode === 'focus' && doneMin >= 1) { D.focus.push({id: uid(), date: TODAY, at: new Date(FOCUS.start).toTimeString().slice(0, 5), min: doneMin, label: FOCUS.label, goalId: FOCUS.goalId}); save(); toast(`${doneMin} min of focus saved`); }
  FOCUS = null; idb.del('focusRun').catch(() => {}); render();
}
function focusTick() {
  if (!FOCUS || FOCUS.pausedLeft != null) return;
  const el = $('#focusClock'); if (el) { el.textContent = mmss(focusLeft()); const r = $('#focusRing'); if (r) r.style.setProperty('--p', 1 - focusLeft() / (FOCUS.min * 60e3)); }
  document.title = `${mmss(focusLeft())} · ${FOCUS.mode === 'break' ? 'Break' : FOCUS.label} — Oracle 2`;
  if (focusLeft() <= 0) {
    const was = FOCUS.mode, lab = FOCUS.label; focusStop(true); document.title = 'Oracle 2';
    try { const ac = new AudioContext(), o = ac.createOscillator(), g = ac.createGain(); o.connect(g); g.connect(ac.destination); o.frequency.value = 880; g.gain.setValueAtTime(.15, ac.currentTime); g.gain.exponentialRampToValueAtTime(.001, ac.currentTime + 1.2); o.start(); o.stop(ac.currentTime + 1.2); } catch {}
    if ('Notification' in window && Notification.permission === 'granted') navigator.serviceWorker?.ready.then(r => r.showNotification(was === 'break' ? 'Break over' : 'Focus session done', {body: was === 'break' ? 'Ready for the next one?' : `${lab} — time for a short break.`, icon: 'icon-192.png', tag: 'focus'})).catch(() => {});
    if (was === 'focus') modal(`<h2>Session done ✓</h2><div class="small muted">${esc(lab)} — saved. Take a break?</div><div class="row wrap mt">${[5, 10, 15].map(m => `<button class="btn" onclick="closeModal();focusBreak(${m})">${m} min break</button>`).join('')}<span class="sp"></span><button class="btn ghost" onclick="closeModal()">Skip</button></div>`);
    else toast('Break over');
  }
}
const focusMin = (from, to, f = () => true) => sum(D.focus.filter(s => s.date >= from && s.date <= to && f(s)), s => s.min);
const hm = m => m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? (m % 60) + 'm' : ''}`.trim() : `${m}m`;
V.goals_focus = () => {
  const ws = monday(TODAY), act = D.lifeGoals.filter(g => g.status === 'active'), labels = D.settings.focusLabels || [];
  const pre = UI.focusPre || {min: 25, label: labels[0] || '', goalId: ''};
  const running = FOCUS ? `<div class="focusbox"><div class="ring" id="focusRing" style="--p:${1 - focusLeft() / (FOCUS.min * 60e3)}"><div><div class="small muted">${FOCUS.mode === 'break' ? 'BREAK' : esc(FOCUS.label).toUpperCase()}</div><div id="focusClock" class="fclock">${mmss(focusLeft())}</div>${FOCUS.goalId ? `<div class="small faint">${esc((D.lifeGoals.find(g => g.id === FOCUS.goalId) || {}).title || '')}</div>` : ''}</div></div>
      <div class="row wrap mt" style="justify-content:center"><button class="btn" onclick="focusPause()">${FOCUS.pausedLeft != null ? 'Resume' : 'Pause'}</button><button class="btn pri" onclick="focusStop(true)">${FOCUS.mode === 'break' ? 'End break' : 'Finish & save'}</button><button class="btn ghost danger" onclick="focusStop(false)">Discard</button></div>
      <div class="small faint mt" style="text-align:center">Keeps counting if you switch apps or lock the phone.</div></div>`
    : `<div class="formgrid"><label class="f full">What are you working on?<input id="fc_label" list="fcLabels" value="${esc(pre.label)}" placeholder="Study, Blender, reading…"><datalist id="fcLabels">${labels.map(l => `<option value="${esc(l)}">`).join('')}</datalist></label>
      <label class="f">Minutes<input type="number" inputmode="numeric" id="fc_min" min="1" max="240" value="${pre.min}"></label>
      <label class="f">Counts toward goal<select id="fc_goal"><option value="">— none —</option>${act.map(g => `<option value="${g.id}" ${pre.goalId === g.id ? 'selected' : ''}>${esc(g.title)}</option>`).join('')}</select></label></div>
      <div class="row wrap mt">${FOCUS_PRESETS.map(([n, m]) => `<button class="btn sm" onclick="$('#fc_min').value=${m}">${n} ${m}</button>`).join('')}<span class="sp"></span><button class="btn pri" onclick="UI.focusPre={min:+val('fc_min'),label:val('fc_label'),goalId:val('fc_goal')};focusStart(val('fc_min'),val('fc_label'),val('fc_goal'))">▶ Start</button></div>`;
  const days = [...Array(14)].map((_, i) => addDays(TODAY, i - 13));
  const byL = {}; for (const s of D.focus.filter(s => s.date >= addDays(TODAY, -29))) byL[s.label] = (byL[s.label] || 0) + s.min;
  const recent = D.focus.slice().sort((a, b) => (a.date + a.at) < (b.date + b.at) ? 1 : -1).slice(0, 8);
  return `<div class="grid g4"><div class="card stat hero"><div class="lbl">Focus today</div><div class="val">${hm(focusMin(TODAY, TODAY))}</div><div class="sub">${D.focus.filter(s => s.date === TODAY).length} sessions</div></div>
    <div class="card stat"><div class="lbl">This week</div><div class="val">${hm(focusMin(ws, TODAY))}</div><div class="sub">last week ${hm(focusMin(addDays(ws, -7), addDays(ws, -1)))}</div></div>
    <div class="card stat"><div class="lbl">Last 30 days</div><div class="val">${hm(focusMin(addDays(TODAY, -29), TODAY))}</div><div class="sub">${(focusMin(addDays(TODAY, -29), TODAY) / 30).toFixed(0)} min a day</div></div>
    <div class="card stat"><div class="lbl">Streak</div><div class="val">${(() => { let n = 0, d = D.focus.some(s => s.date === TODAY) ? TODAY : addDays(TODAY, -1); while (D.focus.some(s => s.date === d)) { n++; d = addDays(d, -1); } return n; })()}</div><div class="sub">days in a row</div></div></div>
    <div class="grid g21 mt"><div class="card"><h3>Focus timer</h3>${running}</div>
    <div class="grid" style="align-content:start"><div class="card"><h3>Last 14 days</h3>${columns(days.map(d => ({label: fd(d).split(' ')[0], value: focusMin(d, d), tip: `${fd(d)}: ${hm(focusMin(d, d))}`, color: d === TODAY ? 'var(--accent)' : 'var(--accent-dim)'})), {h: 140, fmt: v => Math.round(v) + 'm'})}</div>
    <div class="card"><h3>By label · 30 days</h3>${Object.keys(byL).length ? hbars(Object.entries(byL).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([l, m]) => ({label: l, value: m, color: 'var(--accent)', right: hm(m)}))) : '<div class="empty small">No sessions yet</div>'}</div>
    <div class="card"><h3>Recent</h3><div class="list">${recent.map(s => `<div class="li small"><span class="muted" style="width:86px">${fd(s.date)} ${s.at || ''}</span><span class="t">${esc(s.label)}</span><span>${hm(s.min)}</span><button class="btn sm ghost danger" title="Delete" onclick="A.del('focus','${s.id}')">×</button></div>`).join('') || '<div class="empty small">—</div>'}</div></div></div></div>`;
};

// ------------------------------------------------------------------ media log
const MEDIA_KINDS = [['book', 'Book', '▤'], ['comic', 'Comic / manga', '▥'], ['game', 'Game', '◈'], ['film', 'Film', '▶'], ['series', 'Series', '▷']];
const MEDIA_ST = [['backlog', 'Want to'], ['active', 'In progress'], ['done', 'Finished'], ['dropped', 'Dropped']];
const mKind = k => MEDIA_KINDS.find(x => x[0] === k) || MEDIA_KINDS[0];
const stars = n => n ? '★'.repeat(n) + '<span class="faint">' + '★'.repeat(5 - n) + '</span>' : '';
function mediaBody(q) {
  const f = UI.mediaSt || 'active', kf = UI.mediaKind || '';
  const all = D.media.filter(m => (!kf || m.kind === kf) && (!q || JSON.stringify(m).toLowerCase().includes(q)));
  const list = all.filter(m => m.status === f).sort((a, b) => ((b.finished || b.started || b.added || '') > (a.finished || a.started || a.added || '') ? 1 : -1));
  const yr = D.media.filter(m => m.status === 'done' && (m.finished || '').startsWith(TODAY.slice(0, 4)));
  const row = m => { const k = mKind(m.kind); return `<div class="li" style="cursor:pointer" onclick="A.media('${m.id}')"><span class="acc" style="width:16px" title="${k[1]}">${k[2]}</span><span class="t" style="white-space:normal">${esc(m.title)}${m.creator ? ` <span class="muted small">· ${esc(m.creator)}</span>` : ''}${m.progress ? ` <span class="tag">${esc(m.progress)}</span>` : ''}</span>
    <span class="small" style="color:var(--gold,#d8b45a)">${stars(+m.rating)}</span><span class="small muted hide-m" style="width:70px;text-align:right">${m.status === 'done' && m.finished ? fd(m.finished) : m.status === 'active' && m.started ? 'since ' + fd(m.started) : ''}</span>
    ${m.status === 'active' ? `<button class="btn sm" onclick="event.stopPropagation();A.mediaDone('${m.id}')">Finished</button>` : m.status === 'backlog' ? `<button class="btn sm" onclick="event.stopPropagation();A.mediaStart('${m.id}')">Start</button>` : ''}</div>`; };
  return `<div class="grid g4" style="margin-bottom:16px">${MEDIA_KINDS.slice(0, 4).map(([k, l, g]) => `<div class="card stat"><div class="lbl">${g} ${{book: 'Books', comic: 'Comics', game: 'Games', film: 'Films & series'}[k]} ${TODAY.slice(0, 4)}</div><div class="val">${yr.filter(m => m.kind === k || (k === 'film' && m.kind === 'series')).length}</div><div class="sub">finished</div></div>`).join('')}</div>
    <div class="row wrap" style="margin-bottom:12px;gap:8px"><span class="seg">${MEDIA_ST.map(([k, l]) => `<button class="${f === k ? 'on' : ''}" onclick="UI.mediaSt='${k}';render()">${l} <span class="faint">${all.filter(m => m.status === k).length}</span></button>`).join('')}</span>
      <select onchange="UI.mediaKind=this.value;render()"><option value="">All kinds</option>${MEDIA_KINDS.map(([k, l]) => `<option value="${k}" ${kf === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="card"><div class="list">${list.map(row).join('') || `<div class="empty">${f === 'backlog' ? 'Add books, games, films you want to get to.' : f === 'active' ? 'Nothing in progress. Start something from “Want to”.' : 'Nothing here yet.'}</div>`}</div></div>`;
}

// ------------------------------------------------------------------ net worth & investments
const ASSET_KINDS = [['bank', 'Bank account'], ['invest', 'Investments / ETFs'], ['crypto', 'Crypto'], ['pension', 'Pension'], ['property', 'Property'], ['cash', 'Cash'], ['other', 'Other asset'], ['debt', 'Loan / debt']];
const assetVal = (a, at = '9999') => { const v = (a.values || []).filter(x => x.date <= at).sort((x, y) => x.date < y.date ? -1 : 1).pop(); return v ? +v.value : 0; };
const assetSign = a => a.kind === 'debt' ? -1 : 1;
const assetContrib = a => sum(D.transactions.filter(t => t.assetId === a.id), t => t.amount);
function netWorth(at = '9999') { return savingsBalance(at) + sum(D.assets.filter(a => !a.closed), a => assetSign(a) * assetVal(a, at)); }
V.money_networth = () => {
  const as = D.assets.filter(a => !a.closed), nw = netWorth(), owned = sum(as.filter(a => a.kind !== 'debt'), assetVal) + savingsBalance(), owed = sum(as.filter(a => a.kind === 'debt'), assetVal);
  const dates = [...new Set(D.assets.flatMap(a => (a.values || []).map(v => v.date)))].sort();
  const marks = new Set([...dates.filter(x => x <= TODAY), TODAY]); for (let d = dates[0] || TODAY; d < TODAY; d = ymAdd(d.slice(0, 7), 1) + '-01') marks.add(d);
  const pts = dates.length ? [...marks].sort().map(x => ({x, y: r2(netWorth(x))})) : [];
  const m3 = netWorth(addDays(TODAY, -90)), stale = as.filter(a => { const l = (a.values || []).map(v => v.date).sort().pop(); return !l || diff(l, TODAY) > 35; });
  const card = a => { const v = assetVal(a), c = assetContrib(a), last = (a.values || []).map(x => x.date).sort().pop();
    return `<div class="li" style="cursor:pointer" onclick="A.asset('${a.id}')"><span class="t" style="white-space:normal">${esc(a.name)} <span class="tag">${(ASSET_KINDS.find(k => k[0] === a.kind) || ASSET_KINDS[6])[1]}</span>${c ? `<div class="small muted">put in ${eur0(c)} · ${v - c >= 0 ? '<span class="good">+' : '<span class="bad">−'}${eur0(Math.abs(v - c)).replace('−', '')}</span> (${c ? Math.round((v - c) / c * 100) : 0}%)</div>` : ''}<div class="small faint">updated ${last ? fd(last) + ' ' + last.slice(0, 4) : 'never'}</div></span><span class="${a.kind === 'debt' ? 'bad' : ''}">${a.kind === 'debt' ? '−' : ''}${eur(v).replace('−', '')}</span></div>`; };
  return `<div class="grid g4"><div class="card stat hero"><div class="lbl">Net worth</div><div class="val ${nw < 0 ? 'bad' : ''}">${eur0(nw)}</div><div class="sub">${dates.length ? delta(nw, m3, eur0, false).replace('vs last month', 'vs 3 months ago') : 'add what you own and owe'}</div></div>
    <div class="card stat"><div class="lbl">Own</div><div class="val">${eur0(owned)}</div><div class="sub">incl. ${eur0(savingsBalance())} Oracle savings</div></div>
    <div class="card stat"><div class="lbl">Owe</div><div class="val">${eur0(owed)}</div><div class="sub">loans & debts</div></div>
    <div class="card stat"><div class="lbl">Invested</div><div class="val">${eur0(sum(as, assetContrib))}</div><div class="sub">from Investing expenses</div></div></div>
    ${stale.length ? `<div class="card briefing mt"><div class="row wrap"><div><div class="acc">▸ ${stale.length} value${stale.length > 1 ? 's' : ''} not updated this month</div><div class="small muted">Takes a minute: type today's balances.</div></div><span class="sp"></span><button class="btn pri" onclick="A.assetUpdate()">Update values</button></div></div>` : ''}
    <div class="grid g21 mt"><div class="card"><h3>Net worth over time</h3>${pts.length > 1 ? lineChart([{points: pts, color: 'var(--accent)'}], {h: 220, W: 640, fmt: v => eur(v, 0)}) : '<div class="empty">Update values once a month to see the trend</div>'}</div>
    <div class="card"><h3>Accounts <span class="act"><button class="btn sm" onclick="A.assetUpdate()">Update values</button><button class="btn sm pri" onclick="A.asset()">+ Add</button></span></h3><div class="list">
      <div class="li"><span class="t">Oracle savings <div class="small faint">from your paychecks & moves</div></span><span>${eur(savingsBalance())}</span></div>${as.map(card).join('')}</div>
      ${!as.length ? '<div class="small muted mt">Add bank accounts, ETFs, crypto, pension or a loan. Tip: when you log an expense under <b>Investing</b>, pick the account it went into to track gains.</div>' : ''}</div></div>`;
};

// ------------------------------------------------------------------ subscriptions: yearly billing, price history, yearly check-up
const perMonth = r => r.freq === 'year' ? r.amount / 12 : r.amount;
const perYear = r => r.freq === 'year' ? r.amount : r.amount * 12;
const needsReview = r => r.type === 'subscription' && r.active !== false && (!r.reviewed || diff(r.reviewed, TODAY) >= 365) && diff(r.startDate || TODAY, TODAY) >= 300;

// ------------------------------------------------------------------ views

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
  for (const o of billOccurrences(TODAY, addDays(TODAY, Math.max(lead, 14)))) if (!o.paid) up.push({d: o.date, g: '▲', c: 'var(--warn)', t: `${o.r.name}${o.r.freq === 'year' ? ' (yearly)' : ''}`, s: eur(o.r.amount), bill: o});
  if (bgOn()) { for (let i = 0; i <= 14; i++) { const d = addDays(TODAY, i), h = holidayOn(d); if (h) up.push({d, g: '⚑', c: 'var(--bad)', t: h, s: 'day off'}); }
    for (const pp of D.people) { const n = nextNameDay(pp); if (n && diff(TODAY, n.date) <= 14) up.push({d: n.date, g: '✧', c: 'var(--extra)', t: `${pp.name}'s name day`, s: n.feast}); } }
  for (const g of giftsPlanned()) if (diff(TODAY, g.date) <= Math.max(lead, 14)) up.push({d: g.date < TODAY ? TODAY : g.date, g: '❖', c: PAL.wants, t: `Gift: ${giftTitle(g)}`, s: g.budget ? eur0(+g.budget) + ' set aside' : 'no budget', gift: g});
  for (const {p: pp, due} of touchList()) if (diff(TODAY, due) <= 3) up.push({d: due < TODAY ? TODAY : due, g: '☏', c: 'var(--accent)', t: `Catch up with ${pp.name}`, s: pp.lastContact ? `last talked ${fd(pp.lastContact)}` : `every ${pp.keepEvery} wk`, touch: pp});
  for (const t of D.tasks) if (!t.done && t.due && t.due <= addDays(TODAY, Math.max(14, +t.remindBefore || 0))) up.push({d: t.due, g: '□', c: t.due < TODAY ? 'var(--bad)' : 'var(--text)', t: t.title, s: t.due < TODAY ? 'overdue' : '', task: t});
  up.sort((a, b) => a.d < b.d ? -1 : 1);
  for (const g of D.lifeGoals) if (g.status === 'active' && g.targetDate && g.targetDate >= TODAY && diff(TODAY, g.targetDate) <= Math.max(lead, 14)) up.push({d: g.targetDate, g: '◎', c: 'var(--wants)', t: `Goal: ${g.title}`, s: `${Math.round(goalProgress(g) * 100)}% done`});
  up.sort((a, b) => a.d < b.d ? -1 : 1);
  const actG = D.lifeGoals.filter(g => g.status === 'active').sort((a, b) => (goalDueToday(b) - goalDueToday(a)) || ((a.targetDate || '9') < (b.targetDate || '9') ? -1 : 1));
  const goalsCard = actG.length ? `<div class="card"><h3>Goals <span class="act"><a class="small acc" style="cursor:pointer;text-transform:none;letter-spacing:0" onclick="go('goals')">all ${actG.length} →</a></span></h3>${actG.slice(0, 4).map(g => { const pc = Math.round(goalProgress(g) * 100), due = goalDueToday(g);
    return `<div style="margin:8px 0;cursor:pointer" onclick="${due ? `A.goalCheckin('${g.id}')` : `go('goals')`}"><div class="row small"><span class="t" style="flex:1">${esc(g.title)}</span>${due ? '<span class="tag" style="color:var(--accent);border-color:var(--accent-dim)">check in</span>' : ''}<span class="muted">${g.kind === 'simple' ? (g.targetDate ? `${diff(TODAY, g.targetDate)}d left` : '') : pc + '%'}</span></div>${g.kind !== 'simple' ? `<div class="meter" style="height:5px;margin-top:4px"><i style="width:${pc}%;background:var(--accent)"></i></div>` : ''}</div>`; }).join('')}</div>`
    : `<div class="card"><h3>Goals</h3><div class="small muted">Set a goal and get reminded to check in. <a class="acc" style="cursor:pointer" onclick="go('goals');A.goal2()">Add a goal →</a></div></div>`;
  const upcoming = `<div class="card"><h3>Upcoming · next 14 days <span class="act faint">reminders ${lead}d ahead</span></h3><div class="list">${up.length ? up.map(u => {
    const dd = diff(TODAY, u.d), when = dd < 0 ? `${-dd}d ago` : dd === 0 ? 'today' : dd === 1 ? 'tomorrow' : `in ${dd}d`;
    return `<div class="li"><span style="color:${u.c};width:14px">${u.g}</span><span class="t">${esc(u.t)} <span class="muted small">${esc(u.s)}</span></span>
      ${u.bill ? `<button class="btn sm" onclick="A.payBill('${u.bill.r.id}','${u.bill.ym}')">Mark paid</button>` : ''}${u.task ? `<button class="btn sm" onclick="A.toggleTask('${u.task.id}')">Done</button>` : ''}${u.touch ? `<button class="btn sm" onclick="A.talked('${u.touch.id}')">Talked</button>` : ''}${u.gift ? `<button class="btn sm" onclick="A.giftBuy('${u.gift.id}')">Bought</button>` : ''}
      <span class="small ${dd <= lead && dd >= 0 ? 'acc' : 'muted'}" style="width:74px;text-align:right">${when}</span></div>`; }).join('') : '<div class="empty">Nothing coming up</div>'}</div></div>`;
  // side: bucket bars + body
  const buckets = p ? `<div class="card"><h3>This pay period <span class="act faint small">${fd(p.start)} – ${fd(p.end)}</span></h3>${hbars(['needs', 'wants', 'savings'].map(k => ({label: k[0].toUpperCase() + k.slice(1), value: k === 'savings' ? p.budget.savings : st.spent[k], max: p.budget[k], color: PAL[k],
      right: k === 'savings' ? `${eur(p.budget.savings)} saved` : `${eur(st.spent[k])} / ${eur(p.budget[k])}`, tip: k === 'savings' ? 'Moved to savings on payday' : `${k}: ${eur(st.spent[k])} spent, ${eur(p.budget[k] - st.spent[k])} left`})))}</div>` : '';
  const bw = D.body.filter(b => b.weight).map(b => ({x: b.date, y: +b.weight})).filter(p => p.x >= addDays(TODAY, -90));
  const body = `<div class="card"><h3>Weight · 90 days <span class="act"><button class="btn sm" onclick="A.bodyLog()">+ Log</button></span></h3>${bw.length ? lineChart([{points: bw, color: 'var(--accent)'}], {h: 190, W: 440, fmt: v => v.toFixed(1), band: goalBand(), unit: ' kg'}) : '<div class="empty">Log your weight to see the trend</div>'}</div>`;
  const rv = periodsToReview(), rvP = rv[0];
  const reviewCard = rvP ? `<div class="card briefing" style="margin-bottom:16px"><div class="row wrap"><div><div class="acc">▸ Pay period ${fd(rvP.start)} – ${fd(rvP.end)} has ended</div><div class="small muted">Check the leftover and decide how much goes to savings${rv.length > 1 ? ` · ${rv.length} periods waiting` : ''}.</div></div><span class="sp"></span><button class="btn pri" onclick="A.review('${rvP.pc.id}')">Review leftover</button></div></div>` : '';
  const rvm = ymAdd(TODAY.slice(0, 7), -1), hasData = D.transactions.some(t => t.date.startsWith(rvm)) || D.workouts.some(w => w.date.startsWith(rvm));
  const monthCard = +TODAY.slice(8) <= 10 && hasData ? `<div class="card" style="margin-bottom:16px"><div class="row wrap"><div><div class="acc">▸ Your ${MONTH_FULL[+rvm.slice(5) - 1]} review is ready</div><div class="small muted">Money, gym records, body, goals — and what's coming this month.</div></div><span class="sp"></span><button class="btn pri" onclick="openReview('${rvm}')">Open review</button></div></div>` : '';
  const tp = planOn(TODAY), hasPlan = Object.values(trDays()).some(Boolean);
  const dayCard = `<div class="card"><div class="row wrap" style="gap:10px"><div style="flex:1;min-width:150px;cursor:pointer" onclick="UI.gymTab='plan';go('gym')"><div class="qk">Training</div><div style="margin-top:4px">${hasPlan ? (tp ? (trainedOn(TODAY) ? `<span class="good">✓</span> ${esc(tp)} done` : `Today: <b>${esc(tp)}</b>`) : '<span class="muted">Rest day</span>') : '<span class="muted small">Set a weekly plan →</span>'}</div></div>
    <div style="flex:1;min-width:150px;cursor:pointer" onclick="UI.goalsTab='focus';go('goals')"><div class="qk">Focus today</div><div style="margin-top:4px">${FOCUS ? `<span class="acc">◷ running · ${mmss(focusLeft())}</span>` : `${hm(focusMin(TODAY, TODAY))} <span class="muted small">· start a session →</span>`}</div></div>
    ${holidayOn(TODAY) || feastsOn(TODAY).length ? `<div style="flex:1;min-width:150px"><div class="qk">${holidayOn(TODAY) ? 'Holiday' : 'Name day today'}</div><div class="small" style="margin-top:4px">${esc(holidayOn(TODAY) || '')}${holidayOn(TODAY) && feastsOn(TODAY).length ? '<br>' : ''}${feastsOn(TODAY).length ? `<span class="muted">${esc(feastsOn(TODAY).map(f => f.feast + ': ' + f.names.slice(0, 5).join(', ')).join(' · '))}</span>` : ''}</div></div>` : ''}</div></div>`;
  return `${reviewCard}${monthCard}<div class="grid g4">${tiles}</div><div class="mt">${dayCard}</div><div class="mt">${briefing}</div><div class="grid g21 mt">${upcoming}<div class="grid">${goalsCard}${limitsCard(true)}${buckets}${body}</div></div>`;
};

// ---------------- money
V.money = () => {
  const tabs = [['overview', 'Overview'], ['tx', 'Transactions'], ['bills', 'Bills & subscriptions'], ['wish', 'Wishlist'], ['savings', 'Savings & goals'], ['networth', 'Net worth']];
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
      {label: 'Wants', value: st.spent.wants, max: p.budget.wants, color: PAL.wants, right: `${eur(st.spent.wants)} spent · ${eur(st.wantsLeft)} left${st.giftsAside ? ` · ${eur0(st.giftsAside)} for gifts` : ''}`}])}
    <div class="row mt" style="padding-top:12px;border-top:1px solid var(--line)"><div><div class="small muted">Expected leftover · you review it when the period ends</div><div class="big ${st.leftover < 0 ? 'bad' : 'acc'}">${eur(st.leftover)}</div></div><span class="sp"></span>
      ${p.pc.closed ? `<span class="small muted">✓ reviewed · ${eur(p.pc.leftoverMoved || 0)} to savings</span>` : `<button class="btn ${diff(TODAY, p.end) <= 2 ? 'pri' : 'ghost'}" onclick="A.review('${p.pc.id}')">Review leftover${diff(TODAY, p.end) > 2 ? ' early' : ''}</button>`}</div></div>`;
  const cats = {}; for (const t of st.tx) cats[t.category] = (cats[t.category] || 0) + t.amount;
  const catRows = Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([c, v]) => ({label: c, value: v, color: PAL[catBucket(c)], right: eur(v)}));
  const catsCard = `<div class="card"><h3>Spending by category · this period</h3>${catRows.length ? hbars(catRows) : '<div class="empty">No spending yet</div>'}<div class="mt">${legend([[PAL.needs, 'needs'], [PAL.wants, 'wants'], [PAL.savings, 'savings']])}</div></div>`;
  // last 6 months spending
  const months = [...Array(6)].map((_, i) => { const d = pd(TODAY.slice(0, 8) + '01'); d.setMonth(d.getMonth() - 5 + i); return iso(d).slice(0, 7); });
  const mdata = months.map(m => { const v = sum(D.transactions.filter(t => t.date.startsWith(m)), t => t.amount); return {label: MON[+m.slice(5) - 1], value: v, tip: `${MON[+m.slice(5) - 1]} ${m.slice(0, 4)}\n${eur(v)} spent`}; });
  const monthly = `<div class="card"><h3>Spending per month</h3>${columns(mdata, {fmt: v => eur(v, 0)})}</div>`;
  return `<div class="grid g2">${split}${left}</div><div class="grid g2 mt">${limitsCard(false)}${catsCard}</div><div class="mt">${monthly}</div>`;
};
V.money_tx = () => {
  const p = currentPeriod();
  let tx = [...D.transactions];
  if (UI.txFilter === 'period' && p) tx = tx.filter(t => t.date >= p.start && t.date <= p.end);
  if (UI.txFilter === 'savings') tx = tx.filter(t => t.source === 'savings');
  tx.sort((a, b) => a.date < b.date ? 1 : -1);
  const corr = D.savingsMoves.filter(m => isCorr(m) && (UI.txFilter !== 'period' || !p || (m.date >= p.start && m.date <= p.end)));
  const corrTx = corr.map(m => ({corr: m, date: m.date}));
  const all = [...tx, ...corrTx].sort((a, b) => a.date < b.date ? 1 : -1);
  const sg = v => (v > 0 ? '+' : '') + eur(v);
  const cRow = m => `<div class="txr corr" onclick="A.savCorrect('${m.id}')"><i class="dot" style="background:var(--muted)"></i><span class="txd">${fd(m.date)}</span><span class="txa ${m.amount < 0 ? 'bad' : 'good'}">${sg(m.amount)}</span><span class="txt"><span>Manual correction</span> <span class="muted">· savings → ${eur(m.to ?? savingsBalance(m.date))}${m.note ? ' · ' + esc(m.note) : ''}</span></span></div>`;
  const rows = all.map(t => t.corr ? cRow(t.corr) : `<div class="txr" onclick="A.expense('${t.id}')"><i class="dot" style="background:${PAL[t.bucket] || 'var(--muted)'}"></i><span class="txd">${fd(t.date)}</span><span class="txa">${eur(t.amount)}</span><span class="txt"><span>${esc(t.category)}</span>${t.note ? ` <span class="muted">· ${esc(t.note)}</span>` : ''}</span>${t.source === 'savings' ? '<span class="txs" title="Paid from savings">↗</span>' : ''}</div>`).join('');
  const empty = !all.length;
  return `<div class="card"><h3 class="txhead"><span class="seg">${[['period', 'This period'], ['all', 'All'], ['savings', 'From savings']].map(([k, l]) => `<button class="${UI.txFilter === k ? 'on' : ''}" onclick="UI.txFilter='${k}';render()">${l}</button>`).join('')}</span><span class="act muted">${tx.length} · ${eur(sum(tx, t => t.amount))}${corr.length ? ` · ${corr.length} correction${corr.length > 1 ? 's' : ''}` : ''}</span></h3>
  <div class="only-mob">${legend([[PAL.needs, 'needs'], [PAL.wants, 'wants'], [PAL.savings, 'savings']])}<div class="small faint" style="margin:4px 0 8px"><span class="warn">↗</span> = paid from savings · tap a row to edit</div>${!empty ? `<div class="txlist">${rows}</div>` : '<div class="empty">No transactions</div>'}</div>
  <div class="only-desk">${!empty ? `<table><tr><th>Date</th><th>Category</th><th>Note</th><th>Bucket</th><th>Paid from</th><th class="n">Amount</th><th></th></tr>${all.map(t => t.corr ? `<tr class="corr"><td class="muted">${fdl(t.date)}</td><td>Manual correction</td><td class="muted">savings balance → ${eur(t.corr.to ?? savingsBalance(t.date))}${t.corr.note ? ' · ' + esc(t.corr.note) : ''}</td><td><span class="tag">—</span></td><td class="muted">not spending</td><td class="n ${t.corr.amount < 0 ? 'bad' : 'good'}">${sg(t.corr.amount)}</td><td class="n"><button class="btn sm ghost" onclick="A.savCorrect('${t.corr.id}')">edit</button></td></tr>` : `<tr><td class="muted">${fdl(t.date)}</td><td>${esc(t.category)}</td><td class="muted">${esc(t.note || '')}</td><td><span class="tag ${t.bucket}">${t.bucket}</span></td><td class="${t.source === 'savings' ? 'warn' : 'muted'}">${t.source === 'savings' ? 'savings' : 'salary'}</td><td class="n">${eur(t.amount)}</td><td class="n"><button class="btn sm ghost" onclick="A.expense('${t.id}')">edit</button></td></tr>`).join('')}</table>` : '<div class="empty">No transactions</div>'}</div></div>`;
};
V.money_bills = () => {
  const from = TODAY, to = addDays(TODAY, 45), occ = billOccurrences(addDays(TODAY.slice(0, 8) + '01', 0), to);
  const monthly = sum(D.recurring.filter(r => r.active !== false), perMonth);
  const subs = D.recurring.filter(r => r.type === 'subscription' && r.active !== false), bills = D.recurring.filter(r => r.type !== 'subscription' && r.active !== false);
  const tl = `<div class="card"><h3>Timeline · this month → +45 days</h3><div class="list">${occ.length ? occ.map(o => `<div class="li"><span class="muted" style="width:96px">${fdl(o.date)}</span><span style="color:${o.paid ? 'var(--muted)' : o.date < TODAY ? 'var(--bad)' : 'var(--warn)'}">${o.paid ? '✓' : '▲'}</span><span class="t">${esc(o.r.name)} <span class="tag">${o.r.type}</span></span><span>${eur(o.r.amount)}</span>
    ${o.paid ? '<span class="small muted" style="width:76px;text-align:right">paid</span>' : `<button class="btn sm" style="width:76px" onclick="A.payBill('${o.r.id}','${o.ym}')">Mark paid</button>`}</div>`).join('') : '<div class="empty">Add bills and subscriptions to see what is coming</div>'}</div></div>`;
  const by = (list, label) => `<div class="card"><h3>${label} <span class="act muted">${eur(sum(list, perMonth))}/mo</span></h3><div class="list">${list.length ? list.sort((a, b) => a.day - b.day).map(r => `<div class="li" data-tip="${esc(`${r.name}\n${eur(perYear(r))} a year${(r.history || []).length ? `\nprice changed ${r.history.length}× — last ${fd(r.history[r.history.length - 1].date)}` : ''}`)}"><span class="muted" style="width:60px">${r.freq === 'year' ? MON[(+r.month || 1) - 1] + ' ' + r.day : 'day ' + r.day}</span><span class="t">${esc(r.name)}${(r.history || []).length ? ` <span class="${r.history[r.history.length - 1].to > r.history[r.history.length - 1].from ? 'warn' : 'good'} small">${r.history[r.history.length - 1].to > r.history[r.history.length - 1].from ? '▲' : '▼'}</span>` : ''}</span><span>${eur(r.amount)}<span class="faint small">${r.freq === 'year' ? '/yr' : ''}</span></span><button class="btn sm ghost" onclick="A.recurring('${r.id}')">edit</button></div>`).join('') : '<div class="empty">None yet</div>'}</div></div>`;
  const rev = D.recurring.filter(needsReview), cancelled = D.recurring.filter(r => r.active === false && r.cancelledAt);
  const check = `<div class="card ${rev.length ? 'briefing' : ''}"><h3>Subscription check-up <span class="act muted">${eur0(sum(subs, perYear))}/yr</span></h3>
    ${rev.length ? `<div class="small muted" style="margin-bottom:6px">Not reviewed for a year. Still using them?</div><div class="list">${rev.map(r => `<div class="li"><span class="t">${esc(r.name)} <span class="muted small">${eur0(perYear(r))}/yr</span></span><button class="btn sm" onclick="A.subKeep('${r.id}')">Keep</button><button class="btn sm ghost danger" onclick="A.subCancel('${r.id}')">Cancel</button></div>`).join('')}</div>`
      : `<div class="small muted">${subs.length ? 'All subscriptions reviewed in the last year. Each one comes back here yearly so you never pay for something you forgot about.' : 'Add subscriptions to get a yearly "still using it?" check.'}</div>`}
    ${subs.length ? `<div class="list mt">${subs.slice().sort((a, b) => perYear(b) - perYear(a)).map(r => `<div class="li small"><span class="t">${esc(r.name)}</span><span class="faint">${r.reviewed ? 'checked ' + fd(r.reviewed) : ''}</span><span style="width:84px;text-align:right">${eur0(perYear(r))}/yr</span>${needsReview(r) ? '' : `<button class="btn sm ghost danger" onclick="A.subCancel('${r.id}')" title="Cancel subscription">×</button>`}</div>`).join('')}</div>` : ''}
    ${cancelled.length ? `<div class="small faint mt">Cancelled: ${cancelled.map(r => `${esc(r.name)} (${fd(r.cancelledAt)}, saves ${eur0(perYear(r))}/yr) <a class="acc" style="cursor:pointer" onclick="A.subResume('${r.id}')">undo</a>`).join(' · ')}</div>` : ''}</div>`;
  const pie = `<div class="card"><h3>Fixed costs per month</h3><div class="row" style="gap:20px">${donut([{label: 'Bills', value: sum(bills, perMonth), color: PAL.needs}, {label: 'Subscriptions', value: sum(subs, perMonth), color: PAL.extra}], eur0(monthly), 'PER MONTH', 150)}
    <div>${legend([[PAL.needs, 'Bills ' + eur(sum(bills, perMonth))], [PAL.extra, 'Subscriptions ' + eur(sum(subs, perMonth))]])}<div class="small muted mt">${eur(monthly * 12, 0)} per year</div>
    <button class="btn pri mt" onclick="A.recurring()">+ Bill / subscription</button></div></div></div>`;
  return `<div class="grid g21"><div class="grid" style="align-content:start">${tl}${check}</div><div class="grid" style="align-content:start">${pie}${by(bills, 'Bills')}${by(subs, 'Subscriptions')}</div></div>`;
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
  const linkOf = w => /^https?:\/\//i.test(w.link || '') ? ` <a class="acc small" href="${esc(w.link)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">store ↗</a>` : '';
  // one compact row: tick to buy · dot = needs/wants · name (tap to edit) · price; second line = can I afford it · note
  const row = w => { const [c, t] = fit(w); return `<div class="wr"><input type="checkbox" onchange="A.wishBuy('${w.id}')" title="Mark as bought">
    <div class="wm" onclick="A.wish('${w.id}')" title="Tap to edit"><div class="wn"><i class="dot" style="background:${PAL[w.bucket]}"></i>${esc(w.name)}${linkOf(w)}</div>
    <div class="ws small"><span class="${c}">${t}</span>${w.note ? ` <span class="muted">· ${esc(w.note)}</span>` : ''}</div></div><div class="wp">${eur(w.price)}</div></div>`; };
  const tot = b => sum(D.wishlist.filter(w => !w.bought && w.bucket === b), w => w.price);
  return `<div class="grid g4"><div class="card stat"><div class="lbl">Needs on list</div><div class="val">${eur0(tot('needs'))}</div><div class="sub">${eur(left.needs)} needs left this month</div></div>
    <div class="card stat"><div class="lbl">Wants on list</div><div class="val">${eur0(tot('wants'))}</div><div class="sub">${eur(left.wants)} wants left · ${s ? eur(s.weekLeft) : '—'} this week</div></div>
    <div class="card stat"><div class="lbl">Savings</div><div class="val">${eur0(bal)}</div><div class="sub">if paid from savings</div></div>
    <div class="card stat"><div class="lbl">Got</div><div class="val">${bought.length}</div><div class="sub">${eur0(sum(bought.filter(w => !w.gift), w => w.paid || w.price))} spent${bought.some(w => w.gift) ? ` · ${(n => n === 1 ? '1 received as a gift' : n + ' received as gifts')(bought.filter(w => w.gift).length)}` : ' from this list'}</div></div></div>
  <div class="card mt"><h3 class="wishhead"><span class="row wrap"><span class="seg">${[['all', 'All'], ['needs', 'Needs'], ['wants', 'Wants']].map(([k, l]) => `<button class="${f === k ? 'on' : ''}" onclick="UI.wishFilter='${k}';render()">${l}</button>`).join('')}</span>
      <select class="wsort" onchange="UI.wishSort=this.value;render()">${[['added', 'Newest first'], ['price', 'Cheapest first'], ['priceDesc', 'Most expensive first'], ['name', 'A–Z']].map(([k, l]) => `<option value="${k}" ${sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></span>
      <span class="act"><button class="btn pri sm" onclick="A.wish()">+ Add item</button></span></h3>
    <div class="list">${items.map(row).join('') || '<div class="empty">Nothing on the list. Add things you want or need to buy.</div>'}</div>
    <div class="small faint mt">${legend([[PAL.needs, 'need'], [PAL.wants, 'want']])}<div style="margin-top:4px">Tick an item when you buy it — you choose salary or savings, and it's taken from the right budget. Tap a name to edit.</div></div></div>
  ${bought.length ? `<div class="card mt"><h3>Got</h3><div class="list">${bought.slice(0, 20).map(w => `<div class="wr"><input type="checkbox" checked onchange="A.wishUnbuy('${w.id}')" title="${w.gift ? 'Put back on the wishlist' : 'Undo purchase'}"><div class="wm"><div class="wn faint" style="text-decoration:line-through"><i class="dot" style="background:${PAL[w.bucket]}"></i>${esc(w.name)}</div><div class="ws small muted">${fd(w.boughtAt)} · ${w.gift ? `<span style="color:var(--extra)">❖</span> gift from ${esc(giftWho(D.gifts.find(g => g.id === w.giftId) || {}) || '?')}` : w.source === 'savings' ? '<span class="warn">↗</span> from savings' : 'from salary'}</div></div><div class="wp muted">${w.gift ? `<span class="small faint">≈ </span>${eur0(w.price)}` : eur(w.paid ?? w.price)}</div></div>`).join('')}</div></div>` : ''}`;
};
V.money_savings = () => {
  const bal = savingsBalance(), allocated = sum(D.goals, g => g.saved);
  const evDates = [...new Set([...D.savingsMoves.map(m => m.date), ...D.transactions.filter(t => t.source === 'savings').map(t => t.date)])].sort();
  const pts = evDates.map(d => ({x: d, y: savingsBalance(d)}));
  const hist = [...D.savingsMoves.map(m => ({d: m.date, t: isCorr(m) ? 'Manual correction' + (m.note ? ' · ' + m.note : '') : m.kind === 'withdraw' ? 'Withdrawal' : (m.note || 'Deposit'), a: moveVal(m)})),
    ...D.transactions.filter(t => t.source === 'savings').map(t => ({d: t.date, t: `${t.category}${t.note ? ' · ' + t.note : ''}`, a: -t.amount}))].sort((a, b) => a.d < b.d ? 1 : -1);
  const invested = sum(D.transactions.filter(t => t.category === 'Investing'), t => t.amount);
  return `<div class="grid g4"><div class="card stat hero" style="cursor:pointer" onclick="A.savCorrect()" title="Correct the balance"><div class="lbl">Savings balance <span class="act" style="float:right"><button class="btn sm" onclick="event.stopPropagation();A.savCorrect()">✎ Correct</button></span></div><div class="val">${eur(bal)}</div><div class="sub">${eur(bal - allocated)} not assigned to goals</div></div>
    <div class="card stat"><div class="lbl">Invested (all time)</div><div class="val">${eur0(invested)}</div><div class="sub">category "Investing"</div></div>
    <div class="card stat"><div class="lbl">Added this year</div><div class="val">${eur0(sum(D.savingsMoves.filter(m => m.date.startsWith(TODAY.slice(0, 4)) && m.kind === 'deposit'), m => m.amount))}</div><div class="sub">from paychecks + leftovers</div></div>
    <div class="card stat"><div class="lbl">Manual</div><div class="row wrap mt"><button class="btn sm" onclick="A.saveMove('deposit')">+ Deposit</button><button class="btn sm" onclick="A.saveMove('withdraw')">− Withdraw</button><button class="btn sm" onclick="A.savCorrect()">✎ Correct balance</button></div></div></div>
    <div class="grid g2 mt">${coverageCard()}<div class="card"><h3>Balance over time</h3>${pts.length ? lineChart([{points: pts, color: 'var(--savings)'}], {fmt: v => eur(v, 0)}) : '<div class="empty">No savings activity yet</div>'}</div>
    <div class="card"><h3>Savings goals <span class="act"><button class="btn sm" onclick="A.goal()">+ Goal</button></span></h3>${D.goals.length ? D.goals.map(g => `<div style="margin:10px 0" data-tip="${esc(g.name)}\n${eur(g.saved)} of ${eur(g.target)}">
      <div class="row small"><span>${esc(g.name)}</span><span class="sp"></span><span class="muted">${eur0(g.saved)} / ${eur0(g.target)}</span></div>
      <div class="meter" style="height:8px"><i style="width:${Math.min(100, g.saved / g.target * 100)}%;background:var(--savings)"></i></div>
      <div class="row small mt" style="margin-top:6px"><span class="muted">${Math.round(g.saved / g.target * 100)}%</span><span class="sp"></span><button class="btn sm ghost" onclick="A.goalAdd('${g.id}')">+ assign</button><button class="btn sm ghost" onclick="A.goal('${g.id}')">edit</button></div></div>`).join('') : '<div class="empty">e.g. new PC, holiday, emergency fund</div>'}</div></div>
    <div class="card mt"><h3>History</h3><table>${hist.slice(0, 40).map(h => `<tr><td class="muted" style="width:120px">${fdl(h.d)}</td><td>${esc(h.t)}</td><td class="n ${h.a < 0 ? 'bad' : 'good'}">${h.a < 0 ? '' : '+'}${eur(h.a)}</td></tr>`).join('') || '<tr><td class="empty">Nothing yet</td></tr>'}</table></div>`;
};

// ---------------- gym
V.gym = () => {
  const tabs = [['overview', 'Overview'], ['plan', 'Plan'], ['progress', 'Exercises'], ['body', 'Body'], ['history', 'History'], ['import', 'Import']];
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
    <div class="card mt"><h3>Personal records</h3><table><tr><th>Exercise</th><th class="hide-m">Muscle</th><th class="n">Best set</th><th class="n">Est. 1RM</th><th class="n">Change</th><th class="n hide-m">Sessions</th><th class="n hide-m">Last</th></tr>
      ${prs.map(p => `<tr style="cursor:pointer" onclick="UI.gymEx=${esc(JSON.stringify(p.n))};render()"><td>${esc(p.n)}</td><td class="muted hide-m">${muscleOf(p.n)}</td><td class="n">${nf(p.b.top)} kg × ${p.b.reps}</td><td class="n">${nf(p.b.e1rm, 1)} kg</td><td class="n ${p.gain > 0 ? 'good' : 'muted'}">${p.count > 1 ? (p.gain > 0 ? '+' : '') + p.gain.toFixed(0) + '%' : '—'}</td><td class="n muted hide-m">${p.count}</td><td class="n muted hide-m">${fd(p.last.date)}</td></tr>`).join('')}</table></div>`;
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
function importPreviewHTML() {
  const pv = UI.importPreview;
  if (!pv) return '<div class="empty">Paste a workout — the preview appears here straight away.</div>';
  if (!pv.length) {
    const first = (UI.hevyDraft || '').split('\n').map(l => l.trim()).filter(Boolean).slice(0, 4);
    const onlyLink = first.length && first.every(l => /^https?:\/\/|^@hevy/i.test(l) || first.length <= 2);
    return `<div class="bad">No sets found in this text.</div><div class="small muted mt" style="line-height:1.8">${onlyLink ? 'It looks like only a link or title was copied — the link alone doesn\'t contain your sets. In Hevy open the workout → <b>⋯ / Share</b> → choose the option that copies the <b>workout as text</b>.' : 'Sets need to look like <code>Set 1: 40 kg x 12</code> or <code>40 kg × 12</code>.'}</div>${first.length ? `<div class="small faint mt">First lines I received:<br>${first.map(esc).join('<br>')}</div>` : ''}`;
  }
  return pv.map((w, k) => `<div style="margin-bottom:16px"><div class="row wrap"><span class="acc">${esc(w.title)}</span><span class="sp"></span><input type="date" value="${w.date.slice(0, 10)}" onchange="UI.importPreview[${k}].date=this.value+'T'+UI.importPreview[${k}].date.slice(11);UI.importPreview[${k}].noDate=false" style="padding:3px 6px"></div>
    ${w.noDate ? '<div class="small warn">No date found in the text — check the date above.</div>' : ''}
    ${w.exercises.map(e => `<div class="li small"><span class="t" style="white-space:normal">${esc(e.name)} <span class="faint">→ ${muscleOf(e.name)}</span></span><span class="muted">${e.sets.map(s => s.w ? `${s.w}×${s.r}` : `${s.r} reps`).join('  ')}</span></div>`).join('')}</div>`).join('');
}
function importLive(text) {
  UI.hevyDraft = text; UI.importPreview = text.trim() ? parseHevy(text) : null;
  const pv = UI.importPreview, n = pv ? pv.length : 0;
  $('#impPv').innerHTML = importPreviewHTML();
  const b = $('#impSave'); b.disabled = !n; b.textContent = n ? `Save ${n} workout${n === 1 ? '' : 's'}` : 'Save';
  $('#impStatus').innerHTML = impStatus();
}
function impStatus() {
  const pv = UI.importPreview; if (!pv) return '';
  if (!pv.length) return '<span class="bad">✗ No sets found — see the preview for why</span>';
  const ex = sum(pv, w => w.exercises.length), sets = sum(pv, w => sum(w.exercises, e => e.sets.length));
  return `<span class="good">✓ Found ${pv.length} workout${pv.length > 1 ? 's' : ''} · ${ex} exercises · ${sets} sets</span>${pv.some(w => w.noDate) ? ' <span class="warn">· check the date</span>' : ''}`;
}
V.gym_import = () => {
  const n = (UI.importPreview || []).length;
  return `<div class="grid g2"><div class="card"><h3>Import from Hevy</h3>
    <div class="row wrap" style="margin-bottom:10px"><button class="btn pri" onclick="A.hevyPaste()">Paste from clipboard</button><label class="btn ghost">Load .txt<input type="file" accept=".txt,text/plain" hidden onchange="A.hevyFile(this)"></label></div>
    <textarea id="hevyText" rows="6" placeholder="…or paste / type the workout text here" oninput="clearTimeout(window._imp);window._imp=setTimeout(()=>importLive(this.value),200)">${esc(UI.hevyDraft || '')}</textarea>
    <div class="row mt"><button class="btn ghost" onclick="UI.hevyDraft='';UI.importPreview=null;render()">Clear</button><span class="sp"></span><button class="btn pri" id="impSave" onclick="A.hevySave()" ${n ? '' : 'disabled'}>${n ? `Save ${n} workout${n === 1 ? '' : 's'}` : 'Save'}</button></div>
    <div id="impStatus" class="small mt">${impStatus()}</div>
    <div class="small muted mt" style="line-height:1.8"><b class="acc">How:</b> in Hevy open the workout → <b>Share</b> → copy the workout <b>as text</b> → come back here → <b>Paste from clipboard</b> → <b>Save</b>. Several workouts at once are fine; importing the same workout again just updates it.</div></div>
    <div class="card"><h3>Preview</h3><div id="impPv">${importPreviewHTML()}</div></div></div>`;
};

// ---------------- records
V.records = () => {
  const tabs = [['people', 'People'], ['gifts', 'Gifts'], ['tasks', 'Tasks & notes'], ['media', 'Media log']];
  const q = UI.search.toLowerCase();
  let body;
  if (UI.recTab === 'people') {
    const ppl = D.people.filter(p => !q || JSON.stringify(p).toLowerCase().includes(q)).map(p => ({p, nb: nextBirthday(p.birthday)})).sort((a, b) => (a.nb || '9') < (b.nb || '9') ? -1 : 1);
    body = `<div class="grid g3">${ppl.map(({p, nb}) => { const dd = nb ? diff(TODAY, nb) : null, by = birthYear(p.birthday);
      return `<div class="card"><h3><span style="color:var(--text);font-size:14px;text-transform:none;letter-spacing:0">${esc(p.name)}</span><span class="act"><button class="btn sm ghost" onclick="A.person('${p.id}')">edit</button></span></h3>
      <div class="small muted">${esc(p.relation || '')}</div>
      ${nb ? `<div class="row mt"><span style="color:var(--extra)">✦</span><span>${fd(nb)}${by ? ` · turns ${+nb.slice(0, 4) - by}` : ''}</span><span class="sp"></span><span class="small ${dd <= Math.max(7, D.settings.reminderDays) ? 'acc' : 'muted'}">${dd === 0 ? 'today!' : `in ${dd}d`}</span></div>` : '<div class="faint small mt">no birthday set</div>'}
      ${(() => { const n = nextNameDay(p); return n ? `<div class="row small" style="margin-top:4px"><span style="color:var(--extra)">✧</span><span>Name day ${fd(n.date)} <span class="faint">${esc(n.feast)}</span></span><span class="sp"></span><span class="muted">${diff(TODAY, n.date) === 0 ? 'today!' : `in ${diff(TODAY, n.date)}d`}</span></div>` : ''; })()}
      ${+p.keepEvery > 0 ? (() => { const due = touchDue(p), dd = diff(TODAY, due); return `<div class="row small" style="margin-top:6px"><span class="acc">☏</span><span class="${dd <= 0 ? 'warn' : 'muted'}">${dd < 0 ? `catch-up ${-dd}d overdue` : dd === 0 ? 'catch up today' : `catch up in ${dd}d`}${p.lastContact ? ` · last ${fd(p.lastContact)}` : ''}</span><span class="sp"></span><button class="btn sm" onclick="A.talked('${p.id}')">Talked today</button></div>`; })() : ''}
      ${(() => { const g = giftsPlanned().filter(g => g.personId === p.id).sort((a, b) => a.date < b.date ? -1 : 1)[0], gap = giftGaps(45).find(x => x.p.id === p.id);
        const bg = !g && D.gifts.filter(x => x.personId === p.id && x.status === 'bought' && x.date >= addDays(TODAY, -3)).sort((a, b) => a.date < b.date ? -1 : 1)[0];
        if (bg && !gap) return `<div class="row small" style="margin-top:6px;cursor:pointer" onclick="A.gift('${bg.id}')"><span class="good">✓</span><span>Gift bought · ${eur0(+bg.paid || 0)} for the ${occName(bg.occasion).toLowerCase()} ${fd(bg.date)}</span><span class="sp"></span><button class="btn sm ghost" onclick="event.stopPropagation();A.gift(null,{personId:'${p.id}'})">Plan gift</button></div>`;
        return g ? `<div class="row small" style="margin-top:6px;cursor:pointer" onclick="A.gift('${g.id}')"><span style="color:${PAL.wants}">❖</span><span>Gift ${eur0(+g.budget || 0)} · ${occName(g.occasion).toLowerCase()} ${fd(g.date)}${g.idea ? ` <span class="faint">— ${esc(g.idea)}</span>` : ''}</span><span class="sp"></span><button class="btn sm" onclick="event.stopPropagation();A.giftBuy('${g.id}')">Bought</button></div>`
          : `<div class="row small" style="margin-top:6px"><span style="color:${PAL.wants}">❖</span><span class="${gap ? 'warn' : 'faint'}">${gap ? `no gift for the ${occName(gap.occ).toLowerCase()} yet` : 'no gift planned'}</span><span class="sp"></span><button class="btn sm ${gap ? 'pri' : 'ghost'}" onclick="A.gift(null,{personId:'${p.id}'${gap ? `,occasion:'${gap.occ}',date:'${gap.date}'` : ''}})">Plan gift</button></div>`; })()}
      ${(() => { const r = giftsReceived().filter(g => g.personId === p.id); return r.length ? `<div class="small" style="margin-top:6px"><span class="muted">Gave you:</span> ${r.slice(0, 3).map(g => `${esc(g.item || 'a gift')} <span class="faint">(${fd(g.date)}${g.date.slice(0, 4) !== TODAY.slice(0, 4) ? ' ' + g.date.slice(0, 4) : ''})</span>`).join(', ')}${r.length > 3 ? ` +${r.length - 3}` : ''}</div>` : ''; })()}
      ${p.gifts ? `<div class="small mt"><span class="muted">Gift ideas:</span> ${esc(p.gifts)}</div>` : ''}${p.notes ? `<div class="small muted mt">${esc(p.notes)}</div>` : ''}</div>`; }).join('') || '<div class="card"><div class="empty">No one added yet</div></div>'}</div>`;
  } else if (UI.recTab === 'media') body = mediaBody(q);
  else if (UI.recTab === 'gifts') body = giftsBody(q);
  else {
    const ts = D.tasks.filter(t => !q || JSON.stringify(t).toLowerCase().includes(q));
    const open = ts.filter(t => !t.done).sort((a, b) => (a.due || '9') < (b.due || '9') ? -1 : 1), done = ts.filter(t => t.done).sort((a, b) => (a.doneAt || '') < (b.doneAt || '') ? 1 : -1);
    const row = t => `<div class="li wrow"><input type="checkbox" ${t.done ? 'checked' : ''} onchange="A.toggleTask('${t.id}')"><span class="t ${t.done ? 'faint' : ''}" style="${t.done ? 'text-decoration:line-through' : ''}">${esc(t.title)}${t.notes ? ` <span class="muted small">— ${esc(t.notes)}</span>` : ''}</span>
      ${t.repeat ? `<span class="tag" title="${esc(repeatText(t))}">↻ ${esc(repeatText(t).replace('every ', ''))}</span>` : ''}${t.due ? `<span class="small ${!t.done && t.due < TODAY ? 'bad' : 'muted'}">${fdl(t.due)}${t.due.slice(0, 4) !== TODAY.slice(0, 4) ? ' ' + t.due.slice(0, 4) : ''}</span>` : '<span class="tag">note</span>'}<button class="btn sm ghost" onclick="A.task('${t.id}')">edit</button></div>`;
    const rec = open.filter(t => t.repeat || t.remindBefore), once = open.filter(t => !t.repeat && !t.remindBefore);
    body = `<div class="grid g21"><div class="grid" style="align-content:start"><div class="card"><h3>Open · ${once.length}</h3><div class="list">${once.map(row).join('') || '<div class="empty">All clear</div>'}</div></div>
      <div class="card"><h3>Recurring & renewals · ${rec.length} <span class="act"><button class="btn sm" onclick="A.task(null,'',{repeat:{n:1,unit:'year'},remindBefore:30})">+ Renewal</button></span></h3><div class="list">${rec.map(row).join('') || '<div class="empty small">Insurance, vignette, ID card, check-ups… add them once and get warned ahead every time.</div>'}</div></div></div>
      <div class="card"><h3>Done · ${done.length}</h3><div class="list">${done.slice(0, 15).map(row).join('') || '<div class="empty">—</div>'}</div></div></div>`;
  }
  return `<div class="row"><div class="tabs" style="flex:1">${tabs.map(([k, l]) => `<a class="${UI.recTab === k ? 'on' : ''}" onclick="UI.recTab='${k}';render()">${l}</a>`).join('')}</div>
    <div class="row" style="margin-bottom:18px"><input placeholder="Search…" value="${esc(UI.search)}" oninput="UI.search=this.value;clearTimeout(window._st);window._st=setTimeout(()=>{render();const i=document.querySelector('#view input');i.focus();i.setSelectionRange(99,99)},250)">
    <button class="btn pri" onclick="${{people: 'A.person()', tasks: 'A.task()', media: 'A.media()', gifts: 'A.gift()'}[UI.recTab]}">+ ${{people: 'Person', tasks: 'Task / note', media: 'Add', gifts: 'Gift'}[UI.recTab]}</button></div></div>${body}`;
};

// ---------------- life goals
const GOAL_CATS = ['Fitness', 'Health', 'Money', 'Career', 'Learning', 'Personal', 'Relationships', 'Creative', 'Other'];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
function goalCurrent(g) {
  if (g.kind !== 'number') return null;
  const latest = k => { const b = D.body.filter(x => x[k]).sort((a, b) => a.date < b.date ? -1 : 1).pop(); return b ? +b[k] : null; };
  if (g.source === 'weight') return latest('weight') ?? g.current ?? g.start;
  if (g.source === 'waist') return latest('waist') ?? g.current ?? g.start;
  if (g.source === 'savings') return r2(savingsBalance());
  if (g.source === 'focus') return r2(sum(D.focus.filter(f => f.goalId === g.id), f => f.min) / 60);
  return g.current ?? g.start;
}
function goalProgress(g) {
  if (g.status === 'done') return 1;
  if (g.kind === 'checklist') { const s = g.steps || []; return s.length ? s.filter(x => x.done).length / s.length : 0; }
  if (g.kind === 'number') { const c = goalCurrent(g), a = +g.start, b = +g.target; if (a === b) return c === b ? 1 : 0; return Math.max(0, Math.min(1, (c - a) / (b - a))); }
  return 0;
}
function goalDueToday(g) {
  if (g.status !== 'active' || !g.remind || g.remind === 'off') return false;
  if ((g.log || []).some(l => l.date === TODAY)) return false;
  if (g.remind === 'daily') return true;
  if (g.remind === 'weekly') return dowi(TODAY) === (+g.remindDay || 0);
  if (g.remind === 'monthly') return TODAY.slice(8) === '01';
  return false;
}
const remindText = g => !g.remind || g.remind === 'off' ? 'no reminders' : g.remind === 'weekly' ? `check-in every ${WEEKDAYS[+g.remindDay || 0]}` : g.remind === 'monthly' ? 'check-in on the 1st of each month' : 'check-in daily';
const goalNum = (g, v) => v == null ? '—' : (g.source === 'savings' ? eur0(v) : `${+(+v).toFixed(2)}${g.unit ? ' ' + g.unit : ''}`);

function goalCard(g) {
  const p = goalProgress(g), pct = Math.round(p * 100), last = (g.log || []).slice(-1)[0];
  const dl = g.targetDate ? diff(TODAY, g.targetDate) : null;
  const due = goalDueToday(g), reached = g.status === 'active' && p >= 1;
  const steps = g.kind === 'checklist' ? `<div class="list" style="margin-top:8px">${(g.steps || []).map((s, i) => `<label class="li small" style="cursor:pointer"><input type="checkbox" ${s.done ? 'checked' : ''} ${g.status !== 'active' ? 'disabled' : ''} onchange="A.goalStep('${g.id}',${i})"><span class="t ${s.done ? 'faint' : ''}" style="white-space:normal;${s.done ? 'text-decoration:line-through' : ''}">${esc(s.text)}</span></label>`).join('')}</div>` : '';
  const num = g.kind === 'number' ? `<div class="small muted" style="margin-top:4px">${goalNum(g, g.start)} → <b style="color:var(--text)">${goalNum(g, goalCurrent(g))}</b> → ${goalNum(g, g.target)}${g.source && g.source !== 'manual' ? ` <span class="faint">· from your ${g.source} log</span>` : ''}</div>` : '';
  return `<div class="card ${due ? 'briefing' : ''}" style="${g.status === 'done' ? 'opacity:.75' : ''}"><h3><span style="color:var(--text);font-size:14px;text-transform:none;letter-spacing:0;white-space:normal">${g.status === 'done' ? '★ ' : ''}${esc(g.title)}</span><span class="act"><span class="tag">${esc(g.category || 'Other')}</span></span></h3>
    ${g.why ? `<div class="small muted" style="font-style:italic;margin:-4px 0 8px">“${esc(g.why)}”</div>` : ''}
    ${g.kind !== 'simple' || g.status === 'done' ? `<div class="row small"><span>${pct}%</span><span class="sp"></span>${g.kind === 'checklist' ? `<span class="muted">${(g.steps || []).filter(s => s.done).length}/${(g.steps || []).length} steps</span>` : ''}</div>
    <div class="meter" style="height:8px;margin-top:4px"><i style="width:${pct}%;background:${g.status === 'done' ? 'var(--good)' : 'var(--accent)'}"></i></div>` : ''}${num}${steps}
    <div class="small mt" style="line-height:1.7">${g.status === 'done' ? `<span class="good">Achieved ${g.doneAt ? fd(g.doneAt) + ' ' + g.doneAt.slice(0, 4) : ''}</span>` : g.status === 'paused' ? '<span class="muted">Paused</span>' :
      `${dl === null ? '<span class="muted">no deadline</span>' : `<span class="${dl < 0 ? 'bad' : dl <= 14 ? 'warn' : 'muted'}">${dl < 0 ? `${-dl}d past deadline` : dl === 0 ? 'deadline today' : `${dl} days left`} · ${fd(g.targetDate)}</span>`} <span class="faint">· ${remindText(g)}</span>`}
      ${last ? `<br><span class="faint">Last check-in ${ago(pd(last.date).getTime() + 12 * 3600e3).replace('just now', 'today')}${last.note ? `: ${esc(last.note)}` : ''}</span>` : ''}</div>
    ${reached ? `<div class="small good mt">✓ Target reached — mark it achieved?</div>` : ''}
    <div class="row wrap mt">${g.status === 'active' ? `<button class="btn ${due ? 'pri' : ''} sm" onclick="A.goalCheckin('${g.id}')">${due ? 'Check in now' : 'Check in'}</button>${reached || g.kind === 'simple' ? `<button class="btn sm" onclick="A.goalDone('${g.id}')">★ Achieved</button>` : ''}` : ''}<span class="sp"></span><button class="btn sm ghost" onclick="A.goal2('${g.id}')">edit</button></div></div>`;
}
V.goals = () => `<div class="tabs">${[['list', 'Goals'], ['focus', 'Focus timer']].map(([k, l]) => `<a class="${(UI.goalsTab || 'list') === k ? 'on' : ''}" onclick="UI.goalsTab='${k}';render()">${l}</a>`).join('')}</div>` + (UI.goalsTab === 'focus' ? V.goals_focus() : V.goals_list());
V.goals_list = () => {
  const f = UI.goalFilter || 'active', all = D.lifeGoals;
  const list = all.filter(g => f === 'all' || (f === 'active' ? g.status !== 'done' : g.status === 'done'))
    .sort((a, b) => (goalDueToday(b) - goalDueToday(a)) || ((a.status === 'paused') - (b.status === 'paused')) || ((a.targetDate || '9') < (b.targetDate || '9') ? -1 : 1));
  const act = all.filter(g => g.status === 'active'), dueN = act.filter(goalDueToday).length;
  const avg = act.length ? Math.round(sum(act, goalProgress) / act.length * 100) : 0;
  const yearDone = all.filter(g => g.status === 'done' && (g.doneAt || '').startsWith(TODAY.slice(0, 4))).length;
  return `<div class="grid g4"><div class="card stat hero"><div class="lbl">Active goals</div><div class="val">${act.length}</div><div class="sub">${all.filter(g => g.status === 'paused').length} paused</div></div>
    <div class="card stat"><div class="lbl">Average progress</div><div class="val">${avg}%</div><div class="meter"><i style="width:${avg}%;background:var(--accent)"></i></div></div>
    <div class="card stat"><div class="lbl">Check-ins due today</div><div class="val ${dueN ? 'acc' : ''}">${dueN}</div><div class="sub">reminders keep goals alive</div></div>
    <div class="card stat"><div class="lbl">Achieved this year</div><div class="val">${yearDone}</div><div class="sub">${all.filter(g => g.status === 'done').length} all time</div></div></div>
  <div class="row mt" style="margin-bottom:12px"><span class="seg">${[['active', 'Active'], ['done', 'Achieved'], ['all', 'All']].map(([k, l]) => `<button class="${f === k ? 'on' : ''}" onclick="UI.goalFilter='${k}';render()">${l}</button>`).join('')}</span><span class="sp"></span><button class="btn pri" onclick="A.goal2()">+ Goal</button></div>
  ${list.length ? `<div class="grid g3 goals-grid">${list.map(goalCard).join('')}</div>` : `<div class="card"><div class="empty">${f === 'done' ? 'Nothing achieved yet — you\'ll get there.' : 'No goals yet. Add one — e.g. "Reach 80 kg", "Run a 5k", "Learn Blender sculpting" — and pick how often to be reminded.'}</div></div>`}`;
};

// ---------------- wants limits (stay set; spending counts per pay period)
function limitRange() { const p = currentPeriod(); if (p && !p.over) return [p.start, p.end]; const m = TODAY.slice(0, 7); return [m + '-01', m + '-' + pad(daysIn(+m.slice(0, 4), +m.slice(5)))]; }
function limitStats() {
  const [a, b] = limitRange(), L = D.settings.limits || {};
  return Object.entries(L).filter(([c, v]) => +v > 0 && catBucket(c) === 'wants').map(([cat, lim]) => {
    const spent = sum(D.transactions.filter(t => t.category === cat && t.source !== 'savings' && t.date >= a && t.date <= b), t => t.amount);
    return {cat, lim: +lim, spent, pct: spent / lim};
  }).sort((x, y) => y.pct - x.pct);
}
function limitWarn(cat, amount) {
  const st = limitStats().find(x => x.cat === cat); if (!st) return;
  const before = (st.spent - amount) / st.lim;
  if (st.pct >= 1 && before < 1) { toast(`⚠ Over your ${cat} limit: ${eur(st.spent)} of ${eur(st.lim)}`); UI.limitToasted = true; }
  else if (st.pct >= .8 && before < .8) { toast(`${cat}: ${Math.round(st.pct * 100)}% of your ${eur(st.lim)} limit used`); UI.limitToasted = true; }
}
const limitColor = p => p >= 1 ? 'var(--bad)' : p >= .8 ? 'var(--warn)' : PAL.wants;
function limitsCard(compact) {
  const ls = limitStats(), [a, b] = limitRange();
  if (!ls.length) return compact ? '' : `<div class="card"><h3>Wants limits <span class="act"><button class="btn sm" onclick="A.limits()">Set limits</button></span></h3><div class="small muted">Cap categories like Eating out or Entertainment. You'll be warned at 80% and when you go over. Limits stay set; spending starts fresh each pay period.</div></div>`;
  const rows = (compact ? ls.slice(0, 4) : ls).map(x => ({label: x.cat, value: x.spent, max: x.lim, color: limitColor(x.pct), right: `${x.pct >= 1 ? '<span class="bad">over · </span>' : ''}${eur(x.spent)} / ${eur(x.lim)}`}));
  return `<div class="card"><h3>Wants limits <span class="act">${compact ? `<a class="small acc" style="cursor:pointer;text-transform:none;letter-spacing:0" onclick="UI.moneyTab='overview';go('money')">details →</a>` : `<span class="faint small" style="text-transform:none;letter-spacing:0">${fd(a)} – ${fd(b)}</span> <button class="btn sm" onclick="A.limits()">Edit</button>`}</span></h3>${hbars(rows)}</div>`;
}

// ---------------- how long savings last + "normal" per bucket
function periodSpend(a, b) {
  const tx = D.transactions.filter(t => t.date >= a && t.date <= b);
  const by = k => sum(tx.filter(t => t.bucket === k), t => t.amount);
  const saved = sum(D.savingsMoves.filter(m => m.date >= a && m.date <= b && !isCorr(m)), moveVal) - sum(tx.filter(t => t.source === 'savings'), t => t.amount);
  return {needs: by('needs'), wants: by('wants'), saved};
}
function coverage() {
  const done = D.paychecks.map(pc => periodOf(pc)).filter(p => p.end < TODAY).sort((x, y) => x.start < y.start ? 1 : -1).slice(0, 3);
  const per = done.map(p => periodSpend(p.start, p.end));
  const avg = k => per.length ? sum(per, x => x[k]) / per.length : null;
  const cur = currentPeriod(), now = cur ? periodSpend(cur.start, TODAY) : null;
  let monthly = per.length ? avg('needs') + avg('wants') : cur ? cur.raw.needs + cur.raw.wants : null;
  const bal = savingsBalance();
  return {n: per.length, avg: {needs: avg('needs'), wants: avg('wants'), saved: avg('saved')}, last: per[0] || null, now, months: monthly > 0 ? bal / monthly : null, fromBudget: !per.length};
}
function coverageCard() {
  const c = coverage();
  if (c.months === null) return `<div class="card"><h3>Savings cover</h3><div class="small muted">Enter a paycheck to see how many months your savings would last.</div></div>`;
  const row = (k, label, lowerGood) => {
    const a = c.avg[k], l = c.last && c.last[k];
    if (a === null) return `<div class="li small"><i class="dot" style="background:${PAL[k === 'saved' ? 'savings' : k]}"></i><span class="t">${label}</span><span class="muted">${c.now ? eur0(c.now[k]) + ' so far' : '—'}</span></div>`;
    const d = l - a, good = lowerGood ? d <= 0 : d >= 0, show = Math.abs(d) >= 1;
    return `<div class="li small" data-tip="${esc(`${label}\nAverage of last ${c.n} pay period${c.n > 1 ? 's' : ''}: ${eur(a)}\nLast period: ${eur(l)}${c.now ? `\nThis period so far: ${eur(c.now[k])}` : ''}`)}"><i class="dot" style="background:${PAL[k === 'saved' ? 'savings' : k]}"></i><span class="t">${label}</span><span class="muted">${eur(a, 0)}/mo</span>
      <span style="width:88px;text-align:right" class="${show ? (good ? 'good' : 'warn') : 'muted'}">${show ? `${d > 0 ? '▲' : '▼'} ${eur(Math.abs(d), 0)}` : '≈ same'}</span></div>`;
  };
  return `<div class="card"><h3>Savings cover <span class="act faint small" style="text-transform:none;letter-spacing:0">${c.fromBudget ? 'based on your budget' : `avg of last ${c.n} pay period${c.n > 1 ? 's' : ''}`}</span></h3>
    <div class="row" style="align-items:baseline;gap:8px"><span class="big">${nf(c.months, 1)}</span><span class="muted">months of normal spending (needs + wants)</span></div>
    <div class="list mt">${row('needs', 'Needs', true)}${row('wants', 'Wants', true)}${row('saved', 'Saved', false)}</div>
    <div class="small faint" style="margin-top:6px">${c.n ? 'Arrow = last pay period vs your average. ' : ''}Tap or hover a row for details.</div></div>`;
}

// ---------------- monthly review
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ymName = ym => `${MONTH_FULL[+ym.slice(5) - 1]} ${ym.slice(0, 4)}`;
const ymAdd = (ym, n) => { const d = new Date(+ym.slice(0, 4), +ym.slice(5) - 1 + n, 1); return iso(d).slice(0, 7); };
function monthStats(ym) {
  const inM = d => (d || '').startsWith(ym), start = ym + '-01';
  const tx = D.transactions.filter(t => inM(t.date));
  const spent = sum(tx, t => t.amount), byB = {needs: 0, wants: 0, savings: 0}; for (const t of tx) byB[t.bucket] = (byB[t.bucket] || 0) + t.amount;
  const cats = {}; for (const t of tx) cats[t.category] = (cats[t.category] || 0) + t.amount;
  const income = sum(D.paychecks.filter(p => inM(p.date)), p => p.amount);
  const saved = sum(D.savingsMoves.filter(m => inM(m.date) && !isCorr(m)), moveVal) - sum(tx.filter(t => t.source === 'savings'), t => t.amount);
  const fromSavings = sum(tx.filter(t => t.source === 'savings'), t => t.amount);
  const bills = tx.filter(t => t.recurringId);
  const bought = D.wishlist.filter(w => w.bought && inM(w.boughtAt));
  const ws = D.workouts.filter(w => inM(w.date));
  const sets = {}; for (const w of ws) for (const e of w.exercises) sets[muscleOf(e.name)] = (sets[muscleOf(e.name)] || 0) + e.sets.filter(s => !s.warm).length;
  const prs = [];
  for (const n of new Set(ws.flatMap(w => w.exercises.map(e => e.name)))) {
    const h = exerciseHistory(n), before = h.filter(x => x.date < start && x.e1rm > 0), during = h.filter(x => inM(x.date));
    if (!before.length) continue;
    const pb = Math.max(...before.map(x => x.e1rm)), best = during.reduce((b, x) => x.e1rm > b.e1rm ? x : b, {e1rm: 0});
    if (best.e1rm > pb) prs.push({n, from: pb, to: best.e1rm, top: best.top, reps: best.reps});
  }
  prs.sort((a, b) => (b.to / b.from) - (a.to / a.from));
  const bodyM = k => D.body.filter(b => b[k] && inM(b.date)).sort((a, b) => a.date < b.date ? -1 : 1);
  const wt = bodyM('weight'), wa = bodyM('waist');
  const goalsDone = D.lifeGoals.filter(g => inM(g.doneAt)), checkins = sum(D.lifeGoals, g => (g.log || []).filter(l => inM(l.date)).length);
  const tasksDone = D.tasks.filter(t => inM(t.doneAt)).length + sum(D.tasks, t => (t.history || []).filter(inM).length);
  const media = D.media.filter(m => m.status === 'done' && inM(m.finished)), focusM = sum(D.focus.filter(f => inM(f.date)), f => f.min);
  return {ym, media, focusM, spent, byB, cats, income, saved, fromSavings, bills, bought, ws, vol: sum(ws, wVol), nsets: sum(ws, wSets), sets, prs, wt, wa, goalsDone, checkins, tasksDone};
}
function delta(cur, prev, fmt, lowerIsGood) {
  if (!prev) return '';
  const d = cur - prev; if (Math.abs(d) < 1e-9) return '<span class="muted">same as last month</span>';
  const good = lowerIsGood ? d < 0 : d > 0;
  return `<span class="${good ? 'good' : 'warn'}">${d > 0 ? '▲' : '▼'} ${fmt(Math.abs(d))}</span> <span class="faint">vs last month</span>`;
}
V.review = () => {
  const ym = UI.revMonth || defaultReviewMonth(), S = monthStats(ym), P = monthStats(ymAdd(ym, -1)), next = ymAdd(ym, 1);
  const wch = S.wt.length > 1 ? S.wt[S.wt.length - 1].weight - S.wt[0].weight : null, wach = S.wa.length > 1 ? S.wa[S.wa.length - 1].waist - S.wa[0].waist : null;
  const cats = Object.entries(S.cats).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const groups = Object.entries(S.sets).filter(([g]) => g !== 'Other').sort((a, b) => b[1] - a[1]);
  const weeks = Math.max(1, daysIn(+ym.slice(0, 4), +ym.slice(5)) / 7);
  // next month preview
  const nextFrom = next + '-01', nextTo = next + '-' + pad(daysIn(+next.slice(0, 4), +next.slice(5)));
  const nBills = billOccurrences(nextFrom, nextTo), nB = D.people.filter(p => (p.birthday || '').slice(-5, -3) === next.slice(5));
  const nGoals = D.lifeGoals.filter(g => g.status === 'active' && (g.targetDate || '').startsWith(next)), nTasks = D.tasks.filter(t => !t.done && (t.due || '').startsWith(next));
  const highlights = [];
  if (S.prs.length) highlights.push(`${S.prs.length} new strength record${S.prs.length > 1 ? 's' : ''}`);
  if (S.goalsDone.length) highlights.push(`${S.goalsDone.length} goal${S.goalsDone.length > 1 ? 's' : ''} achieved`);
  if (S.saved > 0) highlights.push(`${eur0(S.saved)} saved`);
  if (S.media.length) highlights.push(`finished ${S.media.map(m => m.title).slice(0, 3).join(', ')}${S.media.length > 3 ? ` +${S.media.length - 3}` : ''}`);
  if (S.focusM >= 60) highlights.push(`${hm(S.focusM)} of focus`);
  if (wch !== null && wch < 0) highlights.push(`${Math.abs(wch).toFixed(1)} kg down`);
  if (wach !== null && wach < 0) highlights.push(`${Math.abs(wach).toFixed(1)} cm off the waist`);
  return `<div class="row" style="margin-bottom:16px"><button class="btn" onclick="UI.revMonth='${ymAdd(ym, -1)}';render()">‹</button><div style="font-size:18px;min-width:200px;text-align:center">${ymName(ym)}</div><button class="btn" onclick="UI.revMonth='${ymAdd(ym, 1)}';render()" ${ym >= TODAY.slice(0, 7) ? 'disabled' : ''}>›</button><span class="sp"></span><span class="small muted">${ym === TODAY.slice(0, 7) ? 'month so far' : 'monthly review'}</span></div>
  ${highlights.length ? `<div class="card briefing" style="margin-bottom:16px"><div class="acc">▸ Highlights</div><div style="margin-top:6px">${highlights.map(esc).join(' · ')}</div></div>` : ''}
  <div class="grid g4">
    <div class="card stat"><div class="lbl">Spent</div><div class="val">${eur0(S.spent)}</div><div class="sub">${delta(S.spent, P.spent, eur0, true)}</div></div>
    <div class="card stat"><div class="lbl">Saved</div><div class="val ${S.saved < 0 ? 'bad' : ''}">${eur0(S.saved)}</div><div class="sub">${S.income ? `income ${eur0(S.income)}` : ''}${S.fromSavings ? ` · ${eur0(S.fromSavings)} spent from savings` : ''}</div></div>
    <div class="card stat"><div class="lbl">Workouts</div><div class="val">${S.ws.length}</div><div class="sub">${delta(S.ws.length, P.ws.length, v => v, false) || `${(S.ws.length / weeks).toFixed(1)} per week`}</div></div>
    <div class="card stat"><div class="lbl">Body</div><div class="val">${wch === null ? '—' : `${wch > 0 ? '+' : ''}${wch.toFixed(1)} kg`}</div><div class="sub">${wach === null ? (S.wt.length ? `${S.wt[S.wt.length - 1].weight} kg latest` : 'no weigh-ins this month') : `waist ${wach > 0 ? '+' : ''}${wach.toFixed(1)} cm`}</div></div></div>
  <div class="grid g2 mt"><div class="card"><h3>Money</h3>
      ${hbars(['needs', 'wants', 'savings'].map(k => ({label: k[0].toUpperCase() + k.slice(1), value: S.byB[k] || 0, color: PAL[k], right: eur(S.byB[k] || 0)})))}
      <h3 class="mt" style="margin-top:18px">Top categories</h3>${cats.length ? hbars(cats.map(([c, v]) => ({label: c, value: v, color: PAL[catBucket(c)], right: `${eur(v)} <span class="faint">${Math.round(v / S.spent * 100)}%</span>`}))) : '<div class="empty">No spending logged</div>'}
      <div class="small muted mt">${S.bills.length} bills/subscriptions paid (${eur(sum(S.bills, t => t.amount))})${S.bought.length ? ` · bought from wishlist: ${S.bought.map(w => esc(w.name)).join(', ')}` : ''}</div></div>
    <div class="card"><h3>Gym</h3><div class="small muted">${S.nsets} sets · ${Math.round(S.vol).toLocaleString()} kg volume ${delta(S.vol, P.vol, v => Math.round(v).toLocaleString() + ' kg', false)}</div>
      <h3 class="mt" style="margin-top:14px">New records</h3>${S.prs.length ? `<div class="list">${S.prs.slice(0, 6).map(p => `<div class="li small"><span class="good">↑</span><span class="t" style="white-space:normal">${esc(p.n)}</span><span class="muted">${p.top} kg × ${p.reps}</span><span class="good">+${Math.round((p.to / p.from - 1) * 100)}%</span></div>`).join('')}</div>` : '<div class="small muted">No new records this month.</div>'}
      <h3 class="mt" style="margin-top:14px">Hard sets per week</h3>${groups.length ? hbars(groups.map(([g, n]) => ({label: g, value: n / weeks, right: (n / weeks).toFixed(1), color: n / weeks >= 10 ? 'var(--accent)' : '#3a3a44'})), {ref: 10}) : '<div class="small muted">No workouts.</div>'}</div></div>
  <div class="grid g2 mt"><div class="card"><h3>Goals & tasks</h3>
      <div class="small" style="line-height:1.9">${S.goalsDone.length ? S.goalsDone.map(g => `<span class="good">★</span> ${esc(g.title)}`).join('<br>') + '<br>' : ''}<span class="muted">${S.checkins} goal check-ins · ${S.tasksDone} tasks done</span></div>
      ${D.lifeGoals.filter(g => g.status === 'active').slice(0, 5).map(g => { const pc = Math.round(goalProgress(g) * 100); return `<div style="margin:8px 0"><div class="row small"><span class="t" style="flex:1">${esc(g.title)}</span><span class="muted">${pc}%</span></div><div class="meter" style="height:5px;margin-top:4px"><i style="width:${pc}%;background:var(--accent)"></i></div></div>`; }).join('')}</div>
    <div class="card"><h3>Coming up in ${MONTH_FULL[+next.slice(5) - 1]}</h3><div class="small" style="line-height:1.9">
      <span style="color:var(--warn)">▲</span> ${nBills.length} bills & subscriptions · ${eur(sum(nBills, o => o.r.amount))}<br>
      <span style="color:var(--extra)">✦</span> ${nB.length ? nB.map(p => `${esc(p.name)} (${+p.birthday.slice(-2)} ${MON[+next.slice(5) - 1]})`).join(', ') : 'no birthdays'}<br>
      ${nTasks.length ? `<span>□</span> ${nTasks.map(t => esc(t.title)).join(', ')}<br>` : ''}${nGoals.length ? `<span style="color:var(--wants)">◎</span> deadlines: ${nGoals.map(g => esc(g.title)).join(', ')}` : ''}</div></div></div>`;
};
function defaultReviewMonth() { return +TODAY.slice(8) <= 10 ? ymAdd(TODAY.slice(0, 7), -1) : TODAY.slice(0, 7); }
function openReview(ym) { UI.revMonth = ym || defaultReviewMonth(); go('review'); }

// ---------------- recurring tasks & renewals
const REPEAT_UNITS = {day: 'day', week: 'week', month: 'month', year: 'year'};
function addPeriod(date, n, unit) {
  const d = pd(date);
  if (unit === 'day') d.setDate(d.getDate() + n); else if (unit === 'week') d.setDate(d.getDate() + 7 * n);
  else { const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + (unit === 'year' ? 12 * n : n)); d.setDate(Math.min(day, daysIn(d.getFullYear(), d.getMonth() + 1))); }
  return iso(d);
}
const repeatText = t => t.repeat ? `every ${t.repeat.n > 1 ? t.repeat.n + ' ' : ''}${t.repeat.unit}${t.repeat.n > 1 ? 's' : ''}` : '';
const remindText2 = d => !d ? 'on the day' : d % 30 === 0 ? `${d / 30} month${d > 30 ? 's' : ''} before` : d % 7 === 0 ? `${d / 7} week${d > 7 ? 's' : ''} before` : `${d} day${d > 1 ? 's' : ''} before`;

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
      <button class="btn ghost" onclick="UI.calMonth=TODAY.slice(0,7);UI.calSel=TODAY;render()">Today</button><button class="btn ghost" onclick="openReview('${UI.calMonth}')">Month review</button><span class="sp"></span>
      <span class="small muted">${gymM} gym days · ${eur(spentM)} spent</span></div>
    <div class="grid" style="grid-template-columns:1fr 300px;align-items:start"><div>
      <div class="cal" style="margin-bottom:6px">${DOW.map(d => `<div class="dh">${d.toUpperCase()}</div>`).join('')}</div>
      <div class="cal">${monthEv.map(({d, ev}) => { const spend = sum(ev.filter(e => e.k === 'spend'), e => e.amt), inc = ev.filter(e => e.k === 'income');
        const items = ev.filter(e => !['spend', 'body'].includes(e.k));
        return `<div class="cd ${d.slice(0, 7) !== UI.calMonth ? 'out' : ''} ${ev.some(e => e.k === 'holiday') ? 'hol' : ''} ${d === TODAY ? 'today' : ''} ${d === UI.calSel ? 'sel' : ''}" onclick="UI.calSel='${d}';render()">
          <div class="row"><span class="n">${pd(d).getDate()}</span><span class="sp"></span>${ev.some(e => e.k === 'gym') ? '<span style="color:var(--accent)">◆</span>' : ''}</div>
          ${items.filter(e => !['gym', 'focus'].includes(e.k)).slice(0, 3).map(e => `<div class="mk"><span style="color:${e.c}">${e.g}</span><span>${esc(e.t)}</span></div>`).join('')}
          ${spend ? `<div class="mk muted"><span>−${eur(spend).replace('−', '')}</span></div>` : ''}${inc.length ? `<div class="mk good"><span>+${eur(sum(D.paychecks.filter(p => p.date === d), p => p.amount), 0)}</span></div>` : ''}</div>`; }).join('')}</div>
      <div class="mt"><div class="legend">${[ ['var(--accent)', '◆', 'workout'], ['var(--muted)', '◇', 'planned'], ['var(--bad)', '⚑', 'holiday'], ['var(--extra)', '✧', 'name day'], [PAL.wants, '❖', 'gift'], ['var(--warn)', '▲', 'bill due'], ['var(--muted)', '✓', 'bill paid'], ['var(--extra)', '✦', 'birthday'], ['var(--text)', '□', 'task'], ['var(--wants)', '◎', 'goal deadline'], ['var(--good)', '★', 'goal achieved'], ['var(--good)', '+€', 'income'], ['var(--muted)', '−€', 'spent'], ['var(--savings)', '↗', 'to savings']].map(([c, g, l]) => `<span><b style="color:${c};font-weight:400">${g}</b>${l}</span>`).join('')}</div></div></div>
    <div class="card" style="position:sticky;top:0"><h3>${fdl(UI.calSel)} ${UI.calSel.slice(0, 4)}</h3>
      ${feastsOn(UI.calSel).length ? `<div class="small muted" style="margin:-4px 0 8px;line-height:1.6"><span style="color:var(--extra)">✧</span> ${feastsOn(UI.calSel).map(f => `<b style="font-weight:500;color:var(--text)">${esc(f.feast)}</b> — ${esc(f.names.join(', '))}`).join('<br>')}</div>` : ''}
      ${sel.length ? sel.map(e => `<div class="li" style="align-items:flex-start"><span style="color:${e.c};width:14px">${e.g}</span><div style="flex:1;min-width:0"><div>${esc(e.t)}</div>${e.s ? `<div class="small muted">${esc(e.s)}</div>` : ''}</div></div>`).join('') : '<div class="empty">Nothing on this day</div>'}
      <div class="row wrap mt"><button class="btn sm" onclick="A.expense(null,'${UI.calSel}')">+ Expense</button><button class="btn sm" onclick="A.task(null,'${UI.calSel}')">+ Task</button></div></div></div>`;
};

// ---------------- settings
V.settings = () => {
  const s = D.settings, sp = s.split, nperm = 'Notification' in window ? Notification.permission : 'unsupported', t = PREFS.theme || {}, L = PREFS.lock;
  const secs = [['look', 'Appearance'], ['privacy', 'Privacy & lock'], ['money', 'Money'], ['remind', 'Reminders'], ['sync', 'Sync'], ['data', 'Data'], ['about', 'About']];
  const sw = (on, fn, label, sub) => `<label class="li" style="cursor:pointer"><span class="t" style="white-space:normal">${label}${sub ? `<div class="small faint">${sub}</div>` : ''}</span><span class="switch ${on ? 'on' : ''}" onclick="event.preventDefault();${fn}"><i></i></span></label>`;
  const syncCard = `<div class="card" id="sec-sync"><h3>Sync between your devices <span class="act small ${UI.sync.state === 'error' ? 'bad' : 'muted'}">${SYNC ? (UI.sync.state === 'error' ? 'problem' : 'on') : 'off'}</span></h3>
    ${SYNC ? `<div class="small" style="line-height:1.8">Encrypted copy stored in a secret gist on your GitHub account.<br><span class="muted">Last sync:</span> ${SYNC.last ? ago(SYNC.last) : 'never'}${UI.sync.state === 'error' ? `<br><span class="bad">${esc(UI.sync.msg)}</span>` : ''}</div>
      <div class="row wrap mt"><button class="btn pri" onclick="syncNow(true)">Sync now</button><button class="btn ghost" onclick="A.syncSetup()">Change token / passphrase</button><span class="sp"></span><button class="btn ghost danger" onclick="A.syncOff()">Turn off on this device</button></div>`
    : `<div class="small muted" style="line-height:1.8">Keep your phone and PC in sync. Your data is encrypted on this device with a passphrase only you know, then stored in a secret gist on <b>your own</b> GitHub account — GitHub can't read it, and no one else is involved.</div>
      <div class="row mt"><button class="btn pri" onclick="A.syncSetup()">Set up sync</button></div>`}</div>`;
  return `<div class="secnav">${secs.map(([k, l]) => `<a onclick="document.getElementById('sec-${k}').scrollIntoView({behavior:'smooth',block:'start'})">${l}</a>`).join('')}</div>
  <div class="grid g2">
  <div class="card" id="sec-look"><h3>Appearance <span class="act faint small" style="text-transform:none;letter-spacing:0">this device only</span></h3>
    <div class="qk">Accent colour</div><div class="swatches">${ACCENTS.map(([n, c]) => `<button class="swatch ${(t.accent || '#6fd6c0') === c ? 'on' : ''}" style="background:${c}" title="${n}" onclick="setTheme('accent','${c}')"></button>`).join('')}
      <label class="swatch custom" title="Pick any colour" style="background:${t.accent && !ACCENTS.some(a => a[1] === t.accent) ? t.accent : 'conic-gradient(red,yellow,lime,cyan,blue,magenta,red)'}"><input type="color" value="${t.accent || '#6fd6c0'}" onchange="setTheme('accent',this.value)"></label></div>
    <div class="qk" style="margin-top:14px">Background</div><div class="row wrap" style="gap:6px;margin-top:6px">${BGS.map(b => `<button class="bgchip ${(t.bg || 'Midnight') === b[0] ? 'on' : ''}" style="background:${b[2]}" onclick="setTheme('bg','${b[0]}')"><i style="background:${b[1]}"></i>${b[0]}</button>`).join('')}</div>
    <div class="qk" style="margin-top:14px">Text size</div><div style="margin-top:6px"><span class="seg">${SIZES.map(([n, z]) => `<button class="${(t.zoom || 1) === z ? 'on' : ''}" onclick="setTheme('zoom',${z})">${n}</button>`).join('')}</span></div></div>
  <div class="card" id="sec-privacy"><h3>Privacy & lock <span class="act faint small" style="text-transform:none;letter-spacing:0">this device only</span></h3><div class="list">
    ${sw(HIDE, 'toggleHide()', 'Hide amounts now', 'Shows €•••• everywhere — also the eye button at the top')}
    ${sw(PREFS.hideOnOpen, 'PREFS.hideOnOpen=!PREFS.hideOnOpen;savePrefs();render()', 'Hide amounts every time the app opens', 'Tap the eye to show them')}
    <div class="li"><span class="t" style="white-space:normal">App lock (PIN)<div class="small faint">${L ? `On · ${L.len}-digit PIN${L.cred ? ' + fingerprint / face' : ''}` : 'Off — optional. Asks for a PIN when the app opens.'}</div></span>${L ? `<button class="btn sm" onclick="A.pinSet(true)">Change</button><button class="btn sm ghost danger" onclick="A.pinOff()">Turn off</button>` : `<button class="btn sm pri" onclick="A.pinSet(false)">Set PIN</button>`}</div>
    ${L ? `<div class="li"><span class="t">Lock again after leaving the app</span><select onchange="PREFS.lock.after=+this.value;savePrefs()">${[[0, 'Immediately'], [1, '1 minute'], [5, '5 minutes'], [15, '15 minutes'], [60, '1 hour']].map(([v, l]) => `<option value="${v}" ${(+L.after || 0) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div id="bioRow"></div><div class="li"><span class="t">Lock now</span><button class="btn sm" onclick="lockNow()">Lock</button></div>` : ''}</div>
    <div class="small faint mt">The lock keeps casual eyes out of the app. It doesn't encrypt the data on this device — use your phone's / PC's own lock for that.</div></div>
  <div class="card" id="sec-money"><h3>Default income split</h3>
    <div class="formgrid" style="grid-template-columns:repeat(3,1fr)">${['needs', 'wants', 'savings'].map(k => `<label class="f">${k.toUpperCase()} %<input type="number" inputmode="numeric" min="0" max="100" id="sp_${k}" value="${sp[k]}" oninput="A.splitCheck()"></label>`).join('')}</div>
    <div class="meter" id="spBar" style="height:10px">${['needs', 'wants', 'savings'].map(k => `<i style="width:${sp[k]}%;background:${PAL[k]}"></i>`).join('')}</div><div class="row mt"><span id="spSum" class="small"></span><span class="sp"></span><button class="btn pri" id="spSave" onclick="A.splitSave()">Save split</button></div>
    <div class="small faint mt">Bills & subscriptions come out of Needs. "Safe to spend" uses Wants only. Wants limits: Money → Overview.</div>
    <h3 class="mt" style="margin-top:20px">Spending categories <span class="act"><button class="btn sm" onclick="A.catAdd()">+ Category</button></span></h3><div class="list">${s.categories.map((c, i) => `<div class="li"><input value="${esc(c.name)}" style="flex:1" onchange="A.catEdit(${i},'name',this.value)">
      <select onchange="A.catEdit(${i},'bucket',this.value)">${['needs', 'wants', 'savings'].map(b => `<option ${c.bucket === b ? 'selected' : ''}>${b}</option>`).join('')}</select><button class="btn sm ghost danger" onclick="A.catDel(${i})">×</button></div>`).join('')}</div></div>
  <div class="card" id="sec-remind"><h3>Reminders & calendar</h3><div class="formgrid">
    <label class="f">Remind me this many days ahead (min 7)<input type="number" inputmode="numeric" min="7" id="st_rem" value="${s.reminderDays}"></label>
    <label class="f">Savings you already have (€)<input type="number" inputmode="decimal" step="0.01" id="st_sav" value="${s.startingSavings}"></label>
    <label class="f">Goal weight min (kg, optional)<input type="number" inputmode="decimal" step="0.5" id="st_gmin" value="${s.gymGoal.weightMin || ''}"></label>
    <label class="f">Goal weight max (kg, optional)<input type="number" inputmode="decimal" step="0.5" id="st_gmax" value="${s.gymGoal.weightMax || ''}"></label></div>
    <div class="row mt"><span class="sp"></span><button class="btn pri" onclick="A.generalSave()">Save</button></div>
    <div class="list mt">${sw(s.bgCalendar !== false, "D.settings.bgCalendar=D.settings.bgCalendar===false;commit()", 'Bulgarian holidays & name days', 'In the calendar and reminders; paydays skip public holidays')}
      ${sw((s.training || {}).remind !== false, "D.settings.training={...(D.settings.training||{}),remind:(D.settings.training||{}).remind===false};commit()", 'Training reminders', 'On planned days and the day after a missed workout')}
      <div class="li"><span class="t">Notifications on this device</span>${nperm === 'granted' ? '<span class="small good">✓ on</span>' : `<button class="btn sm" onclick="enableNotifications()">Turn on</button>`}</div></div></div>
  ${syncCard}
  <div class="card" id="sec-data"><h3>Data on this device</h3><div class="small muted" style="line-height:1.8">Everything is stored inside this app on this device. Nothing is sent anywhere unless you turn on sync.<br>Export a backup now and then — clearing the browser's site data would erase it.</div>
    <div class="row wrap mt"><button class="btn" onclick="A.exportData()">Export backup</button><label class="btn">Import backup<input type="file" accept=".json,application/json" hidden onchange="A.importData(this)"></label><span class="sp"></span><button class="btn ghost danger" onclick="A.wipe()">Erase all data</button></div></div>
  <div class="card" id="sec-about"><h3>About</h3><div class="small muted" style="line-height:1.9">Oracle 2 · version ${APP_VERSION}<br>Updates install themselves the next time you open the app — your data stays.<br><kbd>Ctrl K</kbd> quick add · <kbd>1</kbd>–<kbd>8</kbd> switch pages · <kbd>Esc</kbd> close<br>Long-press (phone) or right-click (PC) the app icon for shortcuts.</div>
    <div class="row wrap mt"><button class="btn" onclick="go('help')">Open help</button><button class="btn ghost" onclick="showWhatsNew('0')">What's new</button><button class="btn ghost" onclick="A.checkUpdate()">Check for update</button></div></div></div>`;
};
async function renderBioRow() {
  const el = $('#bioRow'); if (!el || !PREFS.lock || !(await bioAvailable())) return;
  el.innerHTML = `<label class="li" style="cursor:pointer"><span class="t" style="white-space:normal">Unlock with fingerprint / face<div class="small faint">Your PIN still works as a backup</div></span><span class="switch ${PREFS.lock.cred ? 'on' : ''}" onclick="event.preventDefault();A.bioToggle()"><i></i></span></label>`;
}

// ---------------- help & welcome tour
const HELP = [
  ['Getting started', `<p>Oracle 2 keeps your money, gym progress, birthdays, tasks and plans in one place. Everything is stored <b>on this device</b> — nothing is uploaded unless you turn on sync.</p>
    <ol><li>Go to <b>Settings</b> and set your income split (needs / wants / savings — must add up to 100%) and how much you already have saved.</li>
    <li>When you get paid, press <b>+ Paycheck</b> (Money page), enter the amount and approve the split. Your budget runs from that payday until the next one.</li>
    <li>Set a few <b>goals</b> and how often to be reminded (Goals page).</li>
    <li>Add your <b>bills & subscriptions</b> once (Money → Bills & subscriptions). They repeat every month on the same day.</li>
    <li>Log spending as it happens — the quickest way is <b>Quick add</b>.</li></ol>`],
  ['Where to find what', `<p>A quick map of the app — the same on phone and computer:</p>
    <table><tr><td><b>Today</b></td><td>safe to spend, your week, upcoming (bills, birthdays, name days, holidays, catch-ups), today's training and focus</td></tr>
    <tr><td><b>Money</b></td><td>Overview · Transactions · Bills & subscriptions (incl. yearly check-up) · Wishlist · Savings & goals · <b>Net worth</b></td></tr>
    <tr><td><b>Gym</b></td><td>Overview · <b>Plan</b> (weekly training schedule) · Exercises · Body · History · Import</td></tr>
    <tr><td><b>Goals</b></td><td>Goals · <b>Focus timer</b></td></tr>
    <tr><td><b>Records</b></td><td>People (birthdays, name days, keep in touch) · <b>Gifts</b> · Tasks & notes · Media log</td></tr>
    <tr><td><b>Calendar</b></td><td>everything by day, incl. Bulgarian holidays and name days</td></tr>
    <tr><td><b>Settings</b></td><td>Appearance · Privacy & lock · Money · Reminders · Sync · Data · About — tap a chip at the top to jump</td></tr></table>`],
  ['Quick add', `<p>Press <kbd>Ctrl K</kbd> on a computer or the round <b>+</b> button on a phone, type one line, press Enter. The preview shows how it will be saved.</p>
    <table><tr><td><code>24.90 eating out pizza</code></td><td>expense (amount, category, note)</td></tr><tr><td><code>60 hobbies @savings</code></td><td>paid from savings instead of salary</td></tr><tr><td><code>15 food yesterday</code></td><td>for another day (also <code>fri</code>, <code>03.12</code>)</td></tr>
    <tr><td><code>task call bank fri</code></td><td>task with a due date</td></tr><tr><td><code>note gift idea: scarf</code></td><td>note without a date</td></tr><tr><td><code>bday Ivan 14.03</code></td><td>birthday (add the year to see ages: <code>14.03.1995</code>)</td></tr>
    <tr><td><code>want 89 headphones</code> / <code>need 120 boots</code></td><td>wishlist item</td></tr><tr><td><code>goal run a 5k by 01.03</code></td><td>new goal (edit it later to add steps, numbers, reminders)</td></tr><tr><td><code>weight 86.4</code> · <code>waist 98</code></td><td>body log</td></tr><tr><td><code>income 2400</code> · <code>save 200</code></td><td>paycheck · deposit to savings</td></tr></table>`],
  ['Money: budget & safe to spend', `<p>Each paycheck is split by your percentages. <b>Savings</b> is moved to your savings balance straight away. <b>Needs</b> covers bills, subscriptions, food and other essentials. <b>Wants</b> is your free money.</p>
    <p><b>Safe to spend today / this week</b> only uses Wants. The money left is spread evenly across the remaining days until your next payday, week by week (Monday–Sunday). Spend less one day and later days get more; overspend and the rest of the week shrinks.</p>
    <p>Every expense is paid from <b>this month's salary</b> or from <b>savings</b>. Savings purchases don't touch your monthly budget — they lower your savings balance.</p>
    <p>When a pay period ends, <b>Today</b> asks you to <b>review the leftover</b>: you see what's left, correct the amount if your bank says otherwise, and choose to move it to savings or not. Nothing is moved automatically. You can also review early from Money → Overview.</p>
    <p>Payday is assumed to be the last working day of the month; the real date is whatever day you enter the paycheck.</p>`],
  ['Bills, subscriptions & wishlist', `<p>Bills and subscriptions have a day of the month. They appear on the calendar and in <i>Upcoming</i>, and you're reminded ahead of time. Press <b>Mark paid</b> when paid (you can change the amount — handy for electricity).</p>
    <p>The <b>Wishlist</b> holds things you want or need to buy, with price, link and note. Each item shows whether it fits your budget this week, this month, only from savings, or not yet. Tick it when bought and choose salary or savings — it's booked to the right budget automatically.</p>`],
  ['Gym', `<p>Track workouts in Hevy as usual. To bring them in: in Hevy open the workout → <b>Share</b> → copy it <b>as text</b>. Then in Oracle 2 go to Gym → <b>Import workout</b> → <b>Paste from clipboard</b>, check the preview and press <b>Save</b>. Several workouts at once are fine, and importing the same one twice just updates it. (If Hevy shares text straight to other apps, <i>Oracle 2</i> may also appear in its share list once the app is installed from Chrome.)</p>
    <p>Gym shows workouts per week, sets per muscle group (aim for 10–20 hard sets a week per muscle), strength progress per exercise (estimated 1-rep max), personal records and tips under <i>Where to improve</i>. Log weight and waist regularly (morning, same conditions) to see real trends; set a goal weight in Settings.</p>`],
  ['Goals', `<p>Goals are for anything you want to achieve — fitness, learning, career, personal. Each goal can be measured three ways: <b>done / not done</b>, a list of <b>steps</b> you tick off, or <b>a number</b> from a start to a target (e.g. 87 → 80 kg). Number goals can update themselves from your <b>weight</b> or <b>waist</b> log or your <b>savings</b> balance.</p>
    <p>Pick how often you want to be reminded — daily, weekly on a day you choose, or monthly. On that day the goal is highlighted, shows on Today, and you get a notification. <b>Check in</b> to update progress and write a short note on how it's going; your notes build a history you can look back on. Add a target date to see the countdown and get a reminder before the deadline. When you're there, press <b>★ Achieved</b>.</p>`],
  ['Monthly review', `<p>At the start of each month, <b>Today</b> shows a card: <i>Your October review is ready</i> (you also get a notification on the 1st). The review shows what you spent and saved compared with the month before, your top spending categories, new strength records, workouts and sets per muscle, weight and waist change, goals achieved and check-ins — and what's coming next month (bills, birthdays, deadlines). Open any month from Calendar → <b>Month review</b> and use ‹ › to go back in time.</p>`],
  ['Recurring tasks & renewals', `<p>For things that come back — car insurance, vignette, ID card or passport expiry, annual check-ups, filter changes — add a task with a <b>repeat</b> (every N days, weeks, months or years) and choose how early to be <b>reminded</b> (up to 3 months before). They're listed under Records → Tasks → <i>Recurring & renewals</i>. Ticking one off logs it and moves it to the next date automatically. Quick add: <code>task car insurance every year 03.12</code>.</p>`],
  ['Calendar, records & reminders', `<p>The <b>Calendar</b> shows everything per day: ◆ workouts, − spending, + income, ▲ bills due, ✓ bills paid, ✦ birthdays, ✧ name days, ⚑ holidays, ◇ planned workouts, □ tasks, ◎ goal deadlines, ★ goals achieved, finished books/games/films. Tap a day for the details.</p>
    <p><b>Records</b> holds people (birthday, name day, keep in touch, gift ideas), tasks & notes, and the media log.</p>
    <p><b>Reminders</b>: birthdays and bills at least 7 days ahead (change in Settings), the day before and on the day; a weekly summary every Monday. Turn on notifications in Settings. On Android and desktop they also arrive while the app is closed (checked a few times a day); on iPhone they show when you open the app.</p>`],
  ['Correcting your savings balance', `<p>If the savings balance in Oracle doesn't match your real savings (for example after a paycheck put in the wrong amount), go to <b>Money → Savings & goals</b> and press <b>✎ Correct</b> on the balance (or tap the balance).</p>
    <ul><li>Type what your savings really are. Oracle shows the difference and saves it as a <b>manual correction</b>.</li>
    <li>The correction appears in <b>Money → Transactions</b> (in grey, marked “Manual correction”) and in the savings history, but it is <b>not spending</b>: Needs, Wants, safe to spend and the savings budget are untouched, and it doesn't count as money saved in your monthly review.</li>
    <li>Tap the correction in Transactions to change it or delete it.</li></ul>`],
  ['Gifts', `<p><b>Gifts</b> is a Wants category (next to Eating out and Hobbies), and <b>Records → Gifts</b> lets you plan them ahead.</p>
    <ul><li><b>Plan a gift</b>: pick the person and the occasion — birthday, name day, Christmas, wedding, anniversary or any event. The date fills itself in from their birthday / name day, and their gift ideas are copied in. Add a budget.</li>
    <li>The budget is <b>set aside from Wants</b> in the pay period of that date, so <i>safe to spend</i> and <i>Wants left</i> already count it (Money → Overview shows “€40 for gifts”).</li>
    <li><b>Bought</b> (in Records → Gifts, on the person's card or in Today's Upcoming): enter what you paid — it becomes a Gifts expense and the set-aside money is released. Paying more or less than planned is shown.</li>
    <li><b>Coming up — no gift yet</b> lists birthdays and name days in the next 45 days without a plan. Each person's card in People shows their next gift or a <b>Plan gift</b> button.</li>
    <li>Gifts show on the calendar ❖ and you're reminded before the date. <i>By person</i> shows what you've spent and planned for everyone this year.</li>
    <li>Quick add works too: <code>35 gifts mum</code>.</li></ul>
    <p><b>Gifts you receive</b>: when you tick a wishlist item choose <b>❖ Received as a gift</b> and pick who it's from — no expense is created and your budgets stay as they are. It moves to the wishlist's <i>Got</i> list marked “gift from …”. For gifts that weren't on the wishlist use <b>+ Received gift</b> in Records → Gifts. Everything you get is listed under <i>Received</i>, and each person's card shows <i>Gave you</i>. Untick the item (or delete the entry) to put it back on the wishlist.</p>`],
  ['Training plan', `<p><b>Gym → Plan</b>: type a workout name for each training day (e.g. Monday <i>Push</i>, Wednesday <i>Pull</i>, Friday <i>Legs</i>) and leave rest days empty — or tap a template and adjust it. The plan syncs to all your devices.</p>
    <ul><li><b>Today</b> shows <i>Today: Push</i> or <i>Rest day</i>; the calendar shows ◇ planned days ahead.</li><li>A planned day counts as done when a workout from that day is imported from Hevy.</li>
    <li><b>Sticking to the plan</b> shows ✓ done, ✗ missed and ◆ extra workouts for the last 4 weeks, and your % over 7 weeks.</li>
    <li>Reminders: on a planned day, and the morning after a missed one. Turn them off in Settings → Reminders.</li></ul>`],
  ['Focus timer', `<p><b>Goals → Focus timer</b>. Type what you're working on (your last labels are suggested), pick the minutes — <i>Pomodoro 25</i>, <i>Long 50</i>, <i>Short 15</i> or any number — and optionally a goal it counts toward. Press <b>▶ Start</b>.</p>
    <ul><li>It keeps counting when you switch apps or lock the phone. When time is up you hear a beep, get a notification (if on) and can start a 5/10/15 min break.</li>
    <li><b>Pause</b>, <b>Finish & save</b> early (anything over a minute is saved) or <b>Discard</b>.</li>
    <li>Stats: today, this week, 30 days, streak, a 14-day chart and time per label.</li>
    <li>Goals can track hours automatically: edit a goal → <i>A number</i> → track from <i>Focus timer hours</i>, then pick that goal when starting sessions.</li></ul>`],
  ['Keep in touch & name days', `<p>Edit a person in <b>Records → People</b>:</p>
    <ul><li><b>Keep in touch</b>: every week, 2 weeks, month… When it's due, Today shows <i>Catch up with Ivan</i> and you get a reminder. Press <b>Talked</b> / <b>Talked today</b> to reset the clock.</li>
    <li><b>Name day</b>: found automatically from the name for common Bulgarian names (Иван/Ivan, Мария/Maria, Георги/Georgi…). If it's not found or the family celebrates a different day, choose <i>Pick the date</i>; or <i>Doesn't celebrate</i>. Name-day traditions vary, so check the date shown once.</li></ul>
    <p><b>Bulgarian holidays</b> (incl. Orthodox Easter and the extra day off when a holiday falls on a weekend) show in the calendar ⚑, in Upcoming, as a reminder the day before, and paydays skip them. Tap a calendar day to see whose name day it is. Turn all of this off in Settings → Reminders.</p>`],
  ['Media log', `<p><b>Records → Media log</b> keeps books, comics, games, films and series in four lists: <i>Want to</i>, <i>In progress</i>, <i>Finished</i>, <i>Dropped</i>.</p>
    <ul><li><b>+ Add</b> a title; press <b>Start</b> when you begin and <b>Finished</b> when done — then rate it ★1–5.</li><li>Track progress like <i>p. 120</i> or <i>S2E4</i>.</li>
    <li>When you tick off a wishlist item you can add it to the media log in the same step.</li><li>Finished titles appear on the calendar and in your monthly review.</li></ul>`],
  ['Net worth & investments', `<p><b>Money → Net worth</b> adds up everything you own minus what you owe: your Oracle savings (automatic) plus accounts you add — bank, ETFs, crypto, pension, property, cash — and loans or debts.</p>
    <ul><li><b>+ Add</b> an account with its current value. Once a month press <b>Update values</b> and type today's balances — Today reminds you in the monthly review.</li>
    <li>The chart shows net worth over time. Tap an account to see or fix its value history.</li>
    <li><b>Track gains</b>: when you log an expense under <i>Investing</i>, choose <i>Went into account</i>. The account then shows what you put in and how much it's up or down.</li></ul>`],
  ['Subscription check-up', `<p>Bills and subscriptions can be <b>monthly or yearly</b> (choose <i>Once a year</i> and the month). Yearly ones are reminded at least 14 days ahead.</p>
    <ul><li>When you change the amount of a bill, the old and new price are kept — ▲/▼ shows it in the list and the edit window shows the history.</li>
    <li>Once a year each subscription comes back in <b>Subscription check-up</b> (Money → Bills & subscriptions) with its yearly cost: <b>Keep</b> or <b>Cancel</b>. Cancelled ones stop counting and show how much you save; <i>undo</i> brings them back.</li></ul>`],
  ['Look, privacy & app lock', `<p><b>Settings → Appearance</b> (this device only): accent colour (8 presets or any colour), background (Midnight, Pure black, Graphite, Deep navy) and text size.</p>
    <p><b>Hide amounts</b>: the eye button at the top swaps every amount for €•••• — handy in public. <i>Hide amounts every time the app opens</i> makes it the default.</p>
    <p><b>App lock</b> is optional and per device: Settings → Privacy & lock → <b>Set PIN</b> (4–8 digits). Choose when it locks again after you leave the app (immediately to 1 hour); the lock button at the top locks it right away. On phones you can also turn on <b>fingerprint / face</b> — the PIN still works. On a computer it's PIN only.</p>
    <p>After 5 wrong tries you have to wait. <b>Forgot PIN?</b> — with sync on, enter your sync passphrase to remove it; without sync the only way is to erase this device's data (restore from sync or a backup afterwards). The lock keeps people out of the app; it doesn't encrypt the device.</p>`],
  ['App-icon shortcuts', `<p>Long-press the Oracle 2 icon on your phone, or right-click it in the Windows taskbar / Start menu, for shortcuts: <b>Quick add</b>, <b>Add expense</b>, <b>Log weight</b>, <b>Import workout</b>, <b>Start focus</b>, <b>Training plan</b>.</p>
    <p>Installed apps pick up new shortcuts after an update; if they don't show, remove the app and install it again (your data stays — it's stored by the browser, and sync brings it back anyway).</p>`],
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

// ---------------- guided walkthrough (points at the real screen) — once per device
const TOUR_VERSION = 2;
const navEl = v => innerWidth < 760 && (v === 'settings' || v === 'help') ? `.topbtn[data-view=${v}]` : `nav a[data-view=${v}]`;
const TOUR_STEPS = [
  {html: () => `<div class="tour-hero"><svg viewBox="0 0 32 32" width="40" height="40"><circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="16" cy="16" r="4.2" fill="var(--accent)"/><path d="M16 1v5M16 26v5M1 16h5M26 16h5" stroke="currentColor" stroke-width="2"/></svg></div>
    <h2>Welcome to Oracle 2</h2><p>Your private day-to-day assistant: <b>money</b>, <b>gym</b>, <b>goals</b>, <b>birthdays & tasks</b> and a <b>calendar</b> that ties it together.</p><p class="muted">Everything stays on this device unless you turn on sync. This short tour shows where everything is — about a minute.</p>`},
  {html: () => `<h2>Set up your money split</h2><p>Every paycheck is split three ways. Pick what suits you — it must add up to 100%.</p>
    <div class="formgrid" style="grid-template-columns:repeat(3,1fr)">${['needs', 'wants', 'savings'].map(k => `<label class="f">${k.toUpperCase()} %<input type="number" inputmode="numeric" id="tw_${k}" value="${D.settings.split[k]}" oninput="tourSplit()"></label>`).join('')}</div>
    <div class="meter" id="twBar" style="height:10px"></div><div class="small" id="twSum"></div>
    <label class="f mt">Savings you already have (€)<input type="number" inputmode="decimal" id="tw_sav" value="${D.settings.startingSavings || ''}" placeholder="0"></label>
    <p class="small muted"><b>Needs</b> bills, food, essentials · <b>Wants</b> your free money ("safe to spend") · <b>Savings</b> put aside on payday.</p>`, setup: true},
  {view: 'today', el: () => '#view .grid.g4', title: 'Today', text: 'Your home screen: what you can <b>safely spend today and this week</b> (from wants), what\'s left for needs, your savings, and below it the week ahead, reminders and goals.'},
  {view: 'today', el: () => innerWidth < 760 ? '#fab' : '#quickBtn', title: 'Quick add', text: 'The fastest way to log anything — spending, tasks, goals, weight. Type one line like <code>12.50 food lidl</code>; the preview lets you fix the category, budget and date before saving.'},
  {el: () => navEl('money'), title: 'Money', text: 'Enter your <b>paycheck</b> and approve the split, log expenses, add <b>bills & subscriptions</b> once, keep a <b>wishlist</b>, set <b>wants limits</b> and review the leftover at the end of each pay period.'},
  {el: () => navEl('gym'), title: 'Gym', text: 'Import workouts from Hevy (copy as text → paste). See progress per exercise, sets per muscle, records, weight & waist trends and tips.'},
  {el: () => navEl('goals'), title: 'Goals', text: 'Anything you want to achieve — with steps or a number, a deadline, and reminders to check in.'},
  {el: () => navEl('records'), title: 'Records', text: 'People & birthdays (with gift ideas), tasks, notes, and recurring things like insurance or ID renewals.'},
  {el: () => navEl('calendar'), title: 'Calendar', text: 'Every day at a glance: workouts, spending, income, bills, birthdays, tasks and goal deadlines. Open <b>Month review</b> from here too.'},
  {el: () => navEl('settings'), title: 'Settings', text: 'Turn on <b>notifications</b>, set up <b>sync</b> with your other devices, change your split, categories and goal weight, and make backups.'},
  {el: () => navEl('help'), title: 'Help', text: 'Everything explained, any time — and you can replay this tour from there.'},
  {html: () => `<h2>You're set</h2><ul class="tour-list"><li><b>Reminders</b> for birthdays, bills and goals: <button class="btn sm" onclick="enableNotifications()">Turn on notifications</button></li>
    <li><b>Install</b> the app so it opens like a normal app — Help → <i>Install</i>.</li><li><b>Sync</b> your phone and computer: Settings → <i>Set up sync</i>.</li></ul><p class="muted">First thing to do: Money → <b>+ Paycheck</b>.</p>`, last: true},
];
let TOUR = 0, tourDone = null;
function startTour(after) { TOUR = 0; tourDone = after || null; closeModal(); tourShow(); }
function tourLayer() {
  let l = $('#tourLayer'); if (l) return l;
  l = document.createElement('div'); l.id = 'tourLayer'; l.innerHTML = '<div id="tourSpot"></div><div id="tourCard" class="modal-box"></div>'; document.body.appendChild(l);
  addEventListener('resize', () => $('#tourLayer') && tourPlace());
  return l;
}
function tourShow() {
  const st = TOUR_STEPS[TOUR]; if (!st) return tourEnd();
  if (st.view && UI.view !== st.view) go(st.view);
  const l = tourLayer(), card = $('#tourCard'), n = TOUR_STEPS.length;
  const nav = `<div class="row mt" style="margin-top:16px"><span class="dots">${TOUR_STEPS.map((_, i) => `<i class="${i === TOUR ? 'on' : ''}"></i>`).join('')}</span><span class="sp"></span>
    ${st.last ? '' : `<button class="btn ghost sm" onclick="tourEnd()">Skip</button>`}${TOUR ? `<button class="btn ghost sm" onclick="tourNext(-1)">Back</button>` : ''}<button class="btn pri sm" id="twNext" onclick="tourNext(1)">${st.last ? 'Start using Oracle 2' : 'Next'}</button></div>`;
  card.innerHTML = `<div class="tour">${st.html ? st.html() : `<div class="small faint">${TOUR + 1} / ${n}</div><h2>${st.title}</h2><p>${st.text}</p>`}${nav}</div>`;
  l.className = st.el ? 'spot' : 'center';
  if (st.setup) tourSplit();
  tourPlace();
}
function tourPlace() {
  const st = TOUR_STEPS[TOUR], spot = $('#tourSpot'), card = $('#tourCard'); if (!st || !card) return;
  const t = st.el && document.querySelector(st.el());
  if (!t) { spot.style.display = 'none'; $('#tourLayer').className = 'center'; card.style.cssText = ''; return; }
  t.scrollIntoView({block: 'nearest'});
  const r = t.getBoundingClientRect(), pad = 6, vw = innerWidth, vh = innerHeight;
  Object.assign(spot.style, {display: 'block', left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px'});
  const w = Math.min(360, vw - 24); card.style.width = w + 'px'; card.style.position = 'fixed';
  const ch = card.offsetHeight, below = r.bottom + 14 + ch < vh;
  card.style.top = (below ? r.bottom + 14 : Math.max(12, r.top - 14 - ch)) + 'px';
  card.style.left = Math.max(12, Math.min(vw - w - 12, r.left + r.width / 2 - w / 2)) + 'px';
}
function tourSplit() {
  const v = ['needs', 'wants', 'savings'].map(k => num(val('tw_' + k))), t = sum(v);
  $('#twBar').innerHTML = v.map((x, i) => `<i style="width:${x}%;background:${PAL[['needs', 'wants', 'savings'][i]]}"></i>`).join('');
  $('#twSum').innerHTML = t === 100 ? '<span class="good">✓ adds up to 100%</span>' : `<span class="bad">${t}% — must be 100%</span>`; $('#twNext').disabled = t !== 100;
}
function tourNext(d) {
  if (TOUR_STEPS[TOUR].setup && d > 0) { ['needs', 'wants', 'savings'].forEach(k => D.settings.split[k] = num(val('tw_' + k))); D.settings.startingSavings = num(val('tw_sav')); commit(); }
  TOUR += d; if (TOUR >= TOUR_STEPS.length) return tourEnd(); tourShow();
}
async function tourEnd() {
  $('#tourLayer')?.remove(); D.settings.onboarded = true; commit(); go('today');
  await store.set('tourSeen', TOUR_VERSION);
  const f = tourDone; tourDone = null; if (f) f();
}

// ---------------- what's new (shown once on each device after an update)
const CHANGELOG = [
  {v: '2.7.0', items: ['Wishlist: tick an item as “Received as a gift” — no expense, budgets untouched', 'Records → Gifts: a Received list and “+ Received gift” for gifts that weren\'t on the wishlist', 'People cards show what each person gave you']},
  {v: '2.6.1', items: ['Correct your savings balance by hand: Money → Savings & goals → ✎ Correct', 'Corrections show in Transactions as “Manual correction” and never touch Needs, Wants or the savings budget']},
  {v: '2.6.0', items: ['Gifts: a new Wants category, plus Records → Gifts to plan gifts for birthdays, name days, Christmas and other events', 'A planned gift\'s budget is set aside from Wants in its pay period — safe to spend already counts it', '“Bought” turns a plan into a Gifts expense; see what you spend per person', 'Reminders and calendar entries for planned gifts; Today shows gifts coming up', 'Redesigned lock screen: bigger keys spread across the screen, faster response, live wait countdown']},
  {v: '2.5.0', items: ['Hide amounts — the eye button at the top', 'Optional app lock with a PIN per device; fingerprint / face on phones', 'Your own colours: accent, background and text size (Settings → Appearance)', 'Bulgarian holidays & name days in the calendar, Today and reminders — paydays skip holidays', 'Keep in touch: get nudged to call people you haven\'t talked to in a while', 'Focus timer (Goals → Focus timer)', 'Media log for books, games, films & series (Records → Media log)', 'Net worth & investments (Money → Net worth)', 'Subscription check-up: yearly bills, price-change history, a yearly "still using it?"', 'Training plan with fixed weekdays (Gym → Plan)', 'App-icon shortcuts: long-press / right-click the icon', 'Settings sorted into sections; Help covers everything new']},
  {v: '2.4.1', items: ['Wishlist fits phone screens: one compact row per item — coloured dot for need/want, price on the right, "fits this week" underneath, tap a name to edit']},
  {v: '2.4.0', items: ['Transactions fit your phone screen: amount up front, a coloured dot for needs/wants/savings, ↗ for paid from savings, tap a row to edit', 'All numbers are properly rounded — no more 177.45000000000002', 'Quick add: an editable preview (category, budget, paid from, day) so things are sorted right the first time, an Add button, and it remembers how you sorted a note before', 'iPhone: the ✓ above the keyboard now saves in Quick add', 'Wants limits per category with warnings at 80% and when you go over', 'Savings cover: how many months your savings last, plus your normal needs / wants / saved per pay period', 'A new guided tour (shown once on each device)', 'This "What\'s new" window after every update']},
  {v: '2.3.0', items: ['Monthly review', 'Recurring tasks & renewals with early reminders']},
  {v: '2.2.0', items: ['Goals with check-ins and reminders']},
];
const vnum = v => (v || '0').split('.').map(Number).reduce((a, x) => a * 1000 + x, 0);
function showWhatsNew(since) {
  const list = CHANGELOG.filter(c => since === undefined ? c.v === APP_VERSION : vnum(c.v) > vnum(since)).slice(0, 3);
  if (!list.length) return;
  modal(`<h2>What's new</h2>${list.map((c, i) => `<div style="margin-bottom:14px"><div class="${i ? 'muted' : 'acc'} small">Version ${c.v}</div><ul class="tour-list" style="margin:6px 0">${c.items.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('')}
    <div class="row"><span class="sp"></span><button class="btn pri" onclick="closeModal()">Got it</button></div>`);
}
async function afterStart() {
  const last = await store.get('lastVersion'), seen = await store.get('tourSeen');
  await store.set('lastVersion', APP_VERSION);
  const news = () => { if (!UI.fresh && last !== APP_VERSION) showWhatsNew(last === undefined || last === null ? undefined : last); };
  if (qs.get('notour')) return news();
  if ((seen || 0) < TOUR_VERSION) startTour(news); else news();
}

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
      <div class="list mt">${['needs', 'wants', 'savings'].map(k => `<div class="li"><i class="dot" style="background:${PAL[k]}"></i><span class="t">${k[0].toUpperCase() + k.slice(1)}${k === 'savings' ? ' <span class="muted small">→ to savings when you approve</span>' : k === 'needs' ? ' <span class="muted small">bills, food…</span>' : ' <span class="muted small">safe-to-spend money</span>'}</span><span>${eur(amt * sp[k] / 100)}</span></div>`).join('')}</div>
      <div class="small ${tot === 100 ? 'muted' : 'bad'}">${tot === 100 ? `Covers ${fd(val('pc_date') || TODAY)} until ~${next ? fd(addDays(next, -1)) : ''} (next payday est. ${next ? fdl(next) : ''})` : `Split adds up to ${tot}% — must be 100%`}</div>`;
  },
  pcApprove() {
    const amt = r2(num(val('pc_amt'))), date = val('pc_date'), split = {needs: num(val('pc_needs')), wants: num(val('pc_wants')), savings: num(val('pc_savings'))};
    const id = uid(); D.paychecks.push({id, date, amount: amt, split});
    if (split.savings) D.savingsMoves.push({id: uid(), date, amount: r2(amt * split.savings / 100), kind: 'deposit', note: 'From paycheck', paycheckId: id});
    closeModal(); toast(`Paycheck approved · ${eur(amt * split.wants / 100)} for wants`); commit();
    const pend = periodsToReview()[0]; if (pend) setTimeout(() => A.review(pend.pc.id), 500);
  },
  expense(id, date) {
    const t = id ? D.transactions.find(x => x.id === id) : {date: date || TODAY, category: 'Food', source: 'salary', amount: ''};
    modal(`<h2>${id ? 'Edit' : 'New'} expense</h2><div class="formgrid"><label class="f">Amount (€)<input type="number" step="0.01" id="ex_amt" value="${t.amount}"></label><label class="f">Date<input type="date" id="ex_date" value="${t.date}"></label>
      <label class="f">Category<select id="ex_cat" onchange="$('#ex_b').value=catBucket(this.value)">${catOptions(t.category)}</select></label><label class="f">Bucket<select id="ex_b">${['needs', 'wants', 'savings'].map(b => `<option ${(t.bucket || catBucket(t.category)) === b ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
      <label class="f full">Note<input id="ex_note" value="${esc(t.note || '')}" placeholder="optional"></label>
      ${D.assets.some(a => a.kind !== 'debt' && !a.closed) ? `<label class="f full">Went into account (net worth, optional)<select id="ex_asset"><option value="">—</option>${D.assets.filter(a => a.kind !== 'debt' && !a.closed).map(a => `<option value="${a.id}" ${t.assetId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>` : ''}
      <div class="full"><div class="small muted" style="margin-bottom:4px">PAID FROM</div><span class="seg" id="ex_src">${['salary', 'savings'].map(s => `<button class="${t.source === s ? 'on' : ''}" onclick="this.parentNode.querySelectorAll('button').forEach(b=>b.classList.remove('on'));this.classList.add('on')">${s === 'salary' ? 'This month\'s salary' : 'Savings'}</button>`).join('')}</span></div></div>
      <div class="row mt">${id ? `<button class="btn ghost danger" onclick="A.del('transactions','${id}');closeModal()">Delete</button>` : ''}<span class="sp"></span><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn pri" onclick="A.expenseSave('${id || ''}')">Save</button></div>`);
  },
  expenseSave(id) {
    const amt = r2(num(val('ex_amt'))); if (amt <= 0) return toast('Enter an amount');
    const src = $('#ex_src button.on').textContent.startsWith('Savings') ? 'savings' : 'salary';
    const t = {id: id || uid(), amount: amt, date: val('ex_date'), category: val('ex_cat'), bucket: val('ex_b'), note: val('ex_note'), source: src, assetId: $('#ex_asset') ? val('ex_asset') : (id ? D.transactions.find(x => x.id === id).assetId || '' : '')};
    if (id) Object.assign(D.transactions.find(x => x.id === id), t); else { D.transactions.push(t); limitWarn(t.category, t.amount); }
    closeModal(); commit();
  },
  recurring(id) {
    const r = id ? D.recurring.find(x => x.id === id) : {type: 'bill', day: 1, category: 'Bills', amount: ''};
    modal(`<h2>${id ? 'Edit' : 'New'} bill / subscription</h2><div class="formgrid"><label class="f full">Name<input id="rc_name" value="${esc(r.name || '')}" placeholder="Electricity, Netflix…"></label>
      <label class="f">Type<select id="rc_type" onchange="$('#rc_cat').value=this.value==='subscription'?'Subscriptions':'Bills'"><option value="bill" ${r.type === 'bill' ? 'selected' : ''}>Bill</option><option value="subscription" ${r.type === 'subscription' ? 'selected' : ''}>Subscription</option></select></label>
      <label class="f">Amount (€) — typical<input type="number" step="0.01" id="rc_amt" value="${r.amount}"></label><label class="f">Billed<select id="rc_freq" onchange="$('#rc_monw').style.display=this.value==='year'?'':'none'"><option value="month" ${r.freq !== 'year' ? 'selected' : ''}>Every month</option><option value="year" ${r.freq === 'year' ? 'selected' : ''}>Once a year</option></select></label>
      <label class="f" id="rc_monw" style="${r.freq === 'year' ? '' : 'display:none'}">Month<select id="rc_mon">${MONTH_FULL.map((m, i) => `<option value="${i + 1}" ${(+r.month || +TODAY.slice(5, 7)) === i + 1 ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      <label class="f">Day of month due<input type="number" min="1" max="31" id="rc_day" value="${r.day}"></label>
      <label class="f">Category<select id="rc_cat">${catOptions(r.category)}</select></label></div>
      ${(r.history || []).length ? `<div class="qk mt">Price changes</div><div class="list">${r.history.slice().reverse().map(h => `<div class="li small"><span class="muted" style="width:96px">${fd(h.date)} ${h.date.slice(0, 4)}</span><span class="t">${eur(h.from)} → ${eur(h.to)}</span><span class="${h.to > h.from ? 'warn' : 'good'}">${h.to > h.from ? '▲' : '▼'} ${Math.round(Math.abs(h.to - h.from) / (h.from || 1) * 100)}%</span></div>`).join('')}</div>` : ''}
      <div class="row mt">${id ? `<button class="btn ghost danger" onclick="A.del('recurring','${id}');closeModal()">Delete</button>` : ''}<span class="sp"></span><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn pri" onclick="A.recurringSave('${id || ''}')">Save</button></div>`);
  },
  recurringSave(id) {
    const r = {name: val('rc_name'), type: val('rc_type'), amount: r2(num(val('rc_amt'))), day: Math.min(31, Math.max(1, parseInt(val('rc_day')) || 1)), category: val('rc_cat'), freq: val('rc_freq'), month: val('rc_freq') === 'year' ? +val('rc_mon') : null};
    if (!r.name) return toast('Give it a name');
    if (id) { const o = D.recurring.find(x => x.id === id); if (o.amount !== r.amount && o.amount > 0) { o.history = [...(o.history || []), {date: TODAY, from: o.amount, to: r.amount}]; toast(`Price change saved: ${eur(o.amount)} → ${eur(r.amount)}`); } Object.assign(o, r); }
    else D.recurring.push({id: uid(), payments: {}, startDate: TODAY.slice(0, 8) + '01', active: true, ...r});
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
  review(pcId) {
    const pc = D.paychecks.find(x => x.id === pcId); if (!pc) return;
    const p = periodOf(pc), st = periodStats(p), ended = p.end < TODAY, est = Math.max(0, r2(st.leftover));
    modal(`<h2>${ended ? 'Close' : 'Review'} pay period · ${fd(p.start)} – ${fd(p.end)}</h2>
      <table class="small"><tr><td class="muted">Needs budget</td><td class="n">${eur(p.raw.needs)}</td></tr><tr><td class="muted">Needs spent</td><td class="n">−${eur(st.spent.needs).replace('−', '')}</td></tr>
      ${st.committed ? `<tr><td class="muted">Bills still due this period</td><td class="n">−${eur(st.committed)}</td></tr>` : ''}
      <tr><td class="muted">Wants budget</td><td class="n">${eur(p.raw.wants)}</td></tr><tr><td class="muted">Wants spent</td><td class="n">−${eur(st.spent.wants).replace('−', '')}</td></tr>
      <tr><td><b>Calculated leftover</b></td><td class="n"><b class="${st.leftover < 0 ? 'bad' : 'acc'}">${eur(st.leftover)}</b></td></tr></table>
      <label class="f mt">Amount to move to savings (€) — correct it if your bank says otherwise<input type="number" inputmode="decimal" step="0.01" min="0" id="lo_amt" value="${est}"></label>
      <div class="small faint mt">Nothing moves until you confirm.${ended ? '' : ' Reviewing early takes this money out of what\'s left to spend this period.'}</div>
      <div class="row wrap mt"><button class="btn ghost" onclick="closeModal()">Later</button><span class="sp"></span><button class="btn" onclick="A.reviewSave('${pcId}',0)">Don't move anything</button><button class="btn pri" onclick="A.reviewSave('${pcId}',1)">Move to savings</button></div>`);
  },
  reviewSave(pcId, move) {
    const pc = D.paychecks.find(x => x.id === pcId), p = periodOf(pc), a = move ? r2(num(val('lo_amt'))) : 0;
    if (move && a <= 0) return toast('Enter the amount, or choose "Don\'t move anything"');
    if (a > 0) D.savingsMoves.push({id: uid(), date: TODAY, amount: a, kind: 'deposit', note: 'Leftover from ' + fd(p.start) + ' – ' + fd(p.end)});
    pc.leftoverMoved = a; pc.closed = true;
    closeModal(); toast(a > 0 ? `${eur(a)} moved to savings` : 'Period closed — nothing moved'); commit();
    const next = periodsToReview()[0]; if (next) setTimeout(() => A.review(next.pc.id), 400);
  },
  saveMove(kind) {
    modal(`<h2>${kind === 'withdraw' ? 'Withdraw from' : 'Deposit to'} savings</h2><div class="formgrid"><label class="f">Amount (€)<input type="number" step="0.01" id="sm_amt"></label><label class="f">Date<input type="date" id="sm_date" value="${TODAY}"></label><label class="f full">Note<input id="sm_note"></label></div>
      <div class="row mt"><span class="sp"></span><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn pri" onclick="A.saveMoveSave('${kind}')">Save</button></div>`);
  },
  savCorrect(id) {
    const m = id ? D.savingsMoves.find(x => x.id === id) : null, date = m ? m.date : TODAY, now = savingsBalance(date, id);
    modal(`<h2>${m ? 'Edit correction' : 'Correct savings balance'}</h2>
      <div class="small muted" style="margin-bottom:10px;line-height:1.7">Type what your savings really are. The difference is saved as a <b>manual correction</b> — it shows in Transactions but isn't spending, so Needs, Wants and the savings budget stay untouched.</div>
      <div class="formgrid"><label class="f">Oracle says${m ? ' (without this correction)' : ''}<input disabled value="${eur(now)}"></label>
      <label class="f">Actual balance (€)<input type="number" inputmode="decimal" step="0.01" id="sc_to" value="${r2(now + (m ? m.amount : 0))}" oninput="A.savCorrPrev()" data-base="${now}"></label>
      <label class="f">As of<input type="date" id="sc_d" value="${date}" onchange="$('#sc_to').dataset.base=savingsBalance(this.value,'${id || ''}');A.savCorrPrev()"></label>
      <label class="f">Note (optional)<input id="sc_n" value="${esc(m ? m.note || '' : '')}" placeholder="checked bank app"></label></div>
      <div class="mt" id="sc_pv"></div>
      <div class="row mt">${m ? `<button class="btn ghost danger" onclick="A.del('savingsMoves','${id}');closeModal()">Delete</button>` : ''}<span class="sp"></span><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn pri" onclick="A.savCorrSave('${id || ''}')">Save</button></div>`);
    A.savCorrPrev(); setTimeout(() => $('#sc_to')?.select(), 50);
  },
  savCorrPrev() {
    const i = $('#sc_to'), dlt = r2(num(i.value) - +i.dataset.base), el = $('#sc_pv');
    el.innerHTML = i.value === '' ? '' : Math.abs(dlt) < .005 ? '<span class="small muted">No difference — nothing to correct.</span>' : `<span class="small">Correction: <b class="${dlt < 0 ? 'bad' : 'good'}">${dlt > 0 ? '+' : ''}${eur(dlt)}</b> → balance <b>${eur(num(i.value))}</b></span>`;
  },
  savCorrSave(id) {
    const to = r2(num(val('sc_to'))), date = val('sc_d') || TODAY; if (val('sc_to') === '') return toast('Type the actual balance');
    const dlt = r2(to - savingsBalance(date, id));
    if (id) D.savingsMoves = D.savingsMoves.filter(x => x.id !== id);
    if (Math.abs(dlt) < .005) { closeModal(); commit(); return toast(id ? 'Correction removed — no difference left' : 'Balance already matches'); }
    D.savingsMoves.push({id: id || uid(), date, amount: dlt, kind: 'correction', to, note: val('sc_n')});
    closeModal(); commit(); toast(`Savings corrected ${dlt > 0 ? '+' : ''}${eur(dlt)} → ${eur(savingsBalance())}`);
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
    const pick = k => `this.parentNode.querySelectorAll('button').forEach(b=>b.classList.remove('on'));this.classList.add('on');$('#wb_buy').style.display='${k === 'buy' ? '' : 'none'}';$('#wb_gift').style.display='${k === 'gift' ? '' : 'none'}';$('#wb_go').textContent='${k === 'buy' ? 'Mark bought' : 'Save gift'}';$('#wb_go').dataset.k='${k}';$('#wbTitle').firstChild.textContent='${k === 'buy' ? 'Bought' : 'Received'}: '`;
    modal(`<h2 id="wbTitle"><span>Bought: </span>${esc(w.name)}</h2><div style="margin-bottom:12px"><span class="seg"><button class="on" onclick="${pick('buy')}">Bought it</button><button onclick="${pick('gift')}">❖ Received as a gift</button></span></div>
      <div id="wb_gift" style="display:none"><div class="formgrid">${recvFields({worth: w.price, item: w.name})}</div><div class="small faint mt">No expense is created — Needs, Wants and savings stay as they are.</div></div>
      <div id="wb_buy"><div class="formgrid"><label class="f">Price paid (€)<input type="number" step="0.01" id="wb_amt" value="${w.price}"></label><label class="f">Date<input type="date" id="wb_date" value="${TODAY}"></label>
      <label class="f">Budget<select id="wb_b"><option value="needs" ${w.bucket === 'needs' ? 'selected' : ''}>needs</option><option value="wants" ${w.bucket === 'wants' ? 'selected' : ''}>wants</option></select></label><label class="f">Category<select id="wb_cat">${catOptions(w.category || 'Shopping')}</select></label>
      <div class="full"><div class="small muted" style="margin-bottom:4px">PAID FROM</div><span class="seg" id="wb_src">${['salary', 'savings'].map(s => `<button class="${s === 'salary' ? 'on' : ''}" onclick="this.parentNode.querySelectorAll('button').forEach(b=>b.classList.remove('on'));this.classList.add('on')">${s === 'salary' ? 'This month\'s salary' : 'Savings'}</button>`).join('')}</span></div></div></div>
      <label class="li small" style="cursor:pointer;margin-top:10px"><input type="checkbox" id="wb_media" onchange="$('#wb_mk').style.display=this.checked?'':'none'"><span class="t">Add to media log (book, game, film…)</span><select id="wb_mk" style="display:none">${MEDIA_KINDS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
      <div class="row mt"><span class="sp"></span><button class="btn ghost" onclick="closeModal();render()">Cancel</button><button class="btn pri" id="wb_go" data-k="buy" onclick="this.dataset.k==='gift'?A.wishGiftSave('${id}'):A.wishBuySave('${id}')">Mark bought</button></div>`);
  },
  wishBuySave(id) {
    const w = D.wishlist.find(x => x.id === id), amt = r2(num(val('wb_amt'))); if (amt <= 0) return toast('Enter the price');
    const src = $('#wb_src button.on').textContent.startsWith('Savings') ? 'savings' : 'salary', tid = uid();
    D.transactions.push({id: tid, date: val('wb_date'), amount: amt, category: val('wb_cat'), bucket: val('wb_b'), note: w.name, source: src, wishId: id});
    Object.assign(w, {bought: true, boughtAt: val('wb_date'), paid: amt, source: src, txId: tid, bucket: val('wb_b')});
    if ($('#wb_media').checked) D.media.push({id: uid(), added: TODAY, title: w.name, kind: val('wb_mk'), status: 'backlog', wishId: id});
    closeModal(); toast(`${w.name} · ${eur(amt)} from ${src}`); if (src === 'salary') limitWarn(val('wb_cat') || w.category, amt); commit();
  },
  wishGiftSave(id) {
    const w = D.wishlist.find(x => x.id === id), g = recvRead(); if (!g) return;
    const gid = uid(); D.gifts.push({id: gid, dir: 'in', wishId: id, ...g, item: g.item || w.name});
    Object.assign(w, {bought: true, gift: true, giftId: gid, boughtAt: g.date, paid: null, txId: null, source: null});
    if ($('#wb_media').checked) D.media.push({id: uid(), added: TODAY, title: w.name, kind: val('wb_mk'), status: 'backlog', wishId: id});
    closeModal(); toast(`❖ ${w.name} — gift from ${giftWho(g)}`); commit();
  },
  wishUnbuy(id) {
    const w = D.wishlist.find(x => x.id === id);
    if (w.gift) { if (!confirm(`Put "${w.name}" back on your wishlist? The received-gift entry will be removed.`)) return render(); D.gifts = D.gifts.filter(g => g.id !== w.giftId); Object.assign(w, {bought: false, gift: false, giftId: null, boughtAt: null}); return commit(); }
    if (!confirm(`Undo the purchase of "${w.name}"? The ${eur(w.paid ?? w.price)} expense will be removed.`)) return render();
    D.transactions = D.transactions.filter(t => t.id !== w.txId);
    Object.assign(w, {bought: false, boughtAt: null, paid: null, txId: null, source: null}); commit();
  },
  goal2(id) {
    const g = id ? D.lifeGoals.find(x => x.id === id) : {kind: 'simple', category: 'Personal', remind: 'weekly', remindDay: 0, status: 'active', source: 'manual', steps: []};
    UI.gk = g.kind;
    const kindBtn = (k, l) => `<button class="${g.kind === k ? 'on' : ''}" onclick="this.parentNode.querySelectorAll('button').forEach(b=>b.classList.remove('on'));this.classList.add('on');UI.gk='${k}';document.querySelectorAll('[data-gk]').forEach(e=>e.style.display=e.dataset.gk==='${k}'?'':'none')">${l}</button>`;
    modal(`<h2>${id ? 'Edit' : 'New'} goal</h2><div class="formgrid">
      <label class="f full">Goal<input id="gg_t" value="${esc(g.title || '')}" placeholder="Reach 80 kg, run a 5k, read 12 books…"></label>
      <label class="f full">Why it matters (shown with reminders)<input id="gg_why" value="${esc(g.why || '')}" placeholder="optional"></label>
      <label class="f">Category<select id="gg_cat">${GOAL_CATS.map(c => `<option ${c === g.category ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label class="f">Target date (optional)<input type="date" id="gg_date" value="${g.targetDate || ''}"></label>
      <div class="full"><div class="small muted" style="margin-bottom:4px">HOW YOU MEASURE IT</div><span class="seg">${kindBtn('simple', 'Done / not done')}${kindBtn('checklist', 'Steps')}${kindBtn('number', 'A number')}</span></div>
      <label class="f full" data-gk="checklist" style="${g.kind === 'checklist' ? '' : 'display:none'}">Steps — one per line<textarea id="gg_steps" rows="5" placeholder="Buy running shoes&#10;Run 2 km&#10;Run 5 km">${esc((g.steps || []).map(s => s.text).join('\n'))}</textarea></label>
      <div class="full formgrid" data-gk="number" style="${g.kind === 'number' ? '' : 'display:none'};grid-template-columns:1fr 1fr">
        <label class="f">Track automatically from<select id="gg_src">${[['manual', 'I\'ll enter it'], ['weight', 'Body weight log'], ['waist', 'Waist log'], ['savings', 'Savings balance'], ['focus', 'Focus timer hours']].map(([k, l]) => `<option value="${k}" ${g.source === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="f">Unit<input id="gg_unit" value="${esc(g.unit || '')}" placeholder="kg, km, books…"></label>
        <label class="f">Start value<input type="number" inputmode="decimal" step="any" id="gg_start" value="${g.start ?? ''}"></label>
        <label class="f">Target value<input type="number" inputmode="decimal" step="any" id="gg_target" value="${g.target ?? ''}"></label></div>
      <label class="f">Remind me to check in<select id="gg_rem" onchange="$('#gg_dayw').style.display=this.value==='weekly'?'':'none'">${[['off', 'Never'], ['daily', 'Every day'], ['weekly', 'Every week'], ['monthly', 'Every month (1st)']].map(([k, l]) => `<option value="${k}" ${g.remind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f" id="gg_dayw" style="${g.remind === 'weekly' ? '' : 'display:none'}">On<select id="gg_day">${WEEKDAYS.map((d, i) => `<option value="${i}" ${+g.remindDay === i ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
      ${id ? `<label class="f">Status<select id="gg_status">${[['active', 'Active'], ['paused', 'Paused'], ['done', 'Achieved']].map(([k, l]) => `<option value="${k}" ${g.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}</div>
      <div class="row mt">${id ? `<button class="btn ghost danger" onclick="if(confirm('Delete this goal?')){A.del('lifeGoals','${id}');closeModal()}">Delete</button>` : ''}<span class="sp"></span><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn pri" onclick="A.goal2Save('${id || ''}')">Save</button></div>`);
  },
  goal2Save(id) {
    const old = id ? D.lifeGoals.find(x => x.id === id) : null;
    const g = {title: val('gg_t'), why: val('gg_why'), category: val('gg_cat'), targetDate: val('gg_date'), kind: UI.gk, remind: val('gg_rem'), remindDay: +val('gg_day') || 0};
    if (!g.title) return toast('Give the goal a name');
    if (g.kind === 'checklist') {
      const prev = (old && old.steps) || [];
      g.steps = val('gg_steps').split('\n').map(t => t.trim()).filter(Boolean).map(text => ({text, done: !!(prev.find(s => s.text === text) || {}).done}));
      if (!g.steps.length) return toast('Add at least one step');
    }
    if (g.kind === 'number') {
      Object.assign(g, {source: val('gg_src'), unit: val('gg_unit'), target: num(val('gg_target'))});
      const cur = g.source === 'manual' ? null : goalCurrent({...g, kind: 'number'});
      g.start = val('gg_start') === '' ? (cur ?? 0) : num(val('gg_start'));
      if (val('gg_target') === '') return toast('Set a target value');
      if (g.source === 'manual' && (!old || old.current == null)) g.current = g.start;
    }
    if (id) { const st = val('gg_status'); if (st === 'done' && old.status !== 'done') g.doneAt = TODAY; if (st !== 'done') g.doneAt = null; g.status = st; Object.assign(old, g); }
    else D.lifeGoals.push({id: uid(), created: TODAY, status: 'active', log: [], ...g});
    closeModal(); commit();
  },
  goalStep(id, i) {
    const g = D.lifeGoals.find(x => x.id === id), s = g.steps[i]; s.done = !s.done;
    if (s.done) (g.log ||= []).push({date: TODAY, note: '✓ ' + s.text});
    commit(); if (goalProgress(g) >= 1) toast('All steps done — mark the goal achieved ★');
  },
  goalCheckin(id) {
    const g = D.lifeGoals.find(x => x.id === id), cur = goalCurrent(g);
    modal(`<h2>Check in · ${esc(g.title)}</h2>${g.why ? `<div class="small muted" style="font-style:italic">“${esc(g.why)}”</div>` : ''}
      ${g.kind === 'number' ? (g.source === 'manual' ? `<label class="f mt">Where are you now? (${esc(g.unit || 'value')}) — target ${goalNum(g, g.target)}<input type="number" inputmode="decimal" step="any" id="gc_val" value="${cur ?? ''}"></label>`
        : `<div class="small mt">Now: <b>${goalNum(g, cur)}</b> (from your ${g.source} log) · target ${goalNum(g, g.target)}${g.source !== 'savings' ? ` <button class="btn sm" onclick="closeModal();A.bodyLog()">Log ${g.source}</button>` : ''}</div>`) : ''}
      ${g.kind === 'checklist' ? `<div class="list mt">${g.steps.map((s, i) => `<label class="li small"><input type="checkbox" data-step="${i}" ${s.done ? 'checked' : ''}><span class="t" style="white-space:normal">${esc(s.text)}</span></label>`).join('')}</div>` : ''}
      <label class="f mt">How is it going? (optional)<textarea id="gc_note" rows="3" placeholder="What did you do, what's blocking you, next step…"></textarea></label>
      ${(g.log || []).length ? `<div class="small faint mt" style="line-height:1.7">${g.log.slice(-4).reverse().map(l => `${fd(l.date)}${l.value != null ? ' · ' + goalNum(g, l.value) : ''}${l.note ? ' — ' + esc(l.note) : ''}`).join('<br>')}</div>` : ''}
      <div class="row wrap mt"><button class="btn ghost" onclick="closeModal()">Cancel</button><span class="sp"></span><button class="btn" onclick="A.goalCheckinSave('${id}',1)">★ Achieved!</button><button class="btn pri" onclick="A.goalCheckinSave('${id}',0)">Save check-in</button></div>`);
  },
  goalCheckinSave(id, achieved) {
    const g = D.lifeGoals.find(x => x.id === id), e = {date: TODAY, note: val('gc_note')};
    if (g.kind === 'number' && g.source === 'manual' && $('#gc_val') && val('gc_val') !== '') { g.current = num(val('gc_val')); e.value = g.current; }
    else if (g.kind === 'number') e.value = goalCurrent(g);
    if (g.kind === 'checklist') document.querySelectorAll('#modalBox [data-step]').forEach(cb => g.steps[+cb.dataset.step].done = cb.checked);
    (g.log ||= []).push(e);
    if (achieved) { g.status = 'done'; g.doneAt = TODAY; }
    closeModal(); toast(achieved ? `★ ${g.title} — achieved!` : 'Check-in saved'); commit();
  },
  goalDone(id) { const g = D.lifeGoals.find(x => x.id === id); g.status = 'done'; g.doneAt = TODAY; (g.log ||= []).push({date: TODAY, note: 'Achieved'}); toast(`★ ${g.title} — achieved!`); commit(); },
  pinSet(change) {
    modal(`<h2>${change ? 'Change' : 'Set'} PIN</h2><div class="small muted" style="margin-bottom:10px">4 to 8 digits. Only for this device — it's never synced.</div><div class="formgrid">
      ${change ? '<label class="f full">Current PIN<input type="password" inputmode="numeric" id="pn_old" autocomplete="off"></label>' : ''}
      <label class="f">New PIN<input type="password" inputmode="numeric" id="pn_1" autocomplete="off"></label><label class="f">Repeat new PIN<input type="password" inputmode="numeric" id="pn_2" autocomplete="off"></label></div>
      <div class="row mt"><span class="sp"></span><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn pri" onclick="A.pinSave(${change})">Save PIN</button></div>`);
  },
  async pinSave(change) {
    const p1 = $('#pn_1').value, p2 = $('#pn_2').value;
    if (change && await pinHash($('#pn_old').value, PREFS.lock.salt) !== PREFS.lock.hash) return toast('Current PIN is wrong');
    if (!/^\d{4,8}$/.test(p1)) return toast('Use 4 to 8 digits');
    if (p1 !== p2) return toast('The PINs don\'t match');
    const salt = b64(rnd(16));
    PREFS.lock = {...(PREFS.lock || {}), salt, hash: await pinHash(p1, salt), len: p1.length, after: (PREFS.lock || {}).after ?? 1, fails: 0, until: 0};
    await savePrefs(); applyTheme(); closeModal(); toast(change ? 'PIN changed' : 'App lock on'); render();
  },
  pinOff() {
    modal(`<h2>Turn off app lock</h2><label class="f">Enter your PIN<input type="password" inputmode="numeric" id="pn_old" autocomplete="off"></label><div class="row mt"><span class="sp"></span><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn danger" onclick="A.pinOffSave()">Turn off</button></div>`);
  },
  async pinOffSave() { if (await pinHash($('#pn_old').value, PREFS.lock.salt) !== PREFS.lock.hash) return toast('Wrong PIN'); delete PREFS.lock; await savePrefs(); applyTheme(); closeModal(); toast('App lock off'); render(); },
  async bioToggle() {
    if (PREFS.lock.cred) { delete PREFS.lock.cred; await savePrefs(); return render(); }
    try {
      const c = await navigator.credentials.create({publicKey: {challenge: rnd(32), rp: {name: 'Oracle 2', id: location.hostname}, user: {id: rnd(16), name: 'oracle2', displayName: 'Oracle 2'}, pubKeyCredParams: [{type: 'public-key', alg: -7}, {type: 'public-key', alg: -257}], authenticatorSelection: {authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged'}, timeout: 60000}});
      PREFS.lock.cred = b64(c.rawId); await savePrefs(); toast('Fingerprint / face unlock on'); render();
    } catch { toast('Couldn\'t set up fingerprint / face on this device'); }
  },
  // ---- gifts
  gift(id, preset) {
    const g = id ? D.gifts.find(x => x.id === id) : {occasion: 'birthday', budget: '', ...(preset || {})}, p = D.people.find(x => x.id === g.personId);
    if (!id && p && !g.idea) g.idea = p.gifts || '';
    modal(`<h2>${id ? 'Edit gift' : 'Plan a gift'}</h2><div class="formgrid">
      <label class="f">For<select id="gf_p" onchange="A.giftAuto()"><option value="">— someone not in People —</option>${D.people.slice().sort((a, b) => a.name.localeCompare(b.name)).map(x => `<option value="${x.id}" ${g.personId === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <label class="f" id="gf_whow" style="${g.personId ? 'display:none' : ''}">Name<input id="gf_who" value="${esc(g.who || '')}" placeholder="colleague, cousin's kid…"></label>
      <label class="f">Occasion<select id="gf_o" onchange="A.giftAuto()">${OCCASIONS.map(([k, l]) => `<option value="${k}" ${g.occasion === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f" id="gf_tw" style="${g.occasion === 'other' || g.occasion === 'wedding' || g.occasion === 'anniversary' ? '' : 'display:none'}">Event name<input id="gf_t" value="${esc(g.title || '')}" placeholder="housewarming, graduation…"></label>
      <label class="f">Date<input type="date" id="gf_d" value="${g.date || occasionDate(g.occasion, p) || ''}"></label>
      <label class="f">Budget (€)<input type="number" inputmode="decimal" step="0.01" id="gf_b" value="${g.budget || ''}" placeholder="0.00"></label>
      <label class="f full">Gift idea<input id="gf_i" value="${esc(g.idea || '')}" placeholder="what you'll get"></label></div>
      <div class="small faint mt">The budget is set aside from Wants in the pay period of this date until you mark it bought.</div>
      ${g.status === 'bought' ? `<div class="small mt">Bought ${fd(g.boughtAt)} for <b>${eur(+g.paid || 0)}</b> · <a class="acc" style="cursor:pointer" onclick="A.giftUnbuy('${id}')">undo</a></div>` : ''}
      <div class="row mt">${id ? `<button class="btn ghost danger" onclick="A.giftDel('${id}')">Delete</button>` : ''}<span class="sp"></span><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn pri" onclick="A.giftSave('${id || ''}')">Save</button></div>`);
  },
  recvGift(id) {
    const g = id ? D.gifts.find(x => x.id === id) : {}, w = g.wishId && D.wishlist.find(x => x.id === g.wishId);
    modal(`<h2>${id ? 'Received gift' : 'Log a gift you received'}</h2><div class="formgrid">${recvFields(g)}</div><div class="small faint mt">${w ? 'From your wishlist. ' : ''}Not an expense — your budgets stay as they are.</div>
      <div class="row mt">${id ? `<button class="btn ghost danger" onclick="A.recvDel('${id}')">Delete</button>` : ''}<span class="sp"></span><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn pri" onclick="A.recvSave('${id || ''}')">Save</button></div>`);
  },
  recvSave(id) { const g = recvRead(); if (!g) return; if (!g.item) return toast('What did you get?'); if (id) Object.assign(D.gifts.find(x => x.id === id), g); else D.gifts.push({id: uid(), dir: 'in', ...g}); closeModal(); commit(); toast(`❖ ${g.item} from ${giftWho(g)}`); },
  recvDel(id) { const g = D.gifts.find(x => x.id === id), w = g.wishId && D.wishlist.find(x => x.id === g.wishId); if (!confirm(w ? `Delete this and put "${w.name}" back on your wishlist?` : 'Delete this received gift?')) return; if (w) Object.assign(w, {bought: false, gift: false, giftId: null, boughtAt: null}); A.del('gifts', id); closeModal(); },
  giftAuto() {
    const p = D.people.find(x => x.id === val('gf_p')), o = val('gf_o');
    $('#gf_whow').style.display = p ? 'none' : ''; $('#gf_tw').style.display = ['other', 'wedding', 'anniversary'].includes(o) ? '' : 'none';
    const d = occasionDate(o, p); if (d) $('#gf_d').value = d;
    if (p && !val('gf_i') && p.gifts) $('#gf_i').value = p.gifts;
  },
  giftSave(id) {
    const g = {personId: val('gf_p'), who: val('gf_p') ? '' : val('gf_who'), occasion: val('gf_o'), title: val('gf_t'), date: val('gf_d'), budget: r2(num(val('gf_b'))), idea: val('gf_i')};
    if (!g.personId && !g.who) return toast('Who is it for?'); if (!g.date) return toast('Pick the date');
    if (id) Object.assign(D.gifts.find(x => x.id === id), g); else D.gifts.push({id: uid(), status: 'planned', ...g});
    closeModal(); commit(); toast(g.budget ? `${eur(g.budget)} set aside for ${giftWho(g)}` : 'Gift planned');
  },
  giftDel(id) { const g = D.gifts.find(x => x.id === id); if (!confirm(g.txId ? 'Delete this gift? Its expense stays in your transactions.' : 'Delete this gift plan?')) return; A.del('gifts', id); closeModal(); },
  giftBuy(id) {
    const g = D.gifts.find(x => x.id === id);
    modal(`<h2>Bought: ${esc(giftTitle(g))}</h2><div class="formgrid"><label class="f">Paid (€)<input type="number" inputmode="decimal" step="0.01" id="gb_amt" value="${g.budget || ''}"></label><label class="f">Date<input type="date" id="gb_d" value="${TODAY}"></label>
      <label class="f full">What did you get<input id="gb_i" value="${esc(g.idea || '')}"></label>
      <div class="full"><div class="small muted" style="margin-bottom:4px">PAID FROM</div><span class="seg" id="gb_src"><button class="on" onclick="this.parentNode.querySelectorAll('button').forEach(b=>b.classList.remove('on'));this.classList.add('on')">Salary (Wants)</button><button onclick="this.parentNode.querySelectorAll('button').forEach(b=>b.classList.remove('on'));this.classList.add('on')">Savings</button></span></div></div>
      <div class="row mt"><span class="sp"></span><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn pri" onclick="A.giftBuySave('${id}')">Save</button></div>`);
  },
  giftBuySave(id) {
    const g = D.gifts.find(x => x.id === id), amt = r2(num(val('gb_amt'))); if (amt <= 0) return toast('Enter what you paid');
    ensureGiftsCategory(); const src = $('#gb_src button.on').textContent.startsWith('Savings') ? 'savings' : 'salary', tid = uid(), cat = D.settings.categories.find(c => c.name === 'Gifts');
    D.transactions.push({id: tid, date: val('gb_d'), amount: amt, category: 'Gifts', bucket: cat.bucket, note: `Gift: ${giftTitle(g)}${val('gb_i') ? ' — ' + val('gb_i') : ''}`, source: src, giftId: id});
    Object.assign(g, {status: 'bought', paid: amt, boughtAt: val('gb_d'), txId: tid, idea: val('gb_i') || g.idea});
    closeModal(); toast(`${eur(amt)} gift for ${giftWho(g)}${g.budget ? (amt > g.budget ? ` · ${eur(amt - g.budget)} over budget` : amt < g.budget ? ` · ${eur(g.budget - amt)} under budget` : '') : ''}`); if (src === 'salary') limitWarn('Gifts', amt); commit();
  },
  giftUnbuy(id) { const g = D.gifts.find(x => x.id === id); if (!confirm(`Undo? The ${eur(+g.paid || 0)} expense will be removed and the budget set aside again.`)) return; D.transactions = D.transactions.filter(t => t.id !== g.txId); Object.assign(g, {status: 'planned', paid: null, boughtAt: null, txId: null}); closeModal(); commit(); },
  // ---- training plan
  trDay(i, v) { const t = D.settings.training = {...(D.settings.training || {}), days: {...trDays()}}; v = v.trim(); if (v) t.days[i] = v; else delete t.days[i]; commit(); },
  trTemplate(i) { D.settings.training = {...(D.settings.training || {}), days: i < 0 ? {} : {...TR_TEMPLATES[i][1]}}; commit(); if (i >= 0) toast(TR_TEMPLATES[i][0] + ' set — edit any day'); },
  // ---- keep in touch
  talked(id) { const p = D.people.find(x => x.id === id); p.lastContact = TODAY; commit(); toast(`Noted — next nudge in ${p.keepEvery} week${p.keepEvery > 1 ? 's' : ''}`); },
  // ---- media
  media(id, preset) {
    const m = id ? D.media.find(x => x.id === id) : {kind: 'book', status: 'backlog', ...(preset || {})};
    modal(`<h2>${id ? 'Edit' : 'Add to'} media log</h2><div class="formgrid"><label class="f full">Title<input id="md_t" value="${esc(m.title || '')}" placeholder="Dune, Elden Ring, Breaking Bad…"></label>
      <label class="f">Kind<select id="md_k">${MEDIA_KINDS.map(([k, l]) => `<option value="${k}" ${m.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f">Status<select id="md_s">${MEDIA_ST.map(([k, l]) => `<option value="${k}" ${m.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f">Author / studio (optional)<input id="md_c" value="${esc(m.creator || '')}"></label><label class="f">Progress (optional)<input id="md_p" value="${esc(m.progress || '')}" placeholder="p. 120, S2E4, 40%…"></label>
      <label class="f">Started<input type="date" id="md_sd" value="${m.started || ''}"></label><label class="f">Finished<input type="date" id="md_fd" value="${m.finished || ''}"></label>
      <div class="full"><div class="small muted" style="margin-bottom:4px">RATING</div><span class="seg" id="md_r">${[0, 1, 2, 3, 4, 5].map(n => `<button class="${(+m.rating || 0) === n ? 'on' : ''}" onclick="this.parentNode.querySelectorAll('button').forEach(b=>b.classList.remove('on'));this.classList.add('on')" data-n="${n}">${n ? '★'.repeat(n) : '—'}</button>`).join('')}</span></div>
      <label class="f full">Notes<input id="md_n" value="${esc(m.notes || '')}" placeholder="thoughts, who recommended it…"></label></div>
      <div class="row mt">${id ? `<button class="btn ghost danger" onclick="A.del('media','${id}');closeModal()">Delete</button>` : ''}<span class="sp"></span><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn pri" onclick="A.mediaSave('${id || ''}')">Save</button></div>`);
  },
  mediaSave(id) {
    const st = val('md_s'), m = {title: val('md_t'), kind: val('md_k'), status: st, creator: val('md_c'), progress: val('md_p'), started: val('md_sd') || (st === 'active' || st === 'done' ? TODAY : ''), finished: val('md_fd') || (st === 'done' ? TODAY : ''), rating: +($('#md_r button.on') || {dataset: {n: 0}}).dataset.n, notes: val('md_n')};
    if (!m.title) return toast('Give it a title');
    if (id) Object.assign(D.media.find(x => x.id === id), m); else D.media.push({id: uid(), added: TODAY, ...m});
    UI.mediaSt = st; closeModal(); commit();
  },
  mediaStart(id) { Object.assign(D.media.find(x => x.id === id), {status: 'active', started: TODAY}); UI.mediaSt = 'active'; commit(); },
  mediaDone(id) { const m = D.media.find(x => x.id === id); Object.assign(m, {status: 'done', finished: TODAY}); commit(); A.media(id); toast('Finished — rate it?'); },
  // ---- net worth
  asset(id) {
    const a = id ? D.assets.find(x => x.id === id) : {kind: 'bank', values: []}, hist = (a.values || []).slice().sort((x, y) => x.date < y.date ? 1 : -1);
    modal(`<h2>${id ? 'Edit' : 'New'} account</h2><div class="formgrid"><label class="f full">Name<input id="as_n" value="${esc(a.name || '')}" placeholder="Revolut, Trading 212 ETFs, car loan…"></label>
      <label class="f">Kind<select id="as_k">${ASSET_KINDS.map(([k, l]) => `<option value="${k}" ${a.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f">${id ? 'Value today' : 'Current value'} (€)<input type="number" inputmode="decimal" step="0.01" id="as_v" value="${id ? '' : ''}" placeholder="${id ? eur(assetVal(a)).replace('€', '') : '0.00'}"></label>
      <label class="f full">Note<input id="as_note" value="${esc(a.note || '')}"></label></div>
      ${hist.length ? `<div class="qk mt">History</div><div class="list" style="max-height:160px;overflow:auto">${hist.map(v => `<div class="li small"><span class="muted" style="width:96px">${fd(v.date)} ${v.date.slice(0, 4)}</span><span class="t">${eur(+v.value)}</span><button class="btn sm ghost danger" onclick="A.assetValDel('${a.id}','${v.date}')">×</button></div>`).join('')}</div>` : ''}
      <div class="row mt">${id ? `<button class="btn ghost danger" onclick="if(confirm('Delete this account and its history?')){A.del('assets','${id}');closeModal()}">Delete</button>` : ''}<span class="sp"></span><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn pri" onclick="A.assetSave('${id || ''}')">Save</button></div>`);
  },
  assetSave(id) {
    const a = {name: val('as_n'), kind: val('as_k'), note: val('as_note')}, v = val('as_v'); if (!a.name) return toast('Give it a name');
    let x = id ? Object.assign(D.assets.find(q => q.id === id), a) : (D.assets.push({id: uid(), values: [], ...a}), D.assets[D.assets.length - 1]);
    if (v !== '') { x.values = (x.values || []).filter(q => q.date !== TODAY); x.values.push({date: TODAY, value: r2(num(v))}); }
    closeModal(); commit();
  },
  assetValDel(id, d) { const a = D.assets.find(x => x.id === id); a.values = a.values.filter(v => v.date !== d); save(); A.asset(id); },
  assetUpdate() {
    const as = D.assets.filter(a => !a.closed); if (!as.length) return A.asset();
    modal(`<h2>Update values · ${fd(TODAY)}</h2><div class="small muted" style="margin-bottom:10px">Type today's balance. Leave empty to keep the last value.</div><div class="formgrid">${as.map(a => `<label class="f">${esc(a.name)}${a.kind === 'debt' ? ' (owed)' : ''}<input type="number" inputmode="decimal" step="0.01" data-aid="${a.id}" placeholder="${eur(assetVal(a)).replace('€', '')}"></label>`).join('')}</div>
      <div class="row mt"><span class="sp"></span><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn pri" onclick="A.assetUpdateSave()">Save</button></div>`);
  },
  assetUpdateSave() {
    let n = 0; document.querySelectorAll('[data-aid]').forEach(i => { if (i.value === '') return; const a = D.assets.find(x => x.id === i.dataset.aid); a.values = (a.values || []).filter(v => v.date !== TODAY); a.values.push({date: TODAY, value: r2(num(i.value))}); n++; });
    closeModal(); commit(); toast(n ? `${n} value${n > 1 ? 's' : ''} updated · net worth ${eur0(netWorth())}` : 'Nothing changed');
  },
  // ---- subscription check-up
  subKeep(id) { D.recurring.find(x => x.id === id).reviewed = TODAY; commit(); toast('Kept — asking again in a year'); },
  subCancel(id) { const r = D.recurring.find(x => x.id === id); if (!confirm(`Cancel ${r.name}? It stops showing up as a bill. (Remember to cancel it with the provider too.)`)) return; Object.assign(r, {active: false, cancelledAt: TODAY}); commit(); toast(`${r.name} cancelled — saves ${eur0(perYear(r))} a year`); },
  subResume(id) { const r = D.recurring.find(x => x.id === id); Object.assign(r, {active: true, cancelledAt: null, reviewed: TODAY}); commit(); },
  limits() {
    const L = D.settings.limits || {}, wants = D.settings.categories.filter(c => c.bucket === 'wants'), st = limitStats();
    modal(`<h2>Wants limits</h2><div class="small muted" style="margin-bottom:10px">Monthly cap per wants category. Leave empty for no limit. Spending counts from payday to payday (salary only) and starts fresh each pay period; the limits themselves stay until you change them.</div>
      <div class="list">${wants.map((c, i) => { const x = st.find(y => y.cat === c.name); return `<div class="li"><i class="dot" style="background:${PAL.wants}"></i><span class="t">${esc(c.name)}${x ? ` <span class="faint small">· ${eur(x.spent)} so far</span>` : ''}</span><input type="number" inputmode="decimal" step="1" min="0" style="width:110px" data-lim="${esc(c.name)}" placeholder="no limit" value="${L[c.name] || ''}"></div>`; }).join('')}</div>
      <div class="row mt"><span class="sp"></span><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn pri" onclick="A.limitsSave()">Save limits</button></div>`);
  },
  limitsSave() {
    const L = {}; document.querySelectorAll('#modalBox [data-lim]').forEach(i => { const v = num(i.value); if (v > 0) L[i.dataset.lim] = r2(v); });
    D.settings.limits = L; closeModal(); toast(Object.keys(L).length ? `${Object.keys(L).length} limit${Object.keys(L).length > 1 ? 's' : ''} set` : 'Limits cleared'); commit();
  },
  person(id) {
    const p = id ? D.people.find(x => x.id === id) : {};
    modal(`<h2>${id ? 'Edit' : 'New'} person</h2><div class="formgrid"><label class="f">Name<input id="pp_name" value="${esc(p.name || '')}"></label><label class="f">Relation<input id="pp_rel" value="${esc(p.relation || '')}" placeholder="friend, mum, cousin…"></label>
      <label class="f">Birthday<input type="date" id="pp_bd" value="${/^\d{4}/.test(p.birthday || '') ? p.birthday : ''}"></label><label class="f">…or just day.month (year unknown)<input id="pp_bd2" placeholder="14.03" value="${p.birthday && p.birthday.startsWith('--') ? p.birthday.slice(8) + '.' + p.birthday.slice(5, 7) : ''}"></label>
      <label class="f">Name day<select id="pp_nd" onchange="$('#pp_ndd').style.display=this.value==='date'?'':'none'"><option value="auto" ${!p.nameDay ? 'selected' : ''}>Automatic from the name${p.name && !p.nameDay ? (n => n ? ' — ' + fd(n.date) : ' — not found')(BG.nameDay(p.name, +TODAY.slice(0, 4))) : ''}</option><option value="date" ${/^\d/.test(p.nameDay || '') ? 'selected' : ''}>Pick the date</option><option value="none" ${p.nameDay === 'none' ? 'selected' : ''}>Doesn't celebrate</option></select></label>
      <label class="f" id="pp_ndd" style="${/^\d/.test(p.nameDay || '') ? '' : 'display:none'}">Name day (day.month)<input id="pp_ndv" placeholder="07.01" value="${/^\d/.test(p.nameDay || '') ? p.nameDay.slice(3) + '.' + p.nameDay.slice(0, 2) : ''}"></label>
      <label class="f">Keep in touch<select id="pp_keep">${[[0, 'No reminder'], [1, 'Every week'], [2, 'Every 2 weeks'], [4, 'Every month'], [8, 'Every 2 months'], [13, 'Every 3 months'], [26, 'Every 6 months']].map(([v, l]) => `<option value="${v}" ${(+p.keepEvery || 0) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f">Last talked (optional)<input type="date" id="pp_last" value="${p.lastContact || ''}"></label>
      <label class="f full">Gift ideas<input id="pp_gift" value="${esc(p.gifts || '')}"></label><label class="f full">Notes<input id="pp_notes" value="${esc(p.notes || '')}"></label></div>
      <div class="row mt">${id ? `<button class="btn ghost danger" onclick="A.del('people','${id}');closeModal()">Delete</button>` : ''}<span class="sp"></span><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn pri" onclick="A.personSave('${id || ''}')">Save</button></div>`);
  },
  personSave(id) {
    let bd = val('pp_bd'); const m = val('pp_bd2').match(/^(\d{1,2})[./-](\d{1,2})$/); if (!bd && m) bd = `--${pad(m[2])}-${pad(m[1])}`;
    const nd = val('pp_nd'), ndm = val('pp_ndv').match(/^(\d{1,2})[./-](\d{1,2})$/), keep = +val('pp_keep') || 0, old = id ? D.people.find(x => x.id === id) : {};
    if (nd === 'date' && !ndm) return toast('Name day as day.month, e.g. 07.01');
    const p = {name: val('pp_name'), relation: val('pp_rel'), birthday: bd, gifts: val('pp_gift'), notes: val('pp_notes'), nameDay: nd === 'none' ? 'none' : nd === 'date' ? `${pad(ndm[2])}-${pad(ndm[1])}` : '', keepEvery: keep, lastContact: val('pp_last') || old.lastContact || '', keepSince: keep && !old.keepEvery ? TODAY : (old.keepSince || '')}; if (!p.name) return toast('Name needed');
    if (id) Object.assign(D.people.find(x => x.id === id), p); else D.people.push({id: uid(), ...p}); closeModal(); commit();
  },
  task(id, date, preset) {
    const t = id ? D.tasks.find(x => x.id === id) : {due: date || '', ...(preset || {})};
    const rp = t.repeat || {n: 1, unit: ''};
    modal(`<h2>${id ? 'Edit' : 'New'} ${t.repeat || t.remindBefore ? 'recurring task / renewal' : 'task / note'}</h2><div class="formgrid"><label class="f full">Title<input id="tk_t" value="${esc(t.title || '')}" placeholder="Car insurance, ID card expires, dentist check-up…"></label>
      <label class="f">Due / expiry date (empty = note)<input type="date" id="tk_d" value="${t.due || ''}"></label>
      <label class="f">Remind me<select id="tk_rb">${[[0, 'On the day'], [1, '1 day before'], [3, '3 days before'], [7, '1 week before'], [14, '2 weeks before'], [30, '1 month before'], [60, '2 months before'], [90, '3 months before']].map(([v, l]) => `<option value="${v}" ${(+t.remindBefore || 0) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f">Repeats every<input type="number" inputmode="numeric" min="1" id="tk_rn" value="${rp.n || 1}"></label>
      <label class="f">&nbsp;<select id="tk_ru"><option value="" ${!rp.unit ? 'selected' : ''}>doesn't repeat</option>${Object.keys(REPEAT_UNITS).map(u => `<option value="${u}" ${rp.unit === u ? 'selected' : ''}>${u}(s)</option>`).join('')}</select></label>
      <label class="f full">Details<input id="tk_n" value="${esc(t.notes || '')}" placeholder="policy provider, where the document is kept…"></label></div>
      ${(t.history || []).length ? `<div class="small faint mt">Done before: ${t.history.slice(-6).reverse().map(fd).join(', ')}</div>` : ''}
      <div class="row mt">${id ? `<button class="btn ghost danger" onclick="A.del('tasks','${id}');closeModal()">Delete</button>` : ''}<span class="sp"></span><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn pri" onclick="A.taskSave('${id || ''}')">Save</button></div>`);
  },
  taskSave(id) { const u = val('tk_ru'), t = {title: val('tk_t'), due: val('tk_d'), notes: val('tk_n'), remindBefore: +val('tk_rb') || 0, repeat: u ? {n: Math.max(1, parseInt(val('tk_rn')) || 1), unit: u} : null}; if (!t.title) return;
    if (t.repeat && !t.due) return toast('A repeating task needs a first due date'); if (id) Object.assign(D.tasks.find(x => x.id === id), t); else D.tasks.push({id: uid(), done: false, ...t}); closeModal(); commit(); },
  toggleTask(id) {
    const t = D.tasks.find(x => x.id === id);
    if (t.repeat && t.due && !t.done) { // repeating: log it and move to the next date instead of finishing
      (t.history ||= []).push(TODAY);
      let n = addPeriod(t.due, t.repeat.n, t.repeat.unit); while (n <= TODAY) n = addPeriod(n, t.repeat.n, t.repeat.unit);
      t.due = n; toast(`Done · next: ${fdl(n)} ${n.slice(0, 4)}`); return commit();
    }
    t.done = !t.done; t.doneAt = t.done ? TODAY : null; commit();
  },
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
  del(coll, id) { if (coll === 'transactions') { for (const w of D.wishlist) if (w.txId === id) Object.assign(w, {bought: false, txId: null, paid: null}); for (const g of D.gifts) if (g.txId === id) Object.assign(g, {status: 'planned', txId: null, paid: null, boughtAt: null}); } D[coll] = D[coll].filter(x => x.id !== id); if (coll === 'transactions') for (const r of D.recurring) for (const k in r.payments || {}) if (r.payments[k] === id) delete r.payments[k]; commit(); },
  async hevyPaste() {
    try { const t = await navigator.clipboard.readText(); if (!t.trim()) return toast('The clipboard is empty — copy the workout in Hevy first');
      $('#hevyText').value = t; importLive(t); if (innerWidth < 760) $('#impPv').scrollIntoView({behavior: 'smooth', block: 'center'}); }
    catch { toast('Paste was blocked — long-press the text box and choose Paste'); $('#hevyText').focus(); }
  },
  hevyFile(inp) { const f = inp.files[0]; if (!f) return; f.text().then(t => { UI.hevyDraft = t; UI.importPreview = parseHevy(t); render(); }); },
  hevySave() { const r = addWorkouts((UI.importPreview || []).map(({noDate, ...w}) => w)); UI.importPreview = null; UI.hevyDraft = ''; toast(`${r.added} added${r.replaced ? `, ${r.replaced} updated` : ''}`); UI.gymTab = 'history'; commit(); },
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
  catEdit(i, k, v) { const old = D.settings.categories[i].name; D.settings.categories[i][k] = v; if (k === 'name') { for (const t of D.transactions) if (t.category === old) t.category = v; const L = D.settings.limits || {}; if (old in L) { L[v] = L[old]; delete L[old]; } } save(); },
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
    let body = m[1], repeat = null; const rm = body.match(/\s+every\s+(\d+\s+)?(day|week|month|year)s?\b/i);
    if (rm) { repeat = {n: parseInt(rm[1]) || 1, unit: rm[2].toLowerCase()}; body = body.replace(rm[0], ''); }
    const words = body.split(/\s+/), last = parseDateWord(words[words.length - 1]);
    const title = last ? words.slice(0, -1).join(' ') : body;
    const due = last || (repeat ? TODAY : '');
    return {kind: 'task', title, due, repeat, d: `Task “${title}”${due ? ' · due ' + fdl(due) : ''}${repeat ? ' · repeats ' + repeatText({repeat}) : ''}`};
  }
  if ((m = s.match(/^(want|need|wish)\s+([\d.,]+)\s+(.+)$/i))) { const b = /need/i.test(m[1]) ? 'needs' : 'wants'; return {kind: 'wish', price: num(m[2]), name: m[3], bucket: b, d: `Wishlist (${b}) · ${m[3]} · ${eur(num(m[2]))}`}; }
  if ((m = s.match(/^goal\s+(.+?)(?:\s+by\s+(\S+))?$/i))) { const due = parseDateWord(m[2]); return {kind: 'goal', title: due || !m[2] ? m[1] : m[1] + ' by ' + m[2], due: due || '', d: `Goal “${due || !m[2] ? m[1] : m[1] + ' by ' + m[2]}”${due ? ' · by ' + fdl(due) : ''} · weekly check-in on Mondays`}; }
  if ((m = s.match(/^note\s+(.+)$/i))) return {kind: 'task', title: m[1], due: '', d: `Note “${m[1]}”`};
  if ((m = s.match(/^([\d.,]+)\s*(.*)$/))) {
    let rest = m[2], src = 'salary';
    if (/(^|\s)@s(avings)?\b/i.test(rest)) { src = 'savings'; rest = rest.replace(/(^|\s)@s(avings)?\b/i, ' ').trim(); }
    const words = rest.split(/\s+/).filter(Boolean); let date = TODAY;
    if (words.length && parseDateWord(words[words.length - 1])) date = parseDateWord(words.pop());
    let cat = 'Other', note = words.join(' '), catText = false;
    const restL = words.join(' ').toLowerCase();
    const full = [...D.settings.categories].sort((a, b) => b.name.length - a.name.length).find(c => restL === c.name.toLowerCase() || restL.startsWith(c.name.toLowerCase() + ' '));
    if (full) { cat = full.name; note = words.join(' ').slice(full.name.length).trim(); catText = true; }
    else if (words.length) { const w0 = words[0].toLowerCase(); const c = D.settings.categories.find(c => c.name.toLowerCase().startsWith(w0) || c.name.toLowerCase().replace(' ', '') === w0); if (c) { cat = c.name; note = words.slice(1).join(' '); catText = true; } }
    return {kind: 'exp', amount: num(m[1]), cat, catText, note, date, src, d: `Expense ${eur(num(m[1]))} · ${cat} (${catBucket(cat)})${note ? ' · ' + note : ''} · ${date === TODAY ? 'today' : fdl(date)} · from ${src}`};
  }
  return {kind: 'task', title: s, due: '', d: `Note “${s}” (start with a number for spending)`};
}
// The preview is editable: tap any part to change it before saving, so nothing needs fixing later.
UI.qa = {text: '', ov: {}};
let qaLastPointer = 0;
document.addEventListener('pointerdown', () => { qaLastPointer = Date.now(); }, true);
const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function qaMemory(note) { // the last time you logged the same note, e.g. "Monster" → Food · wants
  const n = (note || '').trim().toLowerCase(); if (!n) return null;
  return [...D.transactions].reverse().find(t => (t.note || '').trim().toLowerCase() === n) || null;
}
function qaResolve() {
  const p = qaParse(UI.qa.text); if (!p) return null;
  const ov = UI.qa.ov;
  if (p.kind === 'exp') {
    const mem = qaMemory(p.note);
    p.bucket = catBucket(p.cat);
    if (mem && !p.catText) { p.cat = mem.category; p.bucket = mem.bucket; p.memo = true; }
    else if (mem && mem.category === p.cat) { p.bucket = mem.bucket; p.memo = mem.bucket !== catBucket(p.cat); }
    if (ov.cat) { p.cat = ov.cat; p.bucket = catBucket(ov.cat); p.memo = false; }
    if (ov.bucket) p.bucket = ov.bucket;
    if (ov.src) p.src = ov.src;
    if (ov.date) p.date = ov.date;
  }
  if ((p.kind === 'task' || p.kind === 'goal') && ov.due !== undefined) p.due = ov.due;
  if (p.kind === 'wish' && ov.bucket) p.bucket = ov.bucket;
  return p;
}
const qaSeg = (key, cur, opts) => `<span class="seg qseg">${opts.map(([v, l]) => `<button type="button" class="${cur === v ? 'on' : ''}" onclick="UI.qa.ov.${key}='${v}';qaRender()">${l}</button>`).join('')}</span>`;
function qaRender() {
  const p = qaResolve(), el = $('#qapv'); if (!el) return;
  $('#qaAdd').disabled = !p;
  if (!p) { el.innerHTML = '<span class="faint">Type something — the preview shows exactly how it will be saved.</span>'; return; }
  if (p.kind === 'exp') {
    const cats = D.settings.categories.map(c => `<button type="button" class="qcat ${c.name === p.cat ? 'on' : ''}" onclick="UI.qa.ov.cat=${esc(JSON.stringify(c.name))};delete UI.qa.ov.bucket;qaRender()"><i class="dot" style="background:${PAL[c.bucket]}"></i>${esc(c.name)}</button>`).join('');
    el.innerHTML = `<div class="qrow"><span class="qamt">${eur(p.amount)}</span><span class="qlbl">${esc(p.cat)}${p.note ? ` <span class="muted">· ${esc(p.note)}</span>` : ''}</span></div>
      <div class="qrow"><span class="qk">budget</span>${qaSeg('bucket', p.bucket, [['needs', 'needs'], ['wants', 'wants'], ['savings', 'savings']])}</div>
      <div class="qrow"><span class="qk">paid from</span>${qaSeg('src', p.src, [['salary', 'salary'], ['savings', 'savings']])}</div>
      <div class="qrow"><span class="qk">day</span><input type="date" value="${p.date}" onchange="UI.qa.ov.date=this.value;qaRender()" class="qdate"></div>
      ${p.memo ? `<div class="small acc">✓ Sorted like last time you logged “${esc(p.note)}”</div>` : ''}
      <div class="qk" style="margin-top:8px">category — tap to change</div><div class="qcats">${cats}</div>`;
  } else if (p.kind === 'task' || p.kind === 'goal') {
    el.innerHTML = `<div>${esc(p.d.split(' · ')[0])}${p.repeat ? ` <span class="tag">↻ ${esc(repeatText(p))}</span>` : ''}</div><div class="qrow"><span class="qk">${p.kind === 'goal' ? 'target date' : 'due'}</span><input type="date" value="${p.due || ''}" onchange="UI.qa.ov.due=this.value;qaRender()" class="qdate"><span class="faint small">${p.due ? '' : p.kind === 'goal' ? 'optional' : 'empty = note'}</span></div>`;
  } else if (p.kind === 'wish') {
    el.innerHTML = `<div>Wishlist · ${esc(p.name)} · ${eur(p.price)}</div><div class="qrow"><span class="qk">type</span>${qaSeg('bucket', p.bucket, [['needs', 'need'], ['wants', 'want']])}</div>`;
  } else el.innerHTML = esc(p.d);
}
function qaInput(v) { const k0 = (qaParse(UI.qa.text) || {}).kind; UI.qa.text = v; if ((qaParse(v) || {}).kind !== k0) UI.qa.ov = {}; qaRender(); }
function qaBlur() { // iPhone: the ✓ above the keyboard only closes it — treat it as "save" when there's a valid entry
  if (!IS_IOS) return;
  setTimeout(() => { if (Date.now() - qaLastPointer > 500 && document.hasFocus() && $('#qa') && UI.qa.text.trim() && qaResolve()) qaGo(); }, 120);
}
function qaExample(t) { const i = $('#qa'); i.value = t; qaInput(t); i.focus(); }
function quickAdd() {
  UI.qa = {text: '', ov: {}};
  const ex = (t, l) => `<code onclick="qaExample(${esc(JSON.stringify(t))})">${esc(t)}</code>${l ? ` <span class="faint">${l}</span>` : ''}`;
  modal(`<h2>Quick add</h2><form class="qa" onsubmit="event.preventDefault();qaGo()" autocomplete="off">
    <div class="row"><input id="qa" placeholder="12.50 food lidl" enterkeyhint="go" autocapitalize="off" autocomplete="off" spellcheck="false" oninput="qaInput(this.value)" onblur="qaBlur()"><button class="btn pri" id="qaAdd" type="submit" disabled>Add</button></div>
    <div class="pv" id="qapv"></div></form>
    <div class="qahelp">
      <div><b>Spending</b> <span class="faint">amount → category → note → day → @savings (last two optional)</span><br>${ex('12.50 food lidl')} ${ex('24.90 eating out pizza fri')} ${ex('60 hobbies paints @savings')}</div>
      <div><b>Money</b><br>${ex('income 2400', 'paycheck')} ${ex('save 200', 'to savings')}</div>
      <div><b>Tasks & notes</b><br>${ex('task call bank fri')} ${ex('task car insurance every year 03.12')} ${ex('note gift idea for mum: scarf')}</div>
      <div><b>Goals & wishlist</b><br>${ex('goal run a 5k by 01.03.2027')} ${ex('want 89 headphones')} ${ex('need 120 winter boots')}</div>
      <div><b>Body & people</b><br>${ex('weight 86.4')} ${ex('waist 98')} ${ex('bday Ivan 14.03.1995')}</div>
      <div class="faint">Tap an example to try it. Oracle remembers how you sorted a note before — log “Monster” as wants once and it stays wants.</div></div>`);
  qaRender();
}
function qaGo() {
  const p = qaResolve(); if (!p || !$('#qa')) return; closeModal();
  if (p.kind === 'exp') { D.transactions.push({id: uid(), date: p.date, amount: r2(p.amount), category: p.cat, bucket: p.bucket, note: p.note, source: p.src}); limitWarn(p.cat, p.amount); }
  if (p.kind === 'task') D.tasks.push({id: uid(), title: p.title, due: p.due, done: false, repeat: p.repeat || null, remindBefore: p.repeat ? 7 : 0});
  if (p.kind === 'weight' || p.kind === 'waist') { const ex = D.body.find(b => b.date === TODAY), k = p.kind; if (ex) ex[k] = p.v; else D.body.push({id: uid(), date: TODAY, weight: k === 'weight' ? p.v : null, waist: k === 'waist' ? p.v : null}); }
  if (p.kind === 'goal') D.lifeGoals.push({id: uid(), created: TODAY, status: 'active', log: [], title: p.title, category: 'Personal', kind: 'simple', targetDate: p.due, remind: 'weekly', remindDay: 0, steps: []});
  if (p.kind === 'wish') D.wishlist.push({id: uid(), added: TODAY, bought: false, name: p.name, price: r2(p.price), bucket: p.bucket, link: '', note: '', category: p.bucket === 'needs' ? 'Other' : 'Shopping'});
  if (p.kind === 'save') D.savingsMoves.push({id: uid(), date: TODAY, amount: p.v, kind: 'deposit', note: 'Deposit'});
  if (p.kind === 'bday') { const ex = D.people.find(x => x.name.toLowerCase() === p.name.toLowerCase()); if (ex) ex.birthday = p.bd; else D.people.push({id: uid(), name: p.name, birthday: p.bd}); }
  if (p.kind === 'pay') return A.paycheck(p.v);
  if (p.kind !== 'exp' || !UI.limitToasted) toast('Added · ' + (p.kind === 'exp' ? `${eur(p.amount)} ${p.cat} (${p.bucket})` : p.d.split(' · ')[0]));
  UI.limitToasted = false; commit();
}

// ------------------------------------------------------------------ shell
const CRUMB = {today: 'TODAY', money: 'MONEY', gym: 'GYM', goals: 'GOALS', records: 'RECORDS', calendar: 'CALENDAR', settings: 'SETTINGS', help: 'HELP', review: 'MONTH REVIEW'};
function render() {
  document.querySelectorAll('[data-view]').forEach(a => a.classList.toggle('on', a.dataset.view === UI.view));
  const sub = UI.view === 'money' ? ' // ' + ({tx: 'TRANSACTIONS', wish: 'WISHLIST', networth: 'NET WORTH'}[UI.moneyTab] || UI.moneyTab.toUpperCase()) : UI.view === 'gym' ? ' // ' + (UI.gymTab === 'progress' ? 'EXERCISES' : UI.gymTab.toUpperCase()) : UI.view === 'goals' && UI.goalsTab === 'focus' ? ' // FOCUS' : UI.view === 'records' ? ' // ' + {people: 'PEOPLE', tasks: 'TASKS', media: 'MEDIA', gifts: 'GIFTS'}[UI.recTab] : '';
  $('#crumb').textContent = `> DECODING // ${CRUMB[UI.view]}${sub}`;
  const sc = $('#view').scrollTop; $('#view').innerHTML = V[UI.view](); $('#view').scrollTop = sc;
  if (UI.view === 'settings') renderBioRow();
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
  else if (/^[1-8]$/.test(e.key) && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && $('#modal').classList.contains('hidden')) go(Object.keys(CRUMB)[+e.key - 1]);
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

// ---- app-icon shortcuts (long-press the icon on a phone, right-click it on PC): ?do=…
function takeShortcut() {
  const d = qs.get('do'); if (!d) return null;
  history.replaceState(null, '', location.pathname);
  if (d === 'import') { UI.view = 'gym'; UI.gymTab = 'import'; } else if (d === 'plan') { UI.view = 'gym'; UI.gymTab = 'plan'; } else if (d === 'focus') { UI.view = 'goals'; UI.goalsTab = 'focus'; }
  else if (d === 'networth') { UI.view = 'money'; UI.moneyTab = 'networth'; }
  return d;
}
function runShortcut(d) { if (!d) return; setTimeout(() => { if (d === 'quick') quickAdd(); else if (d === 'expense') A.expense(); else if (d === 'weight') A.bodyLog(); }, 300); }

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
setInterval(() => { tick(); focusTick(); if (!FOCUS && !qs.get('date') && iso(new Date()) !== lastDay && $('#modal').classList.contains('hidden')) location.reload(); }, 1000);
setInterval(() => { syncNow(); checkReminders(); }, 3 * 60e3);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
addEventListener('online', () => syncNow());
if (qs.get('view')) UI.view = qs.get('view');
['moneyTab', 'gymTab', 'recTab', 'goalsTab'].forEach(k => qs.get(k) && (UI[k] = qs.get(k)));
(async () => { await loadPrefs(); await loadData(); FOCUS = (await store.get('focusRun')) || null; })().then(async () => {
  tick(); handleShare(); const sc = takeShortcut(); render(); applyTheme();
  if (PREFS.lock) { lockNow(); UI.pendingDo = sc; } else runShortcut(sc);
  afterStart();
  registerSW(); await syncNow();
  checkReminders();
});
