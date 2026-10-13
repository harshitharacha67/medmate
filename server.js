/* MedMate server: REST API + live events (SSE) + dose scheduler + multilingual assistant.
   Only dependency: express. Data lives in data/db.json. */
const express = require('express'), fs = require('fs'), path = require('path'), crypto = require('crypto');

// ---- tiny .env loader (no dotenv needed) ----
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach(l => {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch {}
const PORT = +process.env.PORT || 3000;
const KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

// ---------------------------------------------------------------- database
const DB_FILE = path.join(__dirname, 'data', 'db.json');
let db = { users: [], meds: [], logs: [], vitals: [], alerts: [], secret: crypto.randomBytes(32).toString('hex') };
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
if (fs.existsSync(DB_FILE)) db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
let saveTimer = null;
const save = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(db)); fs.renameSync(DB_FILE + '.tmp', DB_FILE); }, 150);
};
const uid = () => crypto.randomBytes(6).toString('hex');

// ---------------------------------------------------------------- time helpers (server local time)
const p2 = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const hm = d => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
const at = (date, time) => { const [y, m, d] = date.split('-').map(Number), [h, mi] = time.split(':').map(Number); return new Date(y, m - 1, d, h, mi).getTime(); };
const addDays = (date, n) => { const [y, m, d] = date.split('-').map(Number); return ymd(new Date(y, m - 1, d + n)); };

// ---------------------------------------------------------------- auth (scrypt passwords + signed tokens)
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const sign = s => crypto.createHmac('sha256', db.secret).update(s).digest('base64url');
const mkToken = id => { const b = Buffer.from(JSON.stringify({ id, exp: Date.now() + 30 * 864e5 })).toString('base64url'); return b + '.' + sign(b); };
function readToken(tok) {
  try {
    const [b, s] = String(tok || '').split('.'); if (!b || !s) return null;
    const a = Buffer.from(s), c = Buffer.from(sign(b));
    if (a.length !== c.length || !crypto.timingSafeEqual(a, c)) return null;
    const o = JSON.parse(Buffer.from(b, 'base64url'));
    return o.exp > Date.now() ? db.users.find(u => u.id === o.id) || null : null;
  } catch { return null; }
}
const pub = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, code: u.code, lang: u.lang, grace: u.grace, xp: u.xp || 0, level: Math.floor((u.xp || 0) / 100) + 1, linked: u.linked || [] });
const newCode = () => 'MM-' + crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 4);
function mkUser({ name, email, password, role, code }) {
  const salt = crypto.randomBytes(8).toString('hex');
  const u = { id: uid(), name, email: email.toLowerCase(), salt, pw: hash(password, salt), role, code: role === 'patient' ? (code || newCode()) : null, linked: [], xp: 0, grace: 15, lang: 'en-US', createdAt: Date.now() };
  db.users.push(u); save(); return u;
}

// ---------------------------------------------------------------- live events (Server-Sent Events)
const clients = new Map();
const emit = (id, ev, data) => (clients.get(id) || new Set()).forEach(r => r.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`));
const circle = p => [p.id, ...db.users.filter(u => u.linked && u.linked.includes(p.id)).map(u => u.id)];
const notifyCircle = (p, ev, d) => circle(p).forEach(i => emit(i, ev, { ...d, patientId: p.id, patient: p.name }));
function alertCircle(p, type, msg) {
  circle(p).forEach(i => { const a = { id: uid(), userId: i, patientId: p.id, type, msg, at: Date.now(), read: false }; db.alerts.push(a); emit(i, 'alert', a); });
  if (db.alerts.length > 600) db.alerts = db.alerts.slice(-500);
  save();
}

// ---------------------------------------------------------------- schedule engine
const snoozes = {};
const key = (it, p) => `${p.id}|${it.medId}|${it.date}|${it.time}`;
function scheduleFor(p, date) {
  const wd = new Date(date + 'T00:00:00').getDay(), out = [];
  db.meds.filter(m => m.userId === p.id && m.active && m.start <= date && (!m.days || !m.days.length || m.days.includes(wd))).forEach(m =>
    m.times.forEach(time => {
      const l = db.logs.find(x => x.medId === m.id && x.date === date && x.time === time);
      out.push({ medId: m.id, name: m.name, dose: m.dose, form: m.form, color: m.color, perDose: m.perDose, notes: m.notes, time, date, ts: at(date, time), log: l || null });
    }));
  return out.sort((a, b) => a.ts - b.ts);
}
function statusOf(it, p, now = Date.now()) {
  if (it.log) return it.log.status;
  const sn = (snoozes[key(it, p)] || 0) * 60000;
  if (now < it.ts + sn) return sn ? 'snoozed' : 'upcoming';
  return now < it.ts + sn + p.grace * 60000 ? 'due' : 'missed';
}
function addMed(p, b) {
  const m = { id: uid(), userId: p.id, ...medBody(b), start: ymd(new Date()), active: true, createdAt: Date.now() };
  if (!m.name || !m.times.length) throw new Error('A medicine needs a name and at least one time.');
  db.meds.push(m); save(); return m;
}
const medBody = b => ({
  name: String(b.name || '').trim().slice(0, 60), dose: String(b.dose || '').slice(0, 30), form: b.form || 'tablet', color: b.color || '#A71F13',
  times: [...new Set((b.times || []).filter(t => /^\d{2}:\d{2}$/.test(t)))].sort(),
  days: (b.days || []).map(Number).filter(d => d >= 0 && d < 7), stock: Math.max(0, +b.stock || 0),
  perDose: Math.max(1, +b.perDose || 1), notes: String(b.notes || '').slice(0, 200)
});

function recordDose(p, { medId, time, date, status = 'taken', via = 'app' }) {
  const m = db.meds.find(x => x.id === medId && x.userId === p.id);
  if (!m) return { error: 'Medicine not found' };
  date = date || ymd(new Date());
  let l = db.logs.find(x => x.medId === medId && x.date === date && x.time === time);
  if (l && l.status === 'taken') return { error: 'Already logged as taken', log: l };
  const now = Date.now(), delay = Math.round((now - at(date, time)) / 60000);
  if (l) Object.assign(l, { status, takenAt: now, via, delay });
  else { l = { id: uid(), userId: p.id, medId, date, time, status, takenAt: now, via, delay }; db.logs.push(l); }
  let xp = 0;
  if (status === 'taken') {
    m.stock = Math.max(0, m.stock - m.perDose);
    xp = Math.abs(delay) <= 15 ? 10 : 5; p.xp = (p.xp || 0) + xp;
    const left = daysLeft(m);
    if (m.stock > 0 && left <= 3) alertCircle(p, 'refill', `${m.name} is running low: about ${left} day(s) left.`);
  }
  save();
  notifyCircle(p, status === 'taken' ? 'taken' : 'skipped', { name: m.name, time, via, xp });
  return { ok: true, log: l, xp, level: Math.floor((p.xp || 0) / 100) + 1 };
}
const daysLeft = m => { const per = m.times.length * m.perDose * ((m.days && m.days.length ? m.days.length : 7) / 7); return per ? Math.floor(m.stock / per) : 99; };
const pendingItems = p => scheduleFor(p, ymd(new Date())).filter(it => !it.log || it.log.status !== 'taken');
function takeByName(p, name, via = 'voice', medId) {
  let items = pendingItems(p);
  if (medId) items = items.filter(i => i.medId === medId);
  else if (name) {
    const n = name.toLowerCase(), f = items.filter(i => i.name.toLowerCase().includes(n) || n.includes(i.name.toLowerCase()));
    if (!f.length) return { error: 'nomatch' };
    items = f;
  }
  items = items.filter(i => i.ts <= Date.now() + 60 * 60000);
  if (!items.length) return { error: 'nothing' };
  items.sort((a, b) => Math.abs(a.ts - Date.now()) - Math.abs(b.ts - Date.now()));
  const it = items[0];
  return { ...recordDose(p, { medId: it.medId, time: it.time, date: it.date, via }), item: it };
}
function snoozeNext(p, minutes = 10) {
  const it = scheduleFor(p, ymd(new Date())).find(i => !i.log && ['due', 'upcoming', 'snoozed'].includes(statusOf(i, p)));
  if (!it) return null;
  snoozes[key(it, p)] = (snoozes[key(it, p)] || 0) + minutes;
  notifyCircle(p, 'snooze', { name: it.name, minutes });
  return it;
}

// Every 10 seconds: announce due doses, mark overdue ones as missed, alert caregivers.
const notified = new Set();
function tick() {
  const now = Date.now(), date = ymd(new Date());
  db.users.filter(u => u.role === 'patient').forEach(p => scheduleFor(p, date).forEach(it => {
    if (it.log) return;
    const st = statusOf(it, p, now), k = key(it, p), nk = 'd' + k + (snoozes[k] || 0);
    if (st === 'due' && !notified.has(nk)) { notified.add(nk); notifyCircle(p, 'due', { medId: it.medId, name: it.name, dose: it.dose, time: it.time }); }
    if (st === 'missed') {
      db.logs.push({ id: uid(), userId: p.id, medId: it.medId, date, time: it.time, status: 'missed', via: 'auto' });
      alertCircle(p, 'missed', `${p.name} missed ${it.name} (${it.time}).`);
      notifyCircle(p, 'missed', { name: it.name, time: it.time });
      const last = db.logs.filter(l => l.userId === p.id).slice(-3);
      if (last.length === 3 && last.every(l => l.status === 'missed')) alertCircle(p, 'pattern', `${p.name} has missed 3 doses in a row. A quick check-in could help.`);
    }
  }));
}
setInterval(tick, 10000);

// ---------------------------------------------------------------- stats, streaks, badges, smart suggestions
function dayStats(p, date) {
  const now = Date.now(), items = scheduleFor(p, date); let exp = 0, taken = 0, pend = 0; const settled = [];
  items.forEach(it => {
    const st = statusOf(it, p, now);
    if (['upcoming', 'due', 'snoozed'].includes(st)) { pend++; return; }
    exp++; settled.push(it); if (st === 'taken') taken++;
  });
  return { date, exp, taken, pend, settled };
}
function stats(p) {
  const today = ymd(new Date()), days = [];
  for (let k = 0; k < 28; k++) days.push(dayStats(p, addDays(today, -k)));
  const seq = days.slice().reverse().filter(d => !(d.exp === 0 || (d.date === today && d.pend > 0))).map(d => d.taken === d.exp);
  let run = 0, best = 0; seq.forEach(c => { run = c ? run + 1 : 0; best = Math.max(best, run); });
  const sum = n => days.slice(0, n).reduce((a, d) => [a[0] + d.taken, a[1] + d.exp], [0, 0]);
  const pct = ([t, e]) => e ? Math.round(t / e * 100) : 100;
  const bucketOf = h => h >= 5 && h < 12 ? 'Morning' : h >= 12 && h < 17 ? 'Afternoon' : h >= 17 && h < 21 ? 'Evening' : 'Night';
  const bk = { Morning: [0, 0], Afternoon: [0, 0], Evening: [0, 0], Night: [0, 0] };
  days.forEach(d => d.settled.forEach(it => { const b = bk[bucketOf(+it.time.slice(0, 2))]; b[1]++; if (it.log && it.log.status === 'taken') b[0]++; }));
  const taken = db.logs.filter(l => l.userId === p.id && l.status === 'taken');
  const early = taken.filter(l => +l.time.slice(0, 2) < 8).length;
  const xp = p.xp || 0;
  const badges = [
    { id: 'first', name: 'First dose', desc: 'Log your first dose', on: taken.length >= 1 },
    { id: 's3', name: 'Warm-up', desc: '3-day streak', on: best >= 3 },
    { id: 's7', name: 'Week warrior', desc: '7-day streak', on: best >= 7 },
    { id: 's14', name: 'Fortnight hero', desc: '14-day streak', on: best >= 14 },
    { id: 'early', name: 'Early bird', desc: '5 doses before 8 am', on: early >= 5 },
    { id: 'c50', name: 'Half century', desc: '50 doses taken', on: taken.length >= 50 },
    { id: 'l5', name: 'Level 5', desc: 'Reach level 5', on: xp >= 400 },
    { id: 'perfect', name: 'Flawless week', desc: '100% adherence for 7 days', on: pct(sum(7)) === 100 && days.slice(0, 7).some(d => d.exp) }
  ];
  const suggestions = [];
  db.meds.filter(m => m.userId === p.id && m.active).forEach(m => m.times.forEach(time => {
    const ls = db.logs.filter(l => l.medId === m.id && l.time === time && l.status === 'taken' && typeof l.delay === 'number').slice(-7);
    if (ls.length < 4) return;
    const avg = Math.round(ls.reduce((a, l) => a + l.delay, 0) / ls.length);
    if (avg >= 12 || avg <= -12) { const ts = at(today, time) + Math.round(avg / 5) * 5 * 60000, d = new Date(ts); suggestions.push({ medId: m.id, name: m.name, time, suggested: hm(d), avg }); }
  }));
  const week = days.slice(0, 7).reverse().map(d => ({ date: d.date, label: new Date(d.date + 'T00:00:00').toLocaleDateString('en', { weekday: 'short' }), exp: d.exp, taken: d.taken }));
  return {
    adh7: pct(sum(7)), adh28: pct(sum(28)), streak: run, best, week,
    heat: days.slice().reverse().map(d => ({ date: d.date, pct: d.exp ? Math.round(d.taken / d.exp * 100) : null })),
    buckets: Object.entries(bk).map(([name, [t, e]]) => ({ name, pct: e ? Math.round(t / e * 100) : null, n: e })),
    badges, suggestions, totalTaken: taken.length, xp, level: Math.floor(xp / 100) + 1, into: xp % 100
  };
}

// ---------------------------------------------------------------- medicine interaction hints (informational)
const PAIRS = [
  ['warfarin', 'aspirin', 'Higher bleeding risk. Ask a doctor before combining.'],
  ['ibuprofen', 'aspirin', 'Can raise stomach bleeding risk and blunt aspirin\'s heart benefit.'],
  ['losartan', 'ibuprofen', 'NSAIDs can reduce BP medicine effect and strain the kidneys.'],
  ['telmisartan', 'ibuprofen', 'NSAIDs can reduce BP medicine effect and strain the kidneys.'],
  ['amlodipine', 'simvastatin', 'Amlodipine can raise simvastatin levels. Dose limits apply.'],
  ['clopidogrel', 'omeprazole', 'Omeprazole may weaken clopidogrel. A different acid reducer may be better.'],
  ['levothyroxine', 'calcium', 'Calcium blocks thyroid pill absorption. Keep them 4 hours apart.'],
  ['thyroxine', 'calcium', 'Calcium blocks thyroid pill absorption. Keep them 4 hours apart.'],
  ['sildenafil', 'nitroglycerin', 'Dangerous drop in blood pressure. Never combine.'],
  ['metformin', 'alcohol', 'Alcohol raises the risk of lactic acidosis with metformin.'],
  ['atorvastatin', 'clarithromycin', 'Can raise statin levels and muscle side effects.']
];
function interactions(meds) {
  const names = meds.map(m => m.name.toLowerCase()), out = [];
  PAIRS.forEach(([a, b, note]) => { const ma = meds.find(m => m.name.toLowerCase().includes(a)), mb = meds.find(m => m.name.toLowerCase().includes(b)); if (ma && mb && ma.id !== mb.id) out.push({ a: ma.name, b: mb.name, note }); });
  return out;
}
const flagVital = (t, v, v2) => t === 'bp' ? (v >= 140 || v2 >= 90 ? 'high' : v < 90 || v2 < 60 ? 'low' : 'ok') : t === 'sugar' ? (v >= 180 ? 'high' : v < 70 ? 'low' : 'ok') : 'ok';
function addVital(p, type, value, value2) {
  if (!['bp', 'sugar', 'weight', 'pulse', 'mood'].includes(type)) throw new Error('Unknown vital type');
  const v = { id: uid(), userId: p.id, type, value: +value, value2: value2 != null && value2 !== '' ? +value2 : null, at: Date.now() };
  v.flag = flagVital(type, v.value, v.value2); db.vitals.push(v); save();
  if (v.flag !== 'ok') alertCircle(p, 'vital', `${p.name} logged a ${v.flag} ${type === 'bp' ? 'blood pressure' : 'blood sugar'} reading (${v.value}${v.value2 ? '/' + v.value2 : ''}).`);
  return v;
}
function sos(p) { alertCircle(p, 'sos', `SOS from ${p.name}! Please check in right now.`); notifyCircle(p, 'sos', { msg: `SOS from ${p.name}` }); }

// ---------------------------------------------------------------- multilingual assistant
const SCRIPTS = [[/[\u0900-\u097F]/, 'hi-IN'], [/[\u0C00-\u0C7F]/, 'te-IN'], [/[\u0B80-\u0BFF]/, 'ta-IN'], [/[\u0980-\u09FF]/, 'bn-IN'], [/[\u0C80-\u0CFF]/, 'kn-IN'], [/[\u0D00-\u0D7F]/, 'ml-IN'], [/[\u0A80-\u0AFF]/, 'gu-IN'], [/[\u0A00-\u0A7F]/, 'pa-IN'], [/[\u0600-\u06FF]/, 'ar-SA'], [/[\u0400-\u04FF]/, 'ru-RU'], [/[\u4E00-\u9FFF]/, 'zh-CN'], [/[\u3040-\u30FF]/, 'ja-JP'], [/[\uAC00-\uD7AF]/, 'ko-KR'], [/[\u0E00-\u0E7F]/, 'th-TH']];
function detect(text, hint) {
  for (const [re, l] of SCRIPTS) if (re.test(text)) return l;
  const t = ' ' + text.toLowerCase() + ' ';
  if (/\b(dawai|dawa|goli|le li|kha li|madad|mujhe|meri)\b/.test(t)) return 'hi-IN';
  if (/\b(mandu|tisukunna|vesukunna|naaku)\b/.test(t)) return 'te-IN';
  if (/\b(tomé|toma|mi |hoy|ayuda|siguiente|medicina|pastilla|gracias|hola)\b/.test(t)) return 'es-ES';
  if (/\b(j'ai|je |mon |ma |prochain|médicament|bonjour|merci|aide)\b/.test(t)) return 'fr-FR';
  if (/\b(ich|nicht|meine|nächste|hilfe|danke|tablette|hallo)\b/.test(t)) return 'de-DE';
  if (/\b(eu |não|minha|obrigado|remédio|olá)\b/.test(t)) return 'pt-BR';
  return hint && hint !== 'auto' ? hint : 'en-US';
}
const KW = {
  sos: ['sos', 'emergency', 'help me', 'chest pain', "can't breathe", 'cannot breathe', 'मदद', 'आपातकाल', 'सहायता', 'సహాయం', 'అత్యవసరం', 'ayuda', 'urgence', 'au secours', 'hilfe', 'notfall', 'உதவி', 'طوارئ', 'مساعدة', 'madad'],
  take: ['took', 'taken', 'i had', 'i ate', 'just had', 'swallowed', 'खा ली', 'खा लिया', 'ले ली', 'ले लिया', 'लिया', 'తీసుకున్న', 'వేసుకున్న', 'எடுத்தேன்', 'சாப்பிட்டேன்', 'tomé', 'ya tomé', "j'ai pris", 'ich habe genommen', 'eu tomei', 'أخذت', 'تناولت', 'le li', 'kha li', 'vesukunna', 'tisukunna'],
  snooze: ['snooze', 'remind me later', 'remind me again', 'बाद में', 'వాయిదా', 'más tarde', 'plus tard', 'später'],
  next: ['next', "what's due", 'whats due', 'when do i', 'अगली', 'कब', 'తర్వాతి', 'తరువాత', 'ఎప్పుడు', 'siguiente', 'cuál toca', 'prochain', 'nächste', 'அடுத்த'],
  today: ['today', 'schedule', 'all my medicines', 'आज', 'ఈ రోజు', 'hoy', "aujourd'hui", 'heute', 'இன்று'],
  streak: ['streak', 'my score', 'my xp', 'level', 'स्ट्रीक', 'స్ట్రీక్', 'racha', 'série'],
  joke: ['joke', 'funny', 'make me laugh', 'मज़ाक', 'चुटकुला', 'జోక్', 'chiste', 'blague', 'witz'],
  thanks: ['thank', 'धन्यवाद', 'शुक्रिया', 'ధన్యవాదాలు', 'gracias', 'merci', 'danke', 'நன்றி', 'شكرا'],
  hello: ['hello', 'hey', 'namaste', 'नमस्ते', 'హలో', 'నమస్కారం', 'hola', 'bonjour', 'hallo', 'வணக்கம்', 'مرحبا', 'good morning', 'good evening']
};
const T = {
  en: { hi: n => `Hey ${n}! MedMate at your service. Pills don't take themselves (I checked).`, take: (m, x) => `Boom! ${m} logged. +${x} XP. Your future self just sent a thank-you note.`, nomatch: "Hmm, I can't spot that medicine in your list. Try saying the name as it appears in the app.", nothing: "Nothing is due right now, so no tablets needed. Enjoy the free time!", next: (m, t) => `Next up: ${m} at ${t}. I'll nudge you, promise.`, none: "You're all done for today. Absolute legend behaviour!", streak: (s, l) => `You're on a ${s}-day streak at Level ${l}. Keep that flame alive!`, sos: "Alerting your care circle right now. Stay calm, help is on the way. If this is an emergency, call your local emergency number.", thanks: 'Anytime! Looking after you is my favourite hobby.', snooze: m => `Snoozed for ${m} minutes. I'll be back, like a very polite alarm clock.`, vital: (k, v) => `Logged your ${k}: ${v}. Nice work tracking it.`, added: (m, t) => `Added ${m} at ${t}. Your pill box just got a new roommate.`, unk: 'I missed that, but I learn fast! Try "I took my medicine", "what\'s next" or "add Vitamin D at 9 pm".' },
  hi: { hi: n => `नमस्ते ${n}! मैं MedMate हूँ, आपकी दवाइयों का साथी।`, take: (m, x) => `वाह! ${m} दर्ज हो गई। +${x} XP। आपकी सेहत ने ताली बजाई!`, nomatch: 'यह दवा मुझे सूची में नहीं मिली। ऐप में दिखने वाला नाम बोलकर देखें।', nothing: 'अभी कोई दवा लेने का समय नहीं है। आराम करें!', next: (m, t) => `अगली दवा: ${m}, ${t} बजे। मैं याद दिला दूँगा।`, none: 'आज की सारी दवाइयाँ हो चुकी हैं। शाबाश!', streak: (s, l) => `आपकी ${s} दिन की स्ट्रीक है और लेवल ${l}। ऐसे ही चलते रहें!`, sos: 'मैं आपके परिवार को अभी सूचित कर रहा हूँ। घबराइए मत, मदद आ रही है। आपात स्थिति हो तो स्थानीय आपातकालीन नंबर पर कॉल करें।', thanks: 'कभी भी! आपका ख्याल रखना मेरा पसंदीदा काम है।', snooze: m => `${m} मिनट के लिए टाल दिया। मैं फिर याद दिलाऊँगा।`, vital: (k, v) => `${k} दर्ज हो गया: ${v}।`, added: (m, t) => `${m} को ${t} पर जोड़ दिया।`, unk: 'मैं समझ नहीं पाया। कहिए "मैंने दवा ले ली" या "अगली दवा कौन सी है"।' },
  te: { hi: n => `హలో ${n}! నేను MedMate, మీ మందుల నేస్తాన్ని.`, take: (m, x) => `సూపర్! ${m} నమోదైంది. +${x} XP. మీ ఆరోగ్యం చప్పట్లు కొడుతోంది!`, nomatch: 'ఆ మందు మీ జాబితాలో కనిపించలేదు. యాప్‌లో ఉన్న పేరు చెప్పండి.', nothing: 'ఇప్పుడు వేసుకోవాల్సిన మందులు ఏమీ లేవు. విశ్రాంతి తీసుకోండి!', next: (m, t) => `తర్వాతి మందు: ${m}, ${t} కి. నేను గుర్తు చేస్తాను.`, none: 'ఈ రోజు మందులన్నీ అయిపోయాయి. శభాష్!', streak: (s, l) => `మీ స్ట్రీక్ ${s} రోజులు, లెవల్ ${l}. ఇలాగే కొనసాగించండి!`, sos: 'మీ కుటుంబ సభ్యులకు ఇప్పుడే తెలియజేస్తున్నాను. భయపడకండి, సహాయం వస్తోంది. అత్యవసరమైతే స్థానిక అత్యవసర నంబర్‌కు కాల్ చేయండి.', thanks: 'ఎప్పుడైనా! మిమ్మల్ని చూసుకోవడం నాకు ఇష్టం.', snooze: m => `${m} నిమిషాలు వాయిదా వేశాను. మళ్లీ గుర్తు చేస్తాను.`, vital: (k, v) => `${k} నమోదైంది: ${v}.`, added: (m, t) => `${m} ను ${t} కి చేర్చాను.`, unk: 'నాకు అర్థం కాలేదు. "నేను మందు వేసుకున్నాను" లేదా "తర్వాతి మందు ఏది" అని చెప్పండి.' },
  es: { hi: n => `¡Hola ${n}! Soy MedMate, tu compañero de pastillas.`, take: (m, x) => `¡Listo! ${m} registrada. +${x} XP. ¡Tu salud te aplaude!`, nomatch: 'No encuentro ese medicamento en tu lista. ¿Puedes decir su nombre como aparece en la app?', nothing: 'No toca ninguna pastilla ahora. ¡A disfrutar del descanso!', next: (m, t) => `Lo siguiente: ${m} a las ${t}. Yo te aviso.`, none: 'Ya terminaste todo por hoy. ¡Eres una leyenda!', streak: (s, l) => `Llevas ${s} días de racha y nivel ${l}. ¡Que no se apague la llama!`, sos: 'Avisando a tu círculo de cuidado ahora mismo. Tranquilo, llega ayuda. Si es una emergencia, llama a tu número de emergencias.', thanks: '¡Cuando quieras! Cuidarte es mi pasatiempo favorito.', snooze: m => `Pospuesto ${m} minutos. Vuelvo enseguida.`, vital: (k, v) => `${k} registrado: ${v}.`, added: (m, t) => `${m} añadido a las ${t}.`, unk: 'No te entendí. Prueba con "ya tomé mi medicina" o "cuál es la siguiente".' }
};
const JOKES = ["Why did the pill go to school? To get a little tablet-ure education.", "I told my pill box a secret. It said: don't worry, I'm good at keeping compartments.", "Doctor: you need more fibre. Me: I need more snooze buttons.", "What do you call a medicine that tells jokes? A laugh-ative."];
const fmt12 = t => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${p2(m)} ${h < 12 ? 'AM' : 'PM'}`; };

function context(p) {
  const s = stats(p), items = scheduleFor(p, ymd(new Date())).map(it => ({ medicine: it.name, dose: it.dose, time: it.time, status: statusOf(it, p) }));
  return { name: p.name, now: hm(new Date()), today: items, medicines: db.meds.filter(m => m.userId === p.id && m.active).map(m => m.name), streak: s.streak, level: s.level, adherence7: s.adh7 };
}
function localAssist(u, p, text, ctx, hint) {
  const lang = detect(text, hint), L = T[lang.slice(0, 2)] || T.en, t = ' ' + text.toLowerCase() + ' ';
  const has = k => KW[k].some(w => t.includes(w));
  const actions = [], first = p.name.split(' ')[0];
  const out = (reply, acts = actions) => ({ reply, lang: T[lang.slice(0, 2)] ? lang : 'en-US', actions: acts, engine: 'local' });
  if (has('sos')) { sos(p); return out(L.sos, [{ type: 'sos' }]); }
  const bp = t.match(/(\d{2,3})\s*(?:\/|over|by)\s*(\d{2,3})/), sg = t.match(/(?:sugar|glucose|షుగర్|शुगर|चीनी|azúcar)\D{0,14}(\d{2,3})/);
  if (bp) { addVital(p, 'bp', bp[1], bp[2]); return out(L.vital('BP', `${bp[1]}/${bp[2]}`), [{ type: 'vital' }]); }
  if (sg) { addVital(p, 'sugar', sg[1]); return out(L.vital('sugar', sg[1]), [{ type: 'vital' }]); }
  const add = text.match(/add\s+(.+?)\s+(?:at|@)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (add) {
    let h = +add[2]; const mi = add[3] || '00', ap = (add[4] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
    const m = addMed(p, { name: add[1].replace(/\b\w/g, c => c.toUpperCase()), times: [`${p2(h)}:${mi}`], stock: 30 });
    return out(L.added(m.name, fmt12(m.times[0])), [{ type: 'add_med' }]);
  }
  if (has('snooze')) { const it = snoozeNext(p, 10); return out(it ? L.snooze(10) : L.nothing, [{ type: 'snooze' }]); }
  if (has('take')) {
    const named = ctx.medicines.find(n => t.includes(n.toLowerCase()));
    const r = takeByName(p, named, 'voice');
    if (r.ok) return out(L.take(r.item.name, r.xp), [{ type: 'take' }]);
    return out(r.error === 'nomatch' ? L.nomatch : L.nothing);
  }
  if (has('streak')) return out(L.streak(ctx.streak, ctx.level));
  if (has('next') || has('today')) {
    if (has('today') && !has('next')) {
      const l = ctx.today.map(i => `${i.medicine} ${fmt12(i.time)} (${i.status})`).join(', ');
      return out(l ? `Today: ${l}.` : L.none);
    }
    const nx = scheduleFor(p, ymd(new Date())).find(i => !i.log && ['due', 'upcoming', 'snoozed'].includes(statusOf(i, p)));
    return out(nx ? L.next(nx.name, fmt12(nx.time)) : L.none);
  }
  if (has('joke')) return out(JOKES[Math.floor(Math.random() * JOKES.length)], [{ type: 'none' }]);
  if (has('thanks')) return out(L.thanks);
  if (has('hello')) return out(L.hi(first));
  return out(L.unk);
}

async function claudeCall(system, messages, max = 700) {
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: MODEL, max_tokens: max, system, messages }) });
  if (!r.ok) throw new Error(`Claude API ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json(); return j.content.map(c => c.text || '').join('');
}
async function claudeAssist(u, p, text, history, ctx) {
  const system = `You are MedMate, the warm, witty voice of a medication-reminder app. You understand ANY language and ALWAYS reply in the language and script the user used. Keep replies to 1-3 short sentences: playful, caring, a little funny, at most 2 emoji. Never diagnose or change doses; for symptoms or medical decisions suggest a doctor or pharmacist. For emergencies (chest pain, trouble breathing, stroke signs, "SOS") use the sos action.
Return ONLY JSON: {"reply": string, "lang": BCP-47 code of the reply language such as "te-IN", "actions": [...]}.
Allowed actions: {"type":"take","medName":string|null} (user says they took a medicine; null means the closest due one), {"type":"add_med","name":string,"dose":string,"times":["HH:MM" 24h]}, {"type":"vital","vtype":"bp"|"sugar"|"weight"|"pulse"|"mood","value":number,"value2":number|null}, {"type":"sos"}, {"type":"snooze","minutes":number}, {"type":"navigate","page":"today"|"meds"|"insights"|"box"|"health"|"circle"|"report"|"settings"}, {"type":"none"}.
Only emit an action when the user clearly asked for it. App data right now: ${JSON.stringify(ctx)}`;
  const msgs = (history || []).slice(-6).filter(m => m && ['user', 'assistant'].includes(m.role) && m.content).map(m => ({ role: m.role, content: String(m.content).slice(0, 500) }));
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  const clean = []; msgs.forEach(m => { if (!clean.length || clean[clean.length - 1].role !== m.role) clean.push(m); });
  if (clean.length && clean[clean.length - 1].role === 'user') clean.pop();
  clean.push({ role: 'user', content: text });
  const raw = await claudeCall(system, clean), j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  return { reply: String(j.reply || '').slice(0, 600), lang: j.lang || 'en-US', actions: runActions(p, j.actions || []), engine: 'claude' };
}
function runActions(p, acts) {
  const done = [];
  for (const a of acts) {
    try {
      if (a.type === 'take') { const r = takeByName(p, a.medName, 'voice'); done.push({ type: 'take', ok: !!r.ok, error: r.error, med: r.item && r.item.name }); }
      else if (a.type === 'add_med' && a.name) { const m = addMed(p, { name: a.name, dose: a.dose, times: a.times && a.times.length ? a.times : ['08:00'], stock: 30 }); done.push({ type: 'add_med', ok: true, name: m.name }); }
      else if (a.type === 'vital') { addVital(p, a.vtype, a.value, a.value2); done.push({ type: 'vital', ok: true }); }
      else if (a.type === 'sos') { sos(p); done.push({ type: 'sos', ok: true }); }
      else if (a.type === 'snooze') { snoozeNext(p, Math.min(60, +a.minutes || 10)); done.push({ type: 'snooze', ok: true }); }
      else if (a.type === 'navigate') done.push({ type: 'navigate', page: a.page });
    } catch (e) { done.push({ type: a.type, ok: false, error: e.message }); }
  }
  return done;
}

// ---------------------------------------------------------------- demo data
function seed() {
  const pat = mkUser({ name: 'Asha (demo patient)', email: 'demo@medmate.app', password: 'demo123', role: 'patient', code: 'MM-DEMO' });
  const cg = mkUser({ name: 'Ravi (demo caregiver)', email: 'caregiver@medmate.app', password: 'demo123', role: 'caregiver' });
  cg.linked = [pat.id];
  const start = addDays(ymd(new Date()), -14);
  [['Amlodipine', '5 mg', ['08:00'], '#A71F13', 30], ['Metformin', '500 mg', ['08:30', '20:30'], '#D88B79', 60], ['Thyroxine', '50 mcg', ['06:30'], '#D9B6A3', 25], ['Atorvastatin', '10 mg', ['21:00'], '#340A10', 18]].forEach(([name, dose, times, color, stock]) =>
    db.meds.push({ id: uid(), userId: pat.id, name, dose, form: 'tablet', times, days: [], color, stock, perDose: 1, notes: '', start, active: true, createdAt: Date.now() + db.meds.length }));
  const now = Date.now();
  for (let k = 14; k >= 0; k--) {
    const date = addDays(ymd(new Date()), -k);
    scheduleFor(pat, date).forEach(it => {
      if (it.ts > now - pat.grace * 60000) return;
      const ok = k <= 3 || Math.random() < 0.86, delay = Math.round(Math.random() * 22);
      db.logs.push({ id: uid(), userId: pat.id, medId: it.medId, date, time: it.time, status: ok ? 'taken' : 'missed', takenAt: ok ? it.ts + delay * 60000 : null, delay: ok ? delay : null, via: ok ? 'app' : 'auto' });
    });
  }
  pat.xp = db.logs.filter(l => l.status === 'taken').length * 8;
  for (let k = 9; k >= 0; k--) {
    const t = now - k * 864e5 + 36e5, sys = 118 + Math.round(Math.random() * 24), dia = 76 + Math.round(Math.random() * 12);
    db.vitals.push({ id: uid(), userId: pat.id, type: 'bp', value: sys, value2: dia, at: t, flag: flagVital('bp', sys, dia) });
    if (k % 2) { const sg = 105 + Math.round(Math.random() * 60); db.vitals.push({ id: uid(), userId: pat.id, type: 'sugar', value: sg, value2: null, at: t + 6e5, flag: flagVital('sugar', sg) }); }
  }
  save(); console.log('Seeded demo accounts: demo@medmate.app / demo123 (patient), caregiver@medmate.app / demo123 (caregiver)');
}
if (!db.users.length) seed();

// ---------------------------------------------------------------- HTTP API
const app = express();
app.use(express.json({ limit: '12mb' }));
app.use(express.static(path.join(__dirname, 'public')));
const R = fn => async (req, res) => { try { await fn(req, res); } catch (e) { console.error(e); res.status(e.status || 500).json({ error: e.message }); } };
const auth = (req, res, next) => { const u = readToken((req.headers.authorization || '').replace('Bearer ', '')); if (!u) return res.status(401).json({ error: 'Please sign in again.' }); req.user = u; next(); };
function patientOf(req, res) {
  const u = req.user; if (u.role === 'patient') return u;
  const id = req.query.patientId || (req.body && req.body.patientId) || u.linked[0];
  const p = db.users.find(x => x.id === id && u.linked.includes(x.id));
  if (!p) res.status(404).json({ error: 'No linked patient yet. Add a patient code in Care Circle.' });
  return p;
}
const linkCaregiver = (u, code) => {
  const p = db.users.find(x => x.role === 'patient' && x.code === String(code || '').trim().toUpperCase());
  if (!p) throw Object.assign(new Error('That patient code was not found. Check it and try again.'), { status: 404 });
  if (!u.linked.includes(p.id)) u.linked.push(p.id); save(); return p;
};

app.get('/api/config', (req, res) => res.json({ ai: !!KEY, model: KEY ? MODEL : null }));
app.post('/api/auth/register', R((req, res) => {
  const { name, email, password, role, code } = req.body || {};
  if (!name || !email || !password || password.length < 6) return res.status(400).json({ error: 'Add your name, an email and a password of 6+ characters.' });
  if (db.users.some(u => u.email === email.toLowerCase())) return res.status(409).json({ error: 'That email already has an account. Try signing in.' });
  const u = mkUser({ name: name.trim(), email, password, role: role === 'caregiver' ? 'caregiver' : 'patient' });
  if (u.role === 'caregiver' && code) linkCaregiver(u, code);
  res.json({ token: mkToken(u.id), user: pub(u) });
}));
app.post('/api/auth/login', R((req, res) => {
  const { email, password } = req.body || {}, u = db.users.find(x => x.email === String(email || '').toLowerCase());
  if (!u || hash(String(password || ''), u.salt) !== u.pw) return res.status(401).json({ error: 'Email or password is not right.' });
  res.json({ token: mkToken(u.id), user: pub(u) });
}));
app.get('/api/me', auth, R((req, res) => res.json({ user: pub(req.user), patients: db.users.filter(x => (req.user.linked || []).includes(x.id)).map(pub) })));
app.put('/api/settings', auth, R((req, res) => {
  const u = req.user, b = req.body || {};
  if (b.name) u.name = String(b.name).slice(0, 40);
  if (b.lang) u.lang = String(b.lang).slice(0, 10);
  if (b.grace) u.grace = Math.max(1, Math.min(180, +b.grace));
  save(); res.json({ user: pub(u) });
}));
app.post('/api/link', auth, R((req, res) => {
  if (req.user.role !== 'caregiver') return res.status(403).json({ error: 'Only caregivers can link to a patient.' });
  const p = linkCaregiver(req.user, req.body.code); res.json({ patient: pub(p), user: pub(req.user) });
}));
app.get('/api/circle', auth, R((req, res) => {
  const u = req.user, date = ymd(new Date());
  if (u.role === 'patient') return res.json({ caregivers: db.users.filter(x => x.linked && x.linked.includes(u.id)).map(x => ({ id: x.id, name: x.name })), code: u.code });
  res.json({ patients: db.users.filter(x => u.linked.includes(x.id)).map(p => { const it = scheduleFor(p, date), st = it.map(i => statusOf(i, p)); return { ...pub(p), total: it.length, taken: st.filter(s => s === 'taken').length, missed: st.filter(s => s === 'missed').length, due: st.filter(s => s === 'due').length, streak: stats(p).streak }; }) });
}));
app.post('/api/nudge', auth, R((req, res) => {
  const p = patientOf(req, res); if (!p) return;
  emit(p.id, 'nudge', { from: req.user.name }); res.json({ ok: true });
}));

app.get('/api/today', auth, R((req, res) => {
  const p = patientOf(req, res); if (!p) return;
  const date = ymd(new Date()), now = Date.now();
  const items = scheduleFor(p, date).map(it => ({ ...it, status: statusOf(it, p, now), snooze: snoozes[key(it, p)] || 0 }));
  const taken = items.filter(i => i.status === 'taken').length, s = stats(p);
  res.json({ date, patient: pub(p), items, total: items.length, taken, next: items.find(i => ['due', 'snoozed', 'upcoming'].includes(i.status)) || null, streak: s.streak, xp: s.xp, level: s.level, into: s.into, aiReady: !!KEY });
}));
app.post('/api/dose', auth, R((req, res) => {
  const p = patientOf(req, res); if (!p) return;
  const b = req.body || {}, before = Math.floor((p.xp || 0) / 100);
  if (b.status === 'snoozed') { const it = scheduleFor(p, b.date || ymd(new Date())).find(i => i.medId === b.medId && i.time === b.time); if (it) { snoozes[key(it, p)] = (snoozes[key(it, p)] || 0) + (+b.minutes || 10); notifyCircle(p, 'snooze', { name: it.name, minutes: +b.minutes || 10 }); } return res.json({ ok: true }); }
  const r = recordDose(p, { medId: b.medId, time: b.time, date: b.date, status: b.status === 'skipped' ? 'skipped' : 'taken', via: req.user.role === 'caregiver' ? 'caregiver' : 'app' });
  if (r.error) return res.status(400).json(r);
  res.json({ ...r, leveledUp: Math.floor((p.xp || 0) / 100) > before });
}));

app.get('/api/meds', auth, R((req, res) => {
  const p = patientOf(req, res); if (!p) return;
  const meds = db.meds.filter(m => m.userId === p.id && m.active).map(m => ({ ...m, daysLeft: daysLeft(m) }));
  res.json({ meds, interactions: interactions(meds) });
}));
app.post('/api/meds', auth, R((req, res) => { const p = patientOf(req, res); if (!p) return; res.json({ med: addMed(p, req.body) }); }));
app.put('/api/meds/:id', auth, R((req, res) => {
  const p = patientOf(req, res); if (!p) return;
  const m = db.meds.find(x => x.id === req.params.id && x.userId === p.id); if (!m) return res.status(404).json({ error: 'Medicine not found' });
  const b = medBody({ ...m, ...req.body }); if (!b.name || !b.times.length) return res.status(400).json({ error: 'A medicine needs a name and at least one time.' });
  Object.assign(m, b); save(); res.json({ med: m });
}));
app.post('/api/meds/:id/refill', auth, R((req, res) => {
  const p = patientOf(req, res); if (!p) return;
  const m = db.meds.find(x => x.id === req.params.id && x.userId === p.id); if (!m) return res.status(404).json({ error: 'Medicine not found' });
  m.stock += Math.max(0, +req.body.qty || 0); save(); res.json({ med: m });
}));
app.delete('/api/meds/:id', auth, R((req, res) => {
  const p = patientOf(req, res); if (!p) return;
  const m = db.meds.find(x => x.id === req.params.id && x.userId === p.id); if (m) { m.active = false; save(); } res.json({ ok: true });
}));

app.get('/api/stats', auth, R((req, res) => { const p = patientOf(req, res); if (!p) return; res.json(stats(p)); }));
app.get('/api/vitals', auth, R((req, res) => { const p = patientOf(req, res); if (!p) return; res.json({ vitals: db.vitals.filter(v => v.userId === p.id).slice(-60) }); }));
app.post('/api/vitals', auth, R((req, res) => { const p = patientOf(req, res); if (!p) return; res.json({ vital: addVital(p, req.body.type, req.body.value, req.body.value2) }); }));
app.get('/api/alerts', auth, R((req, res) => res.json({ alerts: db.alerts.filter(a => a.userId === req.user.id).slice(-40).reverse(), unread: db.alerts.filter(a => a.userId === req.user.id && !a.read).length })));
app.post('/api/alerts/read', auth, R((req, res) => { db.alerts.forEach(a => { if (a.userId === req.user.id) a.read = true; }); save(); res.json({ ok: true }); }));
app.post('/api/sos', auth, R((req, res) => { if (req.user.role !== 'patient') return res.status(403).json({ error: 'SOS is for patients.' }); sos(req.user); res.json({ ok: true }); }));
app.get('/api/report', auth, R((req, res) => {
  const p = patientOf(req, res); if (!p) return;
  const missed = db.logs.filter(l => l.userId === p.id && l.status === 'missed' && l.date >= addDays(ymd(new Date()), -14)).map(l => ({ ...l, name: (db.meds.find(m => m.id === l.medId) || {}).name })).reverse();
  res.json({ patient: pub(p), meds: db.meds.filter(m => m.userId === p.id && m.active), stats: stats(p), vitals: db.vitals.filter(v => v.userId === p.id).slice(-20).reverse(), missed, interactions: interactions(db.meds.filter(m => m.userId === p.id && m.active)), generated: new Date().toLocaleString() });
}));

// Smart pill box (ESP32 or the on-screen simulator) calls this when a lid opens. Public: identified by the patient code.
app.post('/api/device/event', R((req, res) => {
  const { code, slot } = req.body || {}, p = db.users.find(u => u.role === 'patient' && u.code === String(code || '').toUpperCase());
  if (!p) return res.status(404).json({ ok: false, led: 'red', msg: 'Unknown box code' });
  const meds = db.meds.filter(m => m.userId === p.id && m.active).sort((a, b) => a.createdAt - b.createdAt), m = slot ? meds[slot - 1] : null;
  if (slot && !m) return res.json({ ok: true, matched: false, led: 'red', msg: 'That slot is empty' });
  const r = takeByName(p, null, 'box', m && m.id);
  if (r.ok) return res.json({ ok: true, matched: true, led: 'green', msg: `${r.item.name} logged. Nice!`, xp: r.xp });
  notifyCircle(p, 'box', { msg: `${p.name} opened the box outside a dose time.` });
  res.json({ ok: true, matched: false, led: 'amber', msg: 'Not time for this one yet.' });
}));

// Live stream for the browser (EventSource cannot send headers, so the token rides in the query string)
app.get('/api/events', (req, res) => {
  const u = readToken(req.query.token); if (!u) return res.status(401).end();
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); res.flushHeaders();
  res.write('retry: 3000\n\n');
  if (!clients.has(u.id)) clients.set(u.id, new Set());
  clients.get(u.id).add(res);
  const hb = setInterval(() => res.write(': hb\n\n'), 25000);
  req.on('close', () => { clearInterval(hb); clients.get(u.id).delete(res); });
});

function startServer(port, attempts = 0) {
  const maxAttempts = 20;
  const server = app.listen(port, () => {
    console.log('');
    console.log(`MedMate is running:  http://localhost:${port}`);
    console.log(`Voice/AI engine:     ${KEY ? `${MODEL}` : 'Local only'}`);
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      if (attempts >= maxAttempts) {
        throw new Error(`Port ${port} is busy and no free port was found in range ${PORT}..${PORT + maxAttempts}.`);
      }
      const nextPort = port + 1;
      console.warn(`Port ${port} is busy. Retrying on ${nextPort}...`);
      startServer(nextPort, attempts + 1);
      return;
    }
    throw err;
  });
}

app.post('/api/assistant', auth, R(async (req, res) => {
  const p = patientOf(req, res); if (!p) return;
  const text = String((req.body && req.body.text) || '').trim().slice(0, 500);
  if (!text) return res.status(400).json({ error: 'Say or type something first.' });
  const ctx = context(p);
  if (KEY) { try { return res.json(await claudeAssist(req.user, p, text, req.body.history, ctx)); } catch (e) { console.warn('Claude unavailable, using local assistant:', e.message); } }
  res.json(localAssist(req.user, p, text, ctx, req.body.lang));
}));

app.post('/api/scan', auth, R(async (req, res) => {
  if (!KEY) return res.status(503).json({ error: 'Prescription scanning needs ANTHROPIC_API_KEY in your .env file.' });
  const m = /^data:(image\/(?:png|jpe?g|webp|gif));base64,(.+)$/.exec((req.body && req.body.image) || '');
  if (!m) return res.status(400).json({ error: 'Please upload a PNG, JPG or WEBP photo.' });
  const body = { model: MODEL, max_tokens: 900, system: 'You read photos of prescriptions and medicine strips. Return ONLY JSON: {"medicines":[{"name":string,"dose":string,"times":["HH:MM"],"notes":string}]}. Map morning to 08:00, afternoon to 14:00, evening to 18:00, night to 21:00, twice daily to 08:00 and 20:00. Return {"medicines":[]} if nothing readable.', messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }, { type: 'text', text: 'Extract the medicines.' }] }] };
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
  if (!r.ok) return res.status(502).json({ error: 'The scanner could not read that image. Try a clearer photo.' });
  const raw = (await r.json()).content.map(c => c.text || '').join('');
  res.json(JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)));
}));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

if (require.main === module) {
  startServer(PORT);
}

module.exports = app;
