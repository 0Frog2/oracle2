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
  const wd = (pd(today).getDay() + 6) % 7;
  for (const g of D.lifeGoals || []) {
    if (g.status !== 'active') continue;
    const checked = (g.log || []).some(l => l.date === today);
    const due = g.remind === 'daily' || (g.remind === 'weekly' && wd === (+g.remindDay || 0)) || (g.remind === 'monthly' && today.slice(8) === '01');
    if (due && !checked) out.push({key: `goal:${g.id}:${today}`, title: `Goal check-in: ${g.title}`, body: g.why || (g.targetDate ? `${diff(today, g.targetDate)} days to your deadline` : 'How is it going? Tap to update your progress.')});
    if (g.targetDate) { const d = diff(today, g.targetDate); if (d === lead || d === 1 || d === 0) out.push({key: `goaldl:${g.id}:${d}`, title: `Goal deadline ${when(d)}: ${g.title}`, body: nice(g.targetDate)}); }
  }
  for (const t of D.tasks || []) {
    if (t.done || !t.due) continue;
    const d = diff(today, t.due), rb = +t.remindBefore || 0;
    if (d === 0) out.push({key: `task:${t.id}:${t.due}:0`, title: 'Due today', body: t.title});
    else if (rb && (d === rb || (rb >= 7 && d === 1))) out.push({key: `task:${t.id}:${t.due}:${d}`, title: `${t.title} ${when(d)}`, body: nice(t.due) + (t.notes ? ` · ${t.notes}` : '')});
  }
  if (today.slice(8) === '01') { const p = pd(today); p.setMonth(p.getMonth() - 1); out.push({key: `review:${today.slice(0, 7)}`, title: `Your ${p.toLocaleString('en', {month: 'long'})} review is ready`, body: 'Spending, savings, gym records, body and goals — open Oracle 2.'}); }
  return out;
}
if (typeof self !== 'undefined') self.computeReminders = computeReminders;
