/* Oracle 2 — calendar rules and reminders. Shared by the app and the service worker (background checks). */
'use strict';

// ---------------------------------------------------------------- Bulgarian calendar
const BG = (() => {
  const p2 = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const add = (s, n) => { const [y, m, d] = s.split('-').map(Number); return iso(new Date(y, m - 1, d + n)); };
  const dow = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };
  const easterCache = {}, holCache = {};
  // Orthodox Easter (Julian computus, shifted to the civil calendar; valid 1900–2099)
  function easter(y) {
    if (easterCache[y]) return easterCache[y];
    const a = y % 4, b = y % 7, c = y % 19, d = (19 * c + 15) % 30, e = (2 * a + 4 * b - d + 34) % 7;
    const month = Math.floor((d + e + 114) / 31), day = ((d + e + 114) % 31) + 1;
    return easterCache[y] = add(`${y}-${p2(month)}-${p2(day)}`, 13);
  }
  // Official days off (Labour Code art. 154). A fixed holiday on a weekend moves to the next working day; Easter days don't.
  function holidays(y) {
    if (holCache[y]) return holCache[y];
    const E = easter(y), h = {};
    const fixed = [['01-01', 'New Year'], ['03-03', 'Liberation Day'], ['05-01', 'Labour Day'], ['05-06', 'St George\'s Day / Army Day'], ['05-24', 'Day of Bulgarian Culture and Slavonic Literature'], ['09-06', 'Unification Day'], ['09-22', 'Independence Day'], ['12-24', 'Christmas Eve'], ['12-25', 'Christmas'], ['12-26', 'Christmas (2nd day)']];
    for (const [md, n] of fixed) h[`${y}-${md}`] = n;
    h[add(E, -2)] = h[add(E, -2)] ? h[add(E, -2)] + ' · Good Friday' : 'Good Friday';
    h[add(E, -1)] = h[add(E, -1)] ? h[add(E, -1)] + ' · Holy Saturday' : 'Holy Saturday';
    h[E] = 'Orthodox Easter'; h[add(E, 1)] = h[add(E, 1)] ? h[add(E, 1)] + ' · Easter Monday' : 'Easter Monday';
    for (const [md, n] of fixed) {
      const d = `${y}-${md}`, w = dow(d);
      if (w === 0 || w === 6) { // e.g. 1 May 2027 = Saturday (and Holy Saturday) → 4 May off
        let s = add(d, 1); while (dow(s) === 0 || dow(s) === 6 || h[s]) s = add(s, 1);
        h[s] = `Day off (for ${n})`;
      }
    }
    return holCache[y] = h;
  }
  const isWorkday = s => { const w = dow(s); return w !== 0 && w !== 6 && !holidays(+s.slice(0, 4))[s]; };
  // Widely celebrated name days (Bulgarian Orthodox calendar). Movable ones are counted from Easter.
  const FIXED = {
    '01-01': ['Vasilyovden', 'Vasil Vasilka Vasilena Vesela Veselin Veselina'],
    '01-06': ['Yordanovden', 'Yordan Yordanka Bogdan Bogdana Bogomil Bogomila'],
    '01-07': ['Ivanovden', 'Ivan Ivanka Yoan Yoana Yana Ivaylo Ivayla Kaloyan Vanya Zhan Zhana'],
    '01-12': ['St Tatyana', 'Tatyana Tanya'],
    '01-17': ['Antonovden', 'Anton Antonia Antoniya Andon Doncho Donka'],
    '01-18': ['Atanasovden', 'Atanas Atanaska Nasko'],
    '01-20': ['St Evtimiy', 'Evtim Evtimiya'],
    '01-25': ['St Grigoriy', 'Grigor Grigoriy'],
    '02-01': ['Trifon Zarezan', 'Trifon'],
    '02-03': ['St Simeon', 'Simeon Simona'],
    '02-10': ['Haralampiy', 'Haralampi'],
    '02-14': ['St Valentine', 'Valentin Valentina'],
    '03-25': ['Blagoveshtenie', 'Blagovest Blagovesta Blaga Evangelina Vangel Vangelia'],
    '05-01': ['May name day', 'Maya Tamara'],
    '05-02': ['St Boris', 'Boris Borislav Borislava Boryana'],
    '05-05': ['St Irina', 'Irina Irena'],
    '05-06': ['Gergyovden', 'Georgi Gergana Galya Galina Ginka Gosho Gyuro Georgia Georgiya'],
    '05-11': ['Sts Cyril and Methodius', 'Kiril Kirila Metodi Metodiy'],
    '05-21': ['Sts Constantine and Helena', 'Konstantin Kostadin Kosta Elena Lena Elenka'],
    '05-30': ['St Emiliy', 'Emil Emilia Emiliya Emiliyan'],
    '06-29': ['Petrovden', 'Petar Petya Petra Petko Pavel Pavlina Pavla'],
    '07-15': ['St Vladimir', 'Vladimir Vladimira'],
    '07-20': ['Ilinden', 'Iliya Ilia Iliyan Iliyana Ilina'],
    '08-15': ['Golyama Bogoroditsa', 'Maria Mariya Mariyana Mariana Mario Mariela Maya'],
    '08-30': ['Aleksandrovden', 'Aleksandar Aleksandra Alexander Alexandra Sasho Sasha'],
    '09-17': ['Vyara, Nadezhda, Lyubov', 'Vyara Vera Nadezhda Nadya Lyubov Lyuba Lyubomir Sofia Sofiya'],
    '10-14': ['Petkovden', 'Petka Paraskeva'],
    '10-26': ['Dimitrovden', 'Dimitar Dimitrina Dimitra Mitko Dimo Mitra'],
    '11-08': ['Arhangelovden', 'Mihail Mihaela Mihaila Angel Angelina Rafail Rafael Gavrail Gavril Gabriela Gabriel'],
    '11-24': ['St Ekaterina', 'Ekaterina Katerina Katya'],
    '11-30': ['Andreevden', 'Andrey Andrea Andreana Andriana'],
    '12-04': ['St Varvara', 'Varvara Barbara Varya'],
    '12-05': ['St Sava', 'Sava Savina'],
    '12-06': ['Nikulden', 'Nikola Nikolay Nikolai Nikolina Nikoleta Kolyo'],
    '12-09': ['St Anna', 'Ana Anna Anka'],
    '12-12': ['St Spiridon', 'Spiridon Spiro'],
    '12-17': ['St Daniel', 'Daniel Daniela'],
    '12-20': ['Ignazhden', 'Ignat Ignatiy Ognyan Plamen Plamena'],
    '12-25': ['Koleda', 'Hristo Hristina Kristian Kristina Emanuil'],
    '12-27': ['Stefanovden', 'Stefan Stefka Stefani Stefaniya'],
  };
  const MOVABLE = [[-43, 'Todorovden', 'Todor Teodor Teodora Toshko Dora'], [-8, 'Lazarovden', 'Lazar Lazarina'],
    [-7, 'Tsvetnitsa', 'Tsvetan Tsvetana Tsvetelina Tsvetomir Tsveta Violeta Liliya Lili Margarita Rosen Rositsa Roza Yasen Yavor Zdravko Zdravka Kalina Nevena Viola Dafina Zhasmina'],
    [0, 'Velikden', 'Velichko Velichka Velin Velina Veliko Velislav Velislava'], [5, 'Svetli petak', 'Zhivko Zhivka Zoya'], [7, 'Tomina nedelya', 'Toma Tomislav'], [39, 'Spasovden', 'Spas Spaska Spasimir']];
  // compare names in Latin or Cyrillic, with common spelling variants (Yordan/Iordan, Mariya/Maria)
  const CYR = {а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sht', ъ: 'a', ь: 'y', ю: 'yu', я: 'ya'};
  const norm = s => String(s || '').trim().split(/[\s,.-]+/)[0].toLowerCase().replace(/[а-я]/g, c => CYR[c] || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/y/g, 'i').replace(/ii+/g, 'i').replace(/x/g, 'ks').replace(/j/g, 'zh');
  const dayCache = {};
  function list(y) { // date -> [{feast, names[]}]
    if (dayCache[y]) return dayCache[y];
    const out = {}, push = (d, f, n) => (out[d] ||= []).push({feast: f, names: n.split(' ')});
    for (const [md, [f, n]] of Object.entries(FIXED)) push(`${y}-${md}`, f, n);
    const E = easter(y); for (const [o, f, n] of MOVABLE) push(add(E, o), f, n);
    return dayCache[y] = out;
  }
  function nameDay(name, y) { // first match in the year -> {date, feast}
    const k = norm(name); if (!k) return null;
    const L = list(y);
    for (const d of Object.keys(L).sort()) for (const e of L[d]) if (e.names.some(n => norm(n) === k)) return {date: d, feast: e.feast};
    return null;
  }
  return {easter, holidays, isWorkday, list, nameDay, norm, add};
})();
// a person's name day in a given year: manual override, automatic from their first name, or none
function personNameDay(p, y) {
  if (p.nameDay === 'none') return null;
  if (/^\d{2}-\d{2}$/.test(p.nameDay || '')) return {date: `${y}-${p.nameDay}`, feast: 'Name day'};
  return BG.nameDay(p.name, y);
}

// ---------------------------------------------------------------- reminders
function computeReminders(D, today) {
  const S = D.settings || {};
  const p2 = n => String(n).padStart(2, '0');
  const pd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const diff = (a, b) => Math.round((pd(b) - pd(a)) / 864e5);
  const dim = (y, m) => new Date(y, m, 0).getDate();
  const nice = s => pd(s).toDateString().slice(0, 10);
  const lead = Math.max(7, +S.reminderDays || 7);
  const when = d => d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`;
  const eur = v => `€${(+v || 0).toFixed(2)}`;
  const out = [], y0 = +today.slice(0, 4);
  for (const p of D.people || []) {
    const m = (p.birthday || '').match(/(\d{2})-(\d{2})$/);
    if (m) {
      let nb = null;
      for (const y of [y0, y0 + 1]) { let s = `${y}-${m[1]}-${m[2]}`; if (m[1] === '02' && m[2] === '29' && dim(y, 2) === 28) s = `${y}-03-01`; if (s >= today) { nb = s; break; } }
      const d = nb ? diff(today, nb) : -1;
      if (d === lead || d === 1 || d === 0) out.push({key: `bday:${p.id}:${nb}:${d}`, title: `${p.name}'s birthday ${when(d)}`, body: d ? nice(nb) + (p.gifts ? ` · ideas: ${p.gifts}` : '') : 'Say happy birthday!'});
    }
    if (S.bgCalendar !== false) for (const y of [y0, y0 + 1]) {
      const nd = personNameDay(p, y); if (!nd || nd.date < today) continue;
      const d = diff(today, nd.date);
      if (d === lead || d === 1 || d === 0) out.push({key: `nday:${p.id}:${nd.date}:${d}`, title: `${p.name}'s name day ${when(d)}`, body: `${nd.feast} · ${nice(nd.date)}`});
      break;
    }
    if (+p.keepEvery > 0) { // keep in touch: nudge on the day it becomes due, then weekly
      const last = p.lastContact || p.keepSince || today, due = BG.add(last, 7 * p.keepEvery), late = diff(due, today);
      if (late >= 0 && late % 7 === 0) out.push({key: `touch:${p.id}:${today}`, title: `Get in touch with ${p.name}`, body: `It's been ${Math.round(diff(last, today) / 7)} weeks${p.lastContact ? '' : ' (since you set this up)'}.`});
    }
  }
  for (const r of D.recurring || []) {
    if (r.active === false) continue;
    for (let k = 0; k < 2; k++) {
      const base = pd(today); base.setDate(1); base.setMonth(base.getMonth() + k);
      const y = base.getFullYear(), mo = base.getMonth() + 1, ym = `${y}-${p2(mo)}`;
      if (r.freq === 'year' && +r.month !== mo) continue;
      if ((r.payments || {})[ym]) continue;
      const due = `${ym}-${p2(Math.min(+r.day || 1, dim(y, mo)))}`, d = diff(today, due);
      const lt = r.freq === 'year' ? Math.max(lead, 14) : lead;
      if (d === lt || d === 1 || d === 0) out.push({key: `bill:${r.id}:${ym}:${d}`, title: `${r.name} ${r.freq === 'year' ? 'renews' : 'due'} ${when(d)}`, body: `${eur(r.amount)}${r.freq === 'year' ? ' (yearly)' : ''} on ${nice(due)}`});
    }
    if (r.type === 'subscription' && today.slice(8) === '01' && (!r.reviewed || diff(r.reviewed, today) >= 365) && diff(r.startDate || today, today) >= 300)
      out.push({key: `subrev:${r.id}:${today.slice(0, 7)}`, title: `Still using ${r.name}?`, body: `It costs ${eur(r.freq === 'year' ? r.amount : r.amount * 12)} a year. Open Bills & subscriptions to keep or cancel it.`});
  }
  for (const g of D.gifts || []) {
    if (g.status === 'bought' || !g.date || g.date < today) continue;
    const d = diff(today, g.date), who = g.personId ? ((D.people || []).find(p => p.id === g.personId) || {}).name || '' : (g.who || '');
    if (d === lead || d === 3 || d === 1) out.push({key: `gift:${g.id}:${g.date}:${d}`, title: `Gift for ${who || 'someone'} ${when(d)}`, body: [g.budget ? eur(g.budget) + ' set aside' : '', g.idea ? 'idea: ' + g.idea : ''].filter(Boolean).join(' · ') || 'Not bought yet'});
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
  const tr = S.training || {};
  if (tr.remind !== false && tr.days) {
    const plan = tr.days[wd];
    if (plan && !(D.workouts || []).some(w => w.date.slice(0, 10) === today)) out.push({key: `train:${today}`, title: `Today: ${plan}`, body: 'Your planned workout. Import it from Hevy afterwards to tick it off.'});
    const yd = BG.add(today, -1), ywd = (wd + 6) % 7, yplan = tr.days[ywd];
    if (yplan && !(D.workouts || []).some(w => w.date.slice(0, 10) === yd) && (D.workouts || []).length) out.push({key: `missed:${yd}`, title: `Missed: ${yplan}`, body: 'No workout logged yesterday. Fit it in today, or import it if you forgot.'});
  }
  if (S.bgCalendar !== false) { const h = BG.holidays(y0); const tm = BG.add(today, 1); if (h[tm]) out.push({key: `hol:${tm}`, title: `Tomorrow: ${h[tm]}`, body: 'Official day off in Bulgaria.'}); }
  if (today.slice(8) === '01') { const p = pd(today); p.setMonth(p.getMonth() - 1); out.push({key: `review:${today.slice(0, 7)}`, title: `Your ${p.toLocaleString('en', {month: 'long'})} review is ready`, body: 'Spending, savings, gym, goals' + ((D.assets || []).length ? ' — and a good moment to update your net worth values.' : '.')}); }
  return out;
}
if (typeof self !== 'undefined') { self.computeReminders = computeReminders; self.BG = BG; self.personNameDay = personNameDay; }
