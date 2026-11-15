/* Oracle 2 — reminder rules. Shared by the app and the service worker (background checks). */
'use strict';
function computeReminders(D, today) {
  const p2 = n => String(n).padStart(2, '0');
  const pd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const iso = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const diff = (a, b) => Math.round((pd(b) - pd(a)) / 864e5);
  const dim = (y, m) => new Date(y, m, 0).getDate();
  const nice = s => pd(s).toDateString().slice(0, 10);
  const lead = Math.max(7, +((D.settings || {}).reminderDays) || 7);
  const when = d => d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`;
  const out = [];
  for (const p of D.people || []) {
    const m = (p.birthday || '').match(/(\d{2})-(\d{2})$/); if (!m) continue;
    let nb = null;
    for (const y of [+today.slice(0, 4), +today.slice(0, 4) + 1]) {
      let s = `${y}-${m[1]}-${m[2]}`; if (m[1] === '02' && m[2] === '29' && dim(y, 2) === 28) s = `${y}-03-01`;
      if (s >= today) { nb = s; break; }
    }
    if (!nb) continue;
    const d = diff(today, nb);
    if (d === lead || d === 1 || d === 0) out.push({key: `bday:${p.id}:${nb}:${d}`, title: `${p.name}'s birthday ${when(d)}`, body: d ? nice(nb) + (p.gifts ? ` · ideas: ${p.gifts}` : '') : 'Say happy birthday!'});
  }
  for (const r of D.recurring || []) {
    if (r.active === false) continue;
    for (let k = 0; k < 2; k++) {
      const base = pd(today); base.setDate(1); base.setMonth(base.getMonth() + k);
      const y = base.getFullYear(), mo = base.getMonth() + 1, ym = `${y}-${p2(mo)}`;
      if ((r.payments || {})[ym]) continue;
      const due = `${ym}-${p2(Math.min(+r.day || 1, dim(y, mo)))}`, d = diff(today, due);
      if (d === lead || d === 1 || d === 0) out.push({key: `bill:${r.id}:${ym}:${d}`, title: `${r.name} due ${when(d)}`, body: `€${(+r.amount).toFixed(2)} on ${nice(due)}`});
    }
  }
  if (pd(today).getDay() === 1) out.push({key: `week:${today}`, title: 'Your week is ready', body: 'Open Oracle 2 to see this week\'s bills, birthdays, tasks and budget.'});
  for (const t of D.tasks || []) if (!t.done && t.due === today) out.push({key: `task:${t.id}:${today}`, title: 'Due today', body: t.title});
  return out;
}
if (typeof self !== 'undefined') self.computeReminders = computeReminders;
