'use strict';
/* MedMate frontend: vanilla JS single page app. No build step. */
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ico = (n, c = '') => `<svg class="ic ${c}"><use href="#i-${n}"/></svg>`;
const pick = a => a[Math.floor(Math.random() * a.length)];
const p2 = n => String(n).padStart(2, '0');
const fmt12 = t => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${p2(m)} ${h < 12 ? 'AM' : 'PM'}`; };
const S = { token: localStorage.getItem('mm_token'), user: null, patients: [], pid: localStorage.getItem('mm_pid'), page: 'today', cfg: { ai: false }, speak: localStorage.getItem('mm_speak') !== '0', sound: localStorage.getItem('mm_sound') !== '0', vlang: localStorage.getItem('mm_vlang') || 'auto', chat: [], unread: 0, es: null, scan: [] };
const setTheme = t => { document.documentElement.dataset.theme = t; localStorage.setItem('mm_theme', t); };
setTheme(localStorage.getItem('mm_theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

const acts = {}, forms = {}, PAGES = {};
const NAV = [['today', 'Today', 'home'], ['meds', 'Medicines', 'pill'], ['insights', 'Insights', 'chart'], ['box', 'Smart Box', 'box'], ['health', 'Health', 'heart'], ['circle', 'Care Circle', 'users'], ['report', 'Report', 'file'], ['settings', 'Settings', 'gear']];
const TITLES = { today: 'Today', meds: 'Medicines', insights: 'Insights', box: 'Smart Box', health: 'Health log', circle: 'Care Circle', report: 'Doctor report', settings: 'Settings' };
const LANGS = [['auto', 'Auto (device)'], ['en-US', 'English'], ['en-IN', 'English (India)'], ['hi-IN', 'हिन्दी'], ['te-IN', 'తెలుగు'], ['ta-IN', 'தமிழ்'], ['kn-IN', 'ಕನ್ನಡ'], ['ml-IN', 'മലയാളം'], ['gu-IN', 'ગુજરાતી'], ['bn-IN', 'বাংলা'], ['mr-IN', 'मराठी'], ['pa-IN', 'ਪੰਜਾਬੀ'], ['ur-PK', 'اردو'], ['es-ES', 'Español'], ['fr-FR', 'Français'], ['de-DE', 'Deutsch'], ['pt-BR', 'Português'], ['it-IT', 'Italiano'], ['ja-JP', '日本語'], ['ko-KR', '한국어'], ['zh-CN', '中文'], ['ar-SA', 'العربية'], ['ru-RU', 'Русский'], ['tr-TR', 'Türkçe'], ['id-ID', 'Bahasa Indonesia'], ['th-TH', 'ไทย'], ['vi-VN', 'Tiếng Việt'], ['nl-NL', 'Nederlands'], ['pl-PL', 'Polski'], ['sv-SE', 'Svenska'], ['el-GR', 'Ελληνικά']];
const CHEERS = ['Gold star earned!', 'Nailed it!', 'Look at you, adulting!', 'Dose logged. Legend.', 'Smooth as butter.', 'Your future self says thanks.'];
const TIPS = ['Drink a full glass of water with your tablets. Your kidneys will send a thank-you card.', 'Keep your pill box where you will see it, like next to the kettle or your toothbrush.', 'Tablets with food? Pair them with breakfast so you never have to think twice.', 'A 10-minute walk after meals helps blood sugar. Your legs will forgive you.', 'Never double up after a missed dose without asking a pharmacist first.', 'Store medicines away from the bathroom steam. Pills hate sauna days.', 'Refill when you have 7 days left. Future you loves a calm pharmacy visit.', 'Sleep is a medicine too. Aim for 7 to 8 hours.'];
const STATUS = { taken: 'Taken', due: 'Due now', missed: 'Missed', upcoming: 'Upcoming', skipped: 'Skipped', snoozed: 'Snoozed' };
const DRUGS = ['Amlodipine', 'Atorvastatin', 'Metformin', 'Aspirin', 'Losartan', 'Telmisartan', 'Levothyroxine', 'Thyroxine', 'Omeprazole', 'Pantoprazole', 'Paracetamol', 'Ibuprofen', 'Vitamin D3', 'Vitamin B12', 'Calcium', 'Iron', 'Insulin', 'Glimepiride', 'Clopidogrel', 'Warfarin', 'Ramipril', 'Metoprolol', 'Atenolol', 'Simvastatin', 'Rosuvastatin', 'Cetirizine', 'Montelukast', 'Salbutamol', 'Sertraline', 'Gabapentin'];
const COLORS = ['#A71F13', '#D88B79', '#D9B6A3', '#340A10', '#7a3b2e', '#c4553f'];

// ------------------------------------------------------------ api + feedback helpers
async function api(path, opt = {}) {
  const r = await fetch('/api' + path, { method: opt.method || (opt.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) }, body: opt.body ? JSON.stringify(opt.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { if (r.status === 401 && S.token && !path.startsWith('/auth')) logout(); throw new Error(j.error || 'Something went wrong. Please try again.'); }
  return j;
}
const P = p => p + (S.user && S.user.role === 'caregiver' && S.pid ? (p.includes('?') ? '&' : '?') + 'patientId=' + S.pid : '');
const B = o => ({ ...o, patientId: S.pid || undefined });
function toast(msg, type = 'ok', ms = 4600) { const t = document.createElement('div'); t.className = 'toast ' + type; t.innerHTML = msg; $('#toasts').appendChild(t); setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, ms); }
let AC;
function chime(f = [880, 1175]) {
  if (!S.sound) return;
  try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); f.forEach((fr, i) => { const o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime + i * .18; o.type = 'sine'; o.frequency.value = fr; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.18, t + .03); g.gain.exponentialRampToValueAtTime(.001, t + .5); o.connect(g).connect(AC.destination); o.start(t); o.stop(t + .55); }); } catch {}
}
function say(text, lang) {
  if (!S.speak || !window.speechSynthesis || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')); u.lang = lang || 'en-US';
  const vs = speechSynthesis.getVoices(), v = vs.find(x => x.lang === u.lang) || vs.find(x => x.lang.startsWith(u.lang.slice(0, 2)));
  if (v) u.voice = v; speechSynthesis.speak(u);
}
function notify(t, b) { if ('Notification' in window && Notification.permission === 'granted' && document.hidden) try { new Notification(t, { body: b, icon: '/logo.svg' }); } catch {} }

// confetti made of little capsules
const cv = $('#confetti'), cx = cv.getContext('2d'); let parts = [], running = false;
const fit = () => { cv.width = innerWidth; cv.height = innerHeight; }; addEventListener('resize', fit); fit();
function confetti(x = innerWidth / 2, y = innerHeight / 3, n = 70) {
  const cols = ['#A71F13', '#D88B79', '#D9B6A3', '#F3ECE4', '#340A10'];
  for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, s = 4 + Math.random() * 9; parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 6, r: Math.random() * 6.28, vr: (Math.random() - .5) * .4, w: 6 + Math.random() * 8, h: 12 + Math.random() * 10, c: cols[i % 5], l: 1 }); }
  if (!running) { running = true; requestAnimationFrame(loop); }
}
function loop() {
  cx.clearRect(0, 0, cv.width, cv.height); parts = parts.filter(p => p.l > 0 && p.y < cv.height + 40);
  parts.forEach(p => { p.vy += .35; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.l -= .007; cx.save(); cx.globalAlpha = Math.max(p.l, 0); cx.translate(p.x, p.y); cx.rotate(p.r); cx.fillStyle = p.c; cx.beginPath(); (cx.roundRect || cx.rect).call(cx, -p.w / 2, -p.h / 2, p.w, p.h, p.w / 2); cx.fill(); cx.restore(); });
  if (parts.length) requestAnimationFrame(loop); else running = false;
}
// button ripple + card tilt
document.addEventListener('pointerdown', e => { const b = e.target.closest('.btn'); if (!b) return; const r = b.getBoundingClientRect(); b.style.setProperty('--rx', e.clientX - r.left + 'px'); b.style.setProperty('--ry', e.clientY - r.top + 'px'); b.classList.remove('rip'); void b.offsetWidth; b.classList.add('rip'); });
document.addEventListener('pointermove', e => { const t = e.target.closest && e.target.closest('.tilt'); if (!t) return; const r = t.getBoundingClientRect(); t.style.transform = `perspective(900px) rotateY(${((e.clientX - r.left) / r.width - .5) * 7}deg) rotateX(${-((e.clientY - r.top) / r.height - .5) * 7}deg)`; });
document.addEventListener('pointerout', e => { const t = e.target.closest && e.target.closest('.tilt'); if (t && !t.contains(e.relatedTarget)) t.style.transform = ''; });
document.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (!b || !acts[b.dataset.act]) return; Promise.resolve(acts[b.dataset.act](b, e)).catch(err => toast(esc(err.message), 'bad')); });
document.addEventListener('submit', e => { const f = e.target.dataset.form; if (!f || !forms[f]) return; e.preventDefault(); Promise.resolve(forms[f](e.target, e)).catch(err => { const x = e.target.querySelector('.err'); if (x) x.textContent = err.message; else toast(esc(err.message), 'bad'); }); });
document.addEventListener('change', e => { if (e.target.id === 'vt') { const t = e.target.value; $('#v2f').style.display = t === 'bp' ? '' : 'none'; $('#l1').textContent = t === 'bp' ? 'Systolic (top)' : 'Value'; } if (e.target.id === 'psel') { S.pid = e.target.value; localStorage.setItem('mm_pid', S.pid); S.chat = []; show(S.page); } if (e.target.id === 'vl') { S.vlang = e.target.value; localStorage.setItem('mm_vlang', S.vlang); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); $('#va') && $('#va').classList.remove('open'); } });

function modal(html, cls = '') { closeModal(); const m = document.createElement('div'); m.className = 'modal'; m.innerHTML = `<div class="sheet ${cls}" role="dialog" aria-modal="true">${html}</div>`; m.addEventListener('mousedown', e => { if (e.target === m) closeModal(); }); document.body.appendChild(m); const f = $('input,select,textarea', m); if (f) setTimeout(() => f.focus(), 60); return m; }
const closeModal = () => $$('.modal').forEach(m => m.remove());
acts.close = closeModal;
const ask = (title, label, def = '') => new Promise(res => { const m = modal(`<h2>${esc(title)}</h2><form id="askf"><div class="field"><label>${esc(label)}</label><input name="v" type="number" min="0" value="${esc(def)}"></div><div class="row"><button class="btn ghost" type="button" id="ac">Cancel</button><button class="btn">OK</button></div></form>`); $('#askf', m).onsubmit = e => { e.preventDefault(); const v = new FormData(e.target).get('v'); closeModal(); res(v); }; $('#ac', m).onclick = () => { closeModal(); res(null); }; });
const confirmM = text => new Promise(res => { const m = modal(`<h2>${esc(text)}</h2><div class="row"><button class="btn ghost" id="cn">Not now</button><button class="btn" id="cy">Yes, do it</button></div>`); $('#cn', m).onclick = () => { closeModal(); res(false); }; $('#cy', m).onclick = () => { closeModal(); res(true); }; });

// ------------------------------------------------------------ auth screen
const ECG = 'M0 30H180L200 30 215 6 235 54 252 30H330L345 12 360 44 372 30H600';
function renderAuth(mode = 'login') {
  const caps = Array.from({ length: 14 }, (_, i) => `<i class="cap" style="--x:${(i * 7.2 + Math.random() * 4) % 96}%;--s:${12 + Math.random() * 16};--d:${9 + Math.random() * 10}s;--dl:-${(Math.random() * 12).toFixed(1)}s;--c1:${i % 2 ? '#F3ECE4' : '#D88B79'};--c2:${i % 3 ? '#A71F13' : '#D9B6A3'}"></i>`).join('');
  const reg = mode === 'register';
  $('#app').innerHTML = `<div class="auth"><section class="stage">${caps}<svg class="logobig" viewBox="0 0 120 120" role="img" aria-label="MedMate logo"><use href="#logo"/></svg><h1 class="big">Med<i>Mate</i></h1><p>Every dose, confirmed. Reminders that check, learn your routine, and tell your family when something slips.</p><svg class="heart" viewBox="0 0 600 60" aria-hidden="true"><path d="${ECG}"/></svg></section>
  <section class="formside"><div class="card"><h2>${reg ? 'Create your account' : 'Welcome back'}</h2><p class="muted">${reg ? 'It takes about 20 seconds.' : 'Sign in to see how today is going.'}</p>
  <form data-form="${reg ? 'reg' : 'login'}" class="gap">${reg ? `<div class="field"><label for="n">Your name</label><input id="n" name="name" autocomplete="name" required></div>` : ''}
  <div class="field"><label for="e">Email</label><input id="e" name="email" type="email" autocomplete="email" required></div>
  <div class="field"><label for="p">Password</label><input id="p" name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" minlength="6" required></div>
  ${reg ? `<div class="field"><label>I am a</label><div class="seg"><button type="button" class="on" data-act="role" data-r="patient">Patient</button><button type="button" data-act="role" data-r="caregiver">Caregiver</button></div><input type="hidden" name="role" value="patient"></div><div class="field" id="codef" style="display:none"><label for="c">Patient code (optional)</label><input id="c" name="code" placeholder="MM-DEMO"></div>` : ''}
  <p class="err"></p><button class="btn" style="width:100%">${reg ? 'Create account' : 'Sign in'}</button></form>
  <p class="tc gap muted">${reg ? 'Already have an account?' : 'New here?'} <button class="link" data-act="mode" data-m="${reg ? 'login' : 'register'}">${reg ? 'Sign in' : 'Create an account'}</button></p>
  <div class="demos"><button class="btn ghost sm" data-act="demo" data-e="demo@medmate.app">${ico('bolt')} Try demo patient</button><button class="btn ghost sm" data-act="demo" data-e="caregiver@medmate.app">${ico('users')} Try demo caregiver</button></div></div></section></div>`;
}
acts.mode = b => renderAuth(b.dataset.m);
acts.role = b => { $$('.seg button').forEach(x => x.classList.toggle('on', x === b)); $('[name=role]').value = b.dataset.r; $('#codef').style.display = b.dataset.r === 'caregiver' ? '' : 'none'; };
acts.demo = async b => start(await api('/auth/login', { body: { email: b.dataset.e, password: 'demo123' } }));
forms.login = async f => start(await api('/auth/login', { body: Object.fromEntries(new FormData(f)) }));
forms.reg = async f => start(await api('/auth/register', { body: Object.fromEntries(new FormData(f)) }));
async function start(j) { S.token = j.token; localStorage.setItem('mm_token', j.token); S.page = 'today'; await boot(); }
function logout() { localStorage.removeItem('mm_token'); S.token = null; S.user = null; S.chat = []; if (S.es) S.es.close(); speechSynthesis && speechSynthesis.cancel(); renderAuth(); }
acts.logout = logout;

// ------------------------------------------------------------ shell
async function boot() {
  try { S.cfg = await api('/config'); } catch {}
  if (!S.token) return renderAuth();
  try { const me = await api('/me'); S.user = me.user; S.patients = me.patients; } catch { return renderAuth(); }
  if (S.user.role === 'caregiver') { if (!S.patients.find(p => p.id === S.pid)) S.pid = S.patients[0] ? S.patients[0].id : null; } else S.pid = S.user.id;
  if (S.pid) localStorage.setItem('mm_pid', S.pid);
  renderShell(); connectEvents(); loadAlerts(); show(S.page);
}
const pcode = () => S.user.role === 'patient' ? S.user.code : (S.patients.find(p => p.id === S.pid) || {}).code;
function renderShell() {
  const u = S.user, isC = u.role === 'caregiver';
  $('#app').innerHTML = `<div class="shell"><aside class="side"><div class="brand"><svg viewBox="0 0 120 120"><use href="#logo"/></svg><span>Med<i>Mate</i></span></div><div style="height:16px"></div>${NAV.map(n => `<button class="nv" data-act="nav" data-p="${n[0]}">${ico(n[2])}${n[1]}</button>`).join('')}
  <div class="me"><div class="av">${esc(u.name[0])}</div><div style="min-width:0"><b style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(u.name)}</b><small class="muted">${isC ? 'Caregiver' : 'Patient'}, level ${u.level}</small></div></div></aside>
  <main><div class="top"><h1 id="ttl"></h1><div class="tools">${isC && S.patients.length ? `<select id="psel" aria-label="Patient">${S.patients.map(p => `<option value="${p.id}" ${p.id === S.pid ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : ''}${!isC ? `<button class="iconbtn sosbtn" data-act="sos" aria-label="Send SOS to my care circle">SOS</button>` : ''}<button class="iconbtn" data-act="theme" aria-label="Switch light or dark theme">${ico('moon')}</button><button class="iconbtn" id="bell" data-act="bell" aria-label="Alerts">${ico('bell')}<span class="dot" id="dot" hidden>0</span></button><button class="iconbtn" data-act="logout" aria-label="Sign out">${ico('logout')}</button></div></div><div id="view"></div></main></div>
  <nav class="tabs">${NAV.map(n => `<button data-act="nav" data-p="${n[0]}">${ico(n[2])}<span>${n[1].split(' ')[0]}</span></button>`).join('')}</nav>
  <button id="fab" data-act="va" aria-label="Open the MedMate voice assistant">${ico('mic')}</button>
  <section class="va" id="va" aria-label="MedMate assistant"><header><svg class="ic" viewBox="0 0 120 120" style="width:30px;height:30px"><use href="#logo"/></svg><b>MedMate assistant</b><select id="vl" aria-label="Voice language">${LANGS.map(l => `<option value="${l[0]}" ${S.vlang === l[0] ? 'selected' : ''}>${l[1]}</option>`).join('')}</select><button class="iconbtn" style="width:34px;height:34px;background:rgba(243,236,228,.14);color:#F3ECE4" data-act="va" aria-label="Close assistant">${ico('x')}</button></header>
  <div class="msgs" id="msgs"></div><div class="chips">${["What's next?", 'I took my medicine', 'How is my streak?', 'Tell me a joke', 'नमस्ते', 'తర్వాతి మందు ఏది?'].map(q => `<button class="chip" data-act="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
  <div class="vin"><button id="mic" data-act="mic" aria-label="Speak">${ico('mic')}</button><div class="wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><input id="vi" placeholder="Speak or type in any language" aria-label="Message"><button class="btn round" data-act="vsend" aria-label="Send">${ico('send')}</button></div></section>`;
  $('#vi').addEventListener('keydown', e => { if (e.key === 'Enter') acts.vsend(); });
  $('#dot').hidden = true;
}
acts.nav = b => show(b.dataset.p);
acts.theme = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
let ticker;
async function show(page, keep) {
  S.page = page; $$('[data-act=nav]').forEach(b => b.classList.toggle('on', b.dataset.p === page)); $('#ttl').textContent = TITLES[page];
  const v = $('#view'), y = scrollY; v.classList.remove('in'); v.classList.toggle('still', !!keep);
  let html;
  try {
    html = S.user.role === 'caregiver' && !S.pid && !['circle', 'settings'].includes(page)
      ? `<div class="card empty">${ico('users')}<h3>Link a patient first</h3><p class="muted">Ask them for their care code, then add it in Care Circle.</p><button class="btn gap" data-act="nav" data-p="circle">Open Care Circle</button></div>`
      : await PAGES[page]();
  } catch (e) { html = `<div class="card empty">${ico('alert')}<h3>That did not load</h3><p class="muted">${esc(e.message)}</p><button class="btn gap" data-act="nav" data-p="${page}">Try again</button></div>`; }
  v.innerHTML = html; $$('#view>*').forEach((e, i) => e.style.setProperty('--i', i)); void v.offsetWidth; v.classList.add('in');
  $$('[data-count]', v).forEach(el => { const to = +el.dataset.count, t0 = performance.now(); (function f(t) { const k = Math.min(1, (t - t0) / 900); el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(f); })(t0); });
  clearInterval(ticker); const tickEta = () => $$('[data-ts]').forEach(el => { const d = +el.dataset.ts - Date.now(); el.textContent = d > 0 ? 'in ' + (d > 36e5 ? `${Math.floor(d / 36e5)}h ${Math.floor(d % 36e5 / 6e4)}m` : `${p2(Math.floor(d / 6e4))}:${p2(Math.floor(d % 6e4 / 1000))}`) : 'due now'; }); tickEta(); ticker = setInterval(tickEta, 1000);
  if (keep) scrollTo(0, y);
}

// ------------------------------------------------------------ Today
const doseRow = (it, isC) => {
  const can = ['due', 'upcoming', 'snoozed', 'missed'].includes(it.status);
  return `<div class="dose ${it.status}" style="--c:${it.color}"><div class="pico">${ico('pill')}</div><div class="dinfo"><b>${esc(it.name)}</b><span class="muted">${esc(it.dose)} at ${fmt12(it.time)}${it.perDose > 1 ? ', ' + it.perDose + ' pills' : ''}</span></div><div class="dbtns"><span class="chip ${it.status}">${it.status === 'taken' ? ico('check') : ''} ${STATUS[it.status]}${it.status === 'taken' && it.log && it.log.via === 'box' ? ' via box' : ''}</span>
  ${can && !isC ? `<button class="btn sm" data-act="take" data-m="${it.medId}" data-t="${it.time}" data-d="${it.date}">${ico('check')} Take</button>${it.status !== 'missed' ? `<button class="btn ghost sm" data-act="snooze" data-m="${it.medId}" data-t="${it.time}" data-d="${it.date}">Snooze 10</button><button class="btn ghost sm" data-act="skip" data-m="${it.medId}" data-t="${it.time}" data-d="${it.date}">Skip</button>` : ''}` : ''}
  ${can && isC ? `<button class="btn coral sm" data-act="nudge">Nudge</button>` : ''}</div></div>`;
};
PAGES.today = async () => {
  const d = await api(P('/today')), isC = S.user.role === 'caregiver', pct = d.total ? d.taken / d.total : 0, h = new Date().getHours();
  const hello = h < 5 ? 'Burning the midnight oil' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening', first = d.patient.name.split(' ')[0];
  const line = d.total && pct === 1 ? pick(['Every dose done. Take a bow.', 'Perfect day. Your pill box is doing a happy dance.']) : d.total ? pick(['Small pills, big wins.', 'Your future self says thanks in advance.', "Let's keep that streak glowing."]) : 'No doses today. Sip some water and relax.';
  const nx = d.next;
  return `<section class="card hero tilt"><div class="ringwrap"><svg class="ring" viewBox="0 0 120 120"><circle class="trk" cx="60" cy="60" r="54"/><circle class="bar" cx="60" cy="60" r="54" style="--p:${pct}"/></svg><div class="ringtxt"><div><span data-count="${d.taken}">0</span>/${d.total}<small>doses done</small></div></div></div>
  <div><h2>${hello}, ${esc(first)}</h2><p>${line}</p><div class="stats"><span class="pillstat">${ico('flame', 'flame')} ${d.streak}-day streak</span><span class="pillstat">${ico('sparkle')} Level ${d.level}</span><span class="pillstat">${ico('bolt')} ${d.xp} XP</span></div><div class="xpbar" title="Progress to the next level"><i style="width:${d.into}%"></i></div></div></section>
  ${nx ? `<section class="card next"><div><span class="muted">Next up</span><h3 style="font-size:24px">${esc(nx.name)} ${esc(nx.dose)}</h3><span class="muted">${fmt12(nx.time)}</span></div><div class="countdown" data-ts="${nx.ts}"></div>${isC ? `<button class="btn coral" data-act="nudge">Send a nudge</button>` : `<button class="btn" data-act="take" data-m="${nx.medId}" data-t="${nx.time}" data-d="${nx.date}">${ico('check')} Take now</button>`}</section>` : ''}
  <section class="card"><div class="sp"><h3>Today's schedule</h3><button class="btn ghost sm" data-act="demodose">${ico('bolt')} Add a test dose in 1 minute</button></div>
  ${d.items.length ? d.items.map(it => doseRow(it, isC)).join('') : `<div class="empty">${ico('pill')}<h3>Nothing scheduled</h3><p class="muted">Add a medicine and MedMate will handle the reminders.</p><button class="btn" data-act="addmed">${ico('plus')} Add a medicine</button></div>`}</section>
  <section class="card tip">${ico('sparkle')}<div><b>Tip of the day</b><br><span class="muted">${esc(pick(TIPS))}</span></div></section>`;
};
function levelUp(l) { confetti(innerWidth / 2, innerHeight / 2, 170); chime([523, 659, 784, 1047]); modal(`<div class="tc"><svg viewBox="0 0 120 120" style="width:96px;animation:swing 4s infinite"><use href="#logo"/></svg><h2>Level ${l}!</h2><p class="muted">Your care game is strong. Keep it up.</p><button class="btn" data-act="close">Onward</button></div>`); }
acts.take = async b => {
  const r = await api('/dose', { body: B({ medId: b.dataset.m, time: b.dataset.t, date: b.dataset.d, status: 'taken' }) }), rc = b.getBoundingClientRect();
  confetti(rc.left + rc.width / 2, rc.top, 60); chime([660, 880, 1320]); toast(`${esc(pick(CHEERS))} <b>+${r.xp} XP</b>`);
  if (r.leveledUp) levelUp(r.level);
  await show(S.page, true);
  if (S.page === 'today' && S.user.role === 'patient') { const d = await api('/today'); if (d.total && d.taken === d.total) { confetti(innerWidth / 2, innerHeight / 3, 140); say('All done for today. You are a legend!', S.user.lang); } }
};
acts.skip = async b => { await api('/dose', { body: B({ medId: b.dataset.m, time: b.dataset.t, date: b.dataset.d, status: 'skipped' }) }); toast('Skipped. Tell your doctor if you skip often.'); show(S.page, true); };
acts.snooze = async b => { await api('/dose', { body: B({ medId: b.dataset.m, time: b.dataset.t, date: b.dataset.d, status: 'snoozed', minutes: 10 }) }); toast('Snoozed for 10 minutes. I will be back, like a polite alarm clock.'); show(S.page, true); };
acts.nudge = async b => { await api('/nudge', { body: { patientId: b.dataset.id || S.pid } }); toast('Nudge sent. Gentle but firm.'); };
acts.demodose = async () => { const t = new Date(Date.now() + 60000), hh = `${p2(t.getHours())}:${p2(t.getMinutes())}`; await api('/meds', { body: B({ name: 'Demo Vitamin', dose: '1 tab', times: [hh], stock: 10, color: '#D88B79' }) }); toast(`Test dose set for ${fmt12(hh)}. Watch the countdown!`); show('today'); };

// ------------------------------------------------------------ Medicines
const medCard = m => { const pct = Math.min(100, Math.round(m.daysLeft / 30 * 100)); return `<article class="card med tilt" style="--c:${m.color}"><div class="sp"><h3>${esc(m.name)}</h3><span class="chip">${esc(m.dose || m.form)}</span></div><div class="times">${m.times.map(t => `<span class="chip">${ico('clock')} ${fmt12(t)}</span>`).join('')}</div><div><div class="sp"><small class="muted">${m.stock} left</small><small><b>${m.daysLeft >= 99 ? '' : 'about ' + m.daysLeft + (m.daysLeft === 1 ? ' day' : ' days')}</b></small></div><div class="stock ${m.daysLeft <= 3 ? 'low' : ''}"><i style="width:${pct}%"></i></div></div>${m.notes ? `<small class="muted">${esc(m.notes)}</small>` : ''}<div class="row" style="gap:8px"><button class="btn ghost sm" data-act="editmed" data-id="${m.id}">${ico('edit')} Edit</button><button class="btn ghost sm" data-act="refill" data-id="${m.id}">${ico('plus')} Refill</button><button class="btn ghost sm" data-act="delmed" data-id="${m.id}" aria-label="Delete ${esc(m.name)}">${ico('trash')}</button></div></article>`; };
PAGES.meds = async () => {
  const d = await api(P('/meds')); S.meds = d.meds;
  return `<div class="sp"><p class="muted" style="margin:0">${d.meds.length} active medicine${d.meds.length === 1 ? '' : 's'}</p><div class="row" style="flex:none"><button class="btn ghost" data-act="scan">${ico('scan')} Scan prescription</button><button class="btn" data-act="addmed">${ico('plus')} Add medicine</button></div></div>
  <div class="gap">${d.interactions.map(i => `<div class="warn">${ico('alert')}<div><b>${esc(i.a)} and ${esc(i.b)}</b><br><span>${esc(i.note)} Please check with a doctor or pharmacist.</span></div></div>`).join('')}</div>
  <div class="grid3">${d.meds.map(medCard).join('') || `<div class="card empty" style="grid-column:1/-1">${ico('pill')}<h3>Your pill box is empty</h3><p class="muted">Add your first medicine to start the reminders.</p></div>`}</div>`;
};
const timeInput = t => `<span class="t"><input type="time" value="${t}" required><button type="button" class="btn ghost sm round" data-act="rmtime" aria-label="Remove this time" style="width:34px;height:34px">${ico('x')}</button></span>`;
function medForm(m = {}) {
  const times = m.times && m.times.length ? m.times : ['08:00'], days = m.days || [];
  return `<h2>${m.id ? 'Edit' : 'Add'} medicine</h2><form data-form="med" data-id="${m.id || ''}"><div class="field"><label for="mn">Name</label><input id="mn" name="name" list="drugs" value="${esc(m.name || '')}" required><datalist id="drugs">${DRUGS.map(d => `<option value="${d}">`).join('')}</datalist></div>
  <div class="row"><div class="field"><label>Dose</label><input name="dose" placeholder="5 mg" value="${esc(m.dose || '')}"></div><div class="field"><label>Form</label><select name="form">${['tablet', 'capsule', 'syrup', 'injection', 'drops', 'inhaler'].map(f => `<option ${m.form === f ? 'selected' : ''}>${f}</option>`).join('')}</select></div></div>
  <div class="field"><label>Times</label><div class="timelist" id="tl">${times.map(timeInput).join('')}<button type="button" class="btn ghost sm" data-act="addtime">${ico('plus')} Add time</button></div></div>
  <div class="field"><label>Days (leave empty for every day)</label><div class="days">${'SMTWTFS'.split('').map((d, i) => `<label><input type="checkbox" name="days" value="${i}" ${days.includes(i) ? 'checked' : ''}><span>${d}</span></label>`).join('')}</div></div>
  <div class="row"><div class="field"><label>Pills in stock</label><input name="stock" type="number" min="0" value="${m.stock ?? 30}"></div><div class="field"><label>Pills per dose</label><input name="perDose" type="number" min="1" value="${m.perDose || 1}"></div></div>
  <div class="field"><label>Colour</label><div class="swatches">${COLORS.map(c => `<label><input type="radio" name="color" value="${c}" ${(m.color || COLORS[0]) === c ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('')}</div></div>
  <div class="field"><label>Notes</label><input name="notes" placeholder="With food, no grapefruit..." value="${esc(m.notes || '')}"></div><p class="err"></p><div class="row"><button type="button" class="btn ghost" data-act="close">Cancel</button><button class="btn">Save medicine</button></div></form>`;
}
acts.addmed = () => modal(medForm());
acts.editmed = b => modal(medForm(S.meds.find(m => m.id === b.dataset.id)));
acts.addtime = b => b.insertAdjacentHTML('beforebegin', timeInput('12:00'));
acts.rmtime = b => { if ($$('#tl .t').length > 1) b.closest('.t').remove(); };
forms.med = async f => {
  const fd = new FormData(f), id = f.dataset.id;
  const body = B({ name: fd.get('name'), dose: fd.get('dose'), form: fd.get('form'), times: $$('#tl input[type=time]', f).map(i => i.value), days: fd.getAll('days').map(Number), stock: fd.get('stock'), perDose: fd.get('perDose'), color: fd.get('color'), notes: fd.get('notes') });
  await api(id ? '/meds/' + id : '/meds', { method: id ? 'PUT' : 'POST', body }); closeModal(); toast(id ? 'Medicine updated.' : 'Medicine added. Your pill box has a new roommate.'); show('meds');
};
acts.refill = async b => { const q = await ask('Refill stock', 'How many pills did you add?', 30); if (q === null) return; await api(`/meds/${b.dataset.id}/refill`, { body: B({ qty: q }) }); toast('Stock topped up. Pharmacy mission complete.'); show('meds'); };
acts.delmed = async b => { if (!(await confirmM('Remove this medicine from the schedule?'))) return; await api(`/meds/${b.dataset.id}`, { method: 'DELETE', body: B({}) }); toast('Removed. History is kept for your report.'); show('meds'); };
acts.scan = () => {
  const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*';
  i.onchange = async () => {
    const f = i.files[0]; if (!f) return; toast('Reading your prescription...');
    const url = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
    try {
      const j = await api('/scan', { body: { image: url } }); S.scan = j.medicines || [];
      modal(`<h2>Found ${S.scan.length} medicine${S.scan.length === 1 ? '' : 's'}</h2>${S.scan.map((m, k) => `<div class="vt"><span><b>${esc(m.name)}</b> ${esc(m.dose || '')}<br><small class="muted">${(m.times || []).map(fmt12).join(', ')} ${esc(m.notes || '')}</small></span><button class="btn sm" data-act="addscan" data-k="${k}">Add</button></div>`).join('') || '<p class="muted">Nothing readable. Try a brighter, closer photo.</p>'}<div class="row gap"><button class="btn ghost" data-act="close">Done</button></div>`);
    } catch (e) { toast(esc(e.message), 'bad', 7000); }
  };
  i.click();
};
acts.addscan = async b => { const m = S.scan[+b.dataset.k]; await api('/meds', { body: B({ name: m.name, dose: m.dose, times: m.times && m.times.length ? m.times : ['08:00'], notes: m.notes, stock: 30 }) }); b.textContent = 'Added'; b.disabled = true; toast(`${esc(m.name)} added.`); };

// ------------------------------------------------------------ Insights
PAGES.insights = async () => {
  const s = await api(P('/stats')), maxE = Math.max(1, ...s.week.map(w => w.exp));
  const tile = (v, l, suf = '') => `<div class="card tilt"><div class="big"><span data-count="${v}">0</span>${suf}</div><span class="muted">${l}</span></div>`;
  return `<div class="grid3">${tile(s.adh7, 'adherence this week', '%')}${tile(s.adh28, 'adherence over 4 weeks', '%')}<div class="card tilt"><div class="big">${ico('flame', 'flame')} <span data-count="${s.streak}">0</span></div><span class="muted">day streak (best ${s.best})</span></div></div>
  <div class="grid2 gap"><section class="card"><h3>This week</h3><div class="bars gap">${s.week.map((w, i) => `<div class="col"><div class="b" style="--i:${i};--h:${Math.max(12, w.exp / maxE * 100)}%;--t:${w.exp ? w.taken / w.exp * 100 : 0}%" title="${w.taken} of ${w.exp} doses"><i></i></div><small class="muted">${w.label}</small></div>`).join('')}</div></section>
  <section class="card"><h3>Last 4 weeks</h3><div class="heat gap">${s.heat.map((h, i) => `<i style="--i:${i};${h.pct == null ? '' : `background:rgba(167,31,19,${(.15 + h.pct / 100 * .85).toFixed(2)})`}" title="${h.date}: ${h.pct == null ? 'no doses' : h.pct + '%'}"></i>`).join('')}</div><small class="muted">Darker means more doses taken.</small></section></div>
  <div class="grid2 gap"><section class="card"><h3>When you shine</h3><div class="tod gap">${s.buckets.map(b => `<div><span>${b.name}</span><span class="tr"><i style="width:${b.pct || 0}%"></i></span><b>${b.pct == null ? '-' : b.pct + '%'}</b></div>`).join('')}</div></section>
  <section class="card"><h3>Level ${s.level}</h3><p class="muted">${s.xp} XP in total. ${100 - s.into} XP to the next level.</p><div class="stock gap"><i style="width:${s.into}%"></i></div><p class="muted">${s.totalTaken} doses taken so far.</p></section></div>
  ${s.suggestions.length ? `<section class="card gap"><h3>Smart timing suggestions</h3>${s.suggestions.map(x => `<div class="vt"><span>You usually take <b>${esc(x.name)}</b> about ${Math.abs(x.avg)} min ${x.avg > 0 ? 'after' : 'before'} ${fmt12(x.time)}. Move the reminder to <b>${fmt12(x.suggested)}</b>?</span><button class="btn sm" data-act="applysug" data-id="${x.medId}" data-old="${x.time}" data-new="${x.suggested}">Apply</button></div>`).join('')}</section>` : ''}
  <section class="card gap"><h3>Badges</h3><div class="badges gap">${s.badges.map(b => `<div class="badge ${b.on ? '' : 'off'}">${ico(b.on ? 'sparkle' : 'clock')}<b>${esc(b.name)}</b><small>${esc(b.desc)}</small></div>`).join('')}</div></section>`;
};
acts.applysug = async b => { const { meds } = await api(P('/meds')), m = meds.find(x => x.id === b.dataset.id); await api('/meds/' + m.id, { method: 'PUT', body: B({ times: m.times.map(t => t === b.dataset.old ? b.dataset.new : t) }) }); toast('Reminder moved. Smart, right?'); show('insights'); };

// ------------------------------------------------------------ Smart box
PAGES.box = async () => {
  const [md, td] = await Promise.all([api(P('/meds')), api(P('/today'))]);
  const meds = md.meds.slice().sort((a, b) => a.createdAt - b.createdAt).slice(0, 4);
  const slots = [0, 1, 2, 3].map(i => {
    const m = meds[i]; if (!m) return `<div class="slot"><span class="led"></span><div class="in"><b>Empty</b><small>Add a medicine</small></div></div>`;
    const its = td.items.filter(x => x.medId === m.id), due = its.some(x => x.status === 'due'), allDone = its.length && its.every(x => x.status === 'taken');
    return `<div class="slot ${due ? 'buzz' : ''}" id="slot${i}"><span class="led ${due ? 'amber' : allDone ? 'green' : ''}"></span><div class="in"><b>${esc(m.name)}</b><small>${esc(m.dose)}${due ? ', due now' : ''}</small></div><button class="lid" data-act="lid" data-slot="${i + 1}">Tap to open</button></div>`;
  }).join('');
  return `<section class="card"><div class="sp"><div><h3>Your virtual smart box</h3><p class="muted" style="margin:0">Open a lid like you would on the real box. MedMate notices and logs the dose.</p></div><span class="chip" id="boxmsg">Waiting for a lid</span></div><div class="boxwrap gap"><div class="box3d">${slots}</div></div></section>
  <section class="card gap"><h3>Connect the real ESP32 box</h3><p class="muted">Each lid sensor sends one request when it opens. The box is identified by the patient code <b>${esc(pcode() || '')}</b>. A ready sketch is in the <code>esp32</code> folder.</p><pre>POST ${location.origin}/api/device/event
Content-Type: application/json

{ "code": "${esc(pcode() || '')}", "slot": 1 }</pre><p class="muted">The reply tells the box what to show: <code>led: green</code> (logged), <code>amber</code> (not time yet) or <code>red</code> (empty slot).</p></section>`;
};
acts.lid = async b => {
  const slot = $(`#slot${b.dataset.slot - 1}`); slot.classList.add('open'); slot.classList.remove('buzz');
  const r = await fetch('/api/device/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: pcode(), slot: +b.dataset.slot }) }).then(x => x.json());
  $('.led', slot).className = 'led ' + (r.led || ''); $('#boxmsg').textContent = r.msg;
  if (r.matched) { const rc = slot.getBoundingClientRect(); confetti(rc.left + rc.width / 2, rc.top, 70); chime([660, 880, 1320]); } else chime([300]);
  toast(esc(r.msg), r.matched ? 'ok' : 'bad'); setTimeout(() => slot.classList.remove('open'), 3200); setTimeout(() => S.page === 'box' && show('box', true), 3800);
};

// ------------------------------------------------------------ Health
function lineChart(series, colors) {
  const all = series.flat(); if (all.length < 2) return '<p class="muted">Log a couple of readings to see the trend.</p>';
  const mn = Math.min(...all) - 8, mx = Math.max(...all) + 8, W = 400, H = 190, n = Math.max(...series.map(s => s.length)), X = i => 20 + i * (W - 40) / Math.max(1, n - 1), Y = v => H - 20 - (v - mn) / (mx - mn) * (H - 40);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Trend chart">${series.map((s, k) => `<path d="${s.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ')}" stroke="${colors[k]}"/>${s.map((v, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3.5" fill="${colors[k]}"/>`).join('')}`).join('')}</svg>`;
}
const VN = { bp: 'Blood pressure', sugar: 'Blood sugar', weight: 'Weight', pulse: 'Pulse', mood: 'Mood' };
PAGES.health = async () => {
  const { vitals } = await api(P('/vitals')), bp = vitals.filter(v => v.type === 'bp').slice(-10), sg = vitals.filter(v => v.type === 'sugar').slice(-10);
  return `<div class="grid2"><section class="card"><h3>Log a reading</h3><form data-form="vital" class="gap"><div class="field"><label for="vt">What are you logging?</label><select name="type" id="vt"><option value="bp">Blood pressure</option><option value="sugar">Blood sugar (mg/dL)</option><option value="weight">Weight (kg)</option><option value="pulse">Pulse (bpm)</option><option value="mood">Mood (1 to 5)</option></select></div><div class="row"><div class="field"><label id="l1" for="v1">Systolic (top)</label><input id="v1" name="value" type="number" step="any" required></div><div class="field" id="v2f"><label for="v2">Diastolic (bottom)</label><input id="v2" name="value2" type="number"></div></div><p class="err"></p><button class="btn">Save reading</button></form></section>
  <section class="card"><h3>Blood pressure trend</h3>${lineChart([bp.map(v => v.value), bp.map(v => v.value2)], ['#A71F13', '#D88B79'])}<small class="muted">Red is the top number, coral the bottom.</small></section></div>
  <div class="grid2 gap"><section class="card"><h3>Blood sugar trend</h3>${lineChart([sg.map(v => v.value)], ['#A71F13'])}</section><section class="card"><h3>Recent readings</h3>${vitals.slice().reverse().slice(0, 8).map(v => `<div class="vt"><span><b>${VN[v.type]}</b><br><small class="muted">${new Date(v.at).toLocaleString()}</small></span><span><b>${v.value}${v.value2 ? '/' + v.value2 : ''}</b> <span class="flag ${v.flag}">${v.flag}</span></span></div>`).join('') || '<p class="muted">No readings yet.</p>'}</section></div>`;
};
forms.vital = async f => { const d = Object.fromEntries(new FormData(f)); const r = await api('/vitals', { body: B(d) }); toast(r.vital.flag === 'ok' ? 'Logged. Looking good!' : `Logged. That looks ${r.vital.flag}. Your care circle has been told.`, r.vital.flag === 'ok' ? 'ok' : 'bad'); show('health'); };

// ------------------------------------------------------------ Care circle, alerts, SOS
const alertRow = a => `<div class="alert ${a.type === 'sos' ? 'sos' : ''} ${a.read ? '' : 'unread'}">${ico(a.type === 'sos' ? 'alert' : a.type === 'missed' ? 'clock' : a.type === 'refill' ? 'pill' : 'bell')}<div><b>${esc(a.msg)}</b><br><small class="muted">${new Date(a.at).toLocaleString()}</small></div></div>`;
PAGES.circle = async () => {
  const [c, a] = await Promise.all([api('/circle'), api('/alerts')]); S.unread = a.unread; updateDot();
  const alerts = `<section class="card gap"><div class="sp"><h3>Alerts</h3><button class="btn ghost sm" data-act="readall">Mark all read</button></div>${a.alerts.map(alertRow).join('') || '<p class="muted">Quiet so far. No news is good news.</p>'}</section>`;
  if (S.user.role === 'patient') return `<div class="grid2"><section class="card tc tilt"><span class="muted">Your care code</span><div class="code">${esc(c.code)}</div><p class="muted">Share this with family. They enter it in a MedMate caregiver account to follow your doses live.</p><button class="btn ghost" data-act="copycode" data-c="${esc(c.code)}">Copy code</button></section><section class="card"><h3>Your care circle</h3>${c.caregivers.length ? c.caregivers.map(x => `<div class="vt"><span>${esc(x.name)}</span><span class="chip">${ico('check')} Linked</span></div>`).join('') : '<p class="muted">No caregivers yet. Share your code to add one.</p>'}<button class="btn gap" data-act="sos">${ico('alert')} Send SOS</button></section></div>${alerts}`;
  return `<section class="card"><h3>Link a patient</h3><form data-form="link" class="row gap"><input name="code" placeholder="Patient code, like MM-DEMO" aria-label="Patient code" required><button class="btn" style="flex:none">Link</button></form><p class="err"></p></section>
  <div class="grid3 gap">${c.patients.map(p => `<article class="card pcard tilt"><div class="sp"><h3>${esc(p.name)}</h3>${p.due ? '<span class="chip due">Due now</span>' : p.missed ? `<span class="chip missed">${p.missed} missed</span>` : '<span class="chip taken">On track</span>'}</div><div class="mini"><i style="width:${p.total ? p.taken / p.total * 100 : 0}%"></i></div><small class="muted">${p.taken} of ${p.total} doses today, ${p.streak}-day streak</small><div class="row" style="gap:8px"><button class="btn sm" data-act="viewp" data-id="${p.id}">Open</button><button class="btn coral sm" data-act="nudge" data-id="${p.id}">Nudge</button></div></article>`).join('')}</div>${alerts}`;
};
forms.link = async f => { const j = await api('/link', { body: Object.fromEntries(new FormData(f)) }); S.user = j.user; const me = await api('/me'); S.patients = me.patients; S.pid = j.patient.id; localStorage.setItem('mm_pid', S.pid); toast(`Linked to ${esc(j.patient.name)}.`); renderShell(); show('circle'); };
acts.viewp = b => { S.pid = b.dataset.id; localStorage.setItem('mm_pid', S.pid); renderShell(); show('today'); };
acts.copycode = async b => { try { await navigator.clipboard.writeText(b.dataset.c); toast('Code copied.'); } catch { toast('Copy it by hand: ' + esc(b.dataset.c)); } };
acts.readall = async () => { await api('/alerts/read', { body: {} }); S.unread = 0; updateDot(); show('circle', true); };
const updateDot = () => { const d = $('#dot'); if (d) { d.hidden = !S.unread; d.textContent = S.unread; } };
async function loadAlerts() { try { const a = await api('/alerts'); S.unread = a.unread; updateDot(); } catch {} }
acts.bell = async () => { const a = await api('/alerts'); modal(`<h2>Alerts</h2>${a.alerts.slice(0, 12).map(alertRow).join('') || '<p class="muted">Nothing new. Enjoy the calm.</p>'}<div class="row gap"><button class="btn ghost" data-act="close">Close</button></div>`); await api('/alerts/read', { body: {} }); S.unread = 0; updateDot(); };
acts.sos = async () => { if (!(await confirmM('Send an SOS to your whole care circle?'))) return; await api('/sos', { body: {} }); toast('SOS sent. Stay calm, your circle has been alerted.', 'bad', 8000); say('S O S sent. Help is on the way.', S.user.lang); };
function sosModal(d) { chime([880, 660, 880, 660]); modal(`<div class="sheet-inner">${ico('alert')}<h2>${esc(d.msg || 'SOS')}</h2><p>Please call or check in right now.</p><button class="btn dark" data-act="close">I am on it</button></div>`, 'sos'); say(d.msg, S.user.lang); }

// ------------------------------------------------------------ Report + settings
PAGES.report = async () => {
  const r = await api(P('/report')), s = r.stats;
  return `<div class="sp noprint"><p class="muted" style="margin:0">A clean summary to show your doctor.</p><button class="btn" data-act="print">${ico('file')} Print or save as PDF</button></div>
  <section class="card gap"><div class="brand"><svg viewBox="0 0 120 120"><use href="#logo"/></svg><span>Med<i>Mate</i></span></div><h2 style="margin-top:12px">${esc(r.patient.name)}</h2><p class="muted">Generated ${esc(r.generated)}</p><div class="grid3"><div><div class="big">${s.adh7}%</div><span class="muted">7-day adherence</span></div><div><div class="big">${s.adh28}%</div><span class="muted">28-day adherence</span></div><div><div class="big">${s.streak}</div><span class="muted">day streak</span></div></div></section>
  <section class="card gap"><h3>Current medicines</h3>${r.meds.map(m => `<div class="vt"><span><b>${esc(m.name)}</b> ${esc(m.dose)}</span><span>${m.times.map(fmt12).join(', ')}</span></div>`).join('') || '<p class="muted">None.</p>'}</section>
  ${r.interactions.length ? `<section class="card gap"><h3>Interaction notes</h3>${r.interactions.map(i => `<div class="vt"><span><b>${esc(i.a)} + ${esc(i.b)}</b><br><small class="muted">${esc(i.note)}</small></span></div>`).join('')}</section>` : ''}
  <section class="card gap"><h3>Missed doses, last 14 days</h3>${r.missed.map(m => `<div class="vt"><span>${esc(m.name || 'Medicine')}</span><span class="muted">${m.date} at ${fmt12(m.time)}</span></div>`).join('') || '<p class="muted">No missed doses. Impressive.</p>'}</section>
  <section class="card gap"><h3>Recent readings</h3>${r.vitals.map(v => `<div class="vt"><span>${VN[v.type]}</span><span><b>${v.value}${v.value2 ? '/' + v.value2 : ''}</b> <span class="muted">${new Date(v.at).toLocaleDateString()}</span></span></div>`).join('') || '<p class="muted">None logged.</p>'}</section>
  <p class="muted gap"><small>MedMate is a companion app and does not replace medical advice.</small></p>`;
};
acts.print = () => print();
PAGES.settings = async () => {
  const u = S.user;
  return `<section class="card" style="max-width:640px"><form data-form="settings"><div class="field"><label>Your name</label><input name="name" value="${esc(u.name)}"></div><div class="field"><label>Minutes before a dose counts as missed</label><input name="grace" type="number" min="1" max="180" value="${u.grace}"><small class="muted">For a quick demo, set this to 1 or 2 and watch the missed-dose alert fire.</small></div><div class="field"><label>Reminder voice language</label><select name="lang">${LANGS.filter(l => l[0] !== 'auto').map(l => `<option value="${l[0]}" ${u.lang === l[0] ? 'selected' : ''}>${l[1]}</option>`).join('')}</select></div><p class="err"></p><button class="btn">Save settings</button></form></section>
  <section class="card gap" style="max-width:640px"><h3>On this device</h3><div class="row gap" style="gap:10px"><button class="btn ghost" data-act="togspeak">${ico('volume')} Voice replies: ${S.speak ? 'on' : 'off'}</button><button class="btn ghost" data-act="togsound">${ico('bell')} Sounds: ${S.sound ? 'on' : 'off'}</button><button class="btn ghost" data-act="notif">${ico('bell')} Enable notifications</button></div><p class="muted gap">Assistant engine: <b>${S.cfg.ai ? 'Claude, every language' : 'built-in (English, Hindi, Telugu, Spanish replies)'}</b>${S.cfg.ai ? '' : '. Add ANTHROPIC_API_KEY to your .env file for every language and prescription scanning.'}</p></section>`;
};
forms.settings = async f => { const j = await api('/settings', { method: 'PUT', body: Object.fromEntries(new FormData(f)) }); S.user = j.user; toast('Saved.'); show('settings'); };
acts.togspeak = () => { S.speak = !S.speak; localStorage.setItem('mm_speak', S.speak ? '1' : '0'); show('settings'); };
acts.togsound = () => { S.sound = !S.sound; localStorage.setItem('mm_sound', S.sound ? '1' : '0'); show('settings'); };
acts.notif = async () => { if (!('Notification' in window)) return toast('This browser has no notifications.', 'bad'); const p = await Notification.requestPermission(); toast(p === 'granted' ? 'Notifications are on.' : 'Notifications are blocked in your browser settings.', p === 'granted' ? 'ok' : 'bad'); };

// ------------------------------------------------------------ voice assistant
function addMsg(t, who) { const d = document.createElement('div'); d.className = 'msg ' + who; d.textContent = t; $('#msgs').appendChild(d); $('#msgs').scrollTop = 1e9; return d; }
const typeOut = (el, txt) => new Promise(r => { let i = 0; const iv = setInterval(() => { el.textContent = txt.slice(0, ++i); $('#msgs').scrollTop = 1e9; if (i >= txt.length) { clearInterval(iv); r(); } }, Math.max(8, Math.min(25, 900 / Math.max(1, txt.length)))); });
acts.va = () => {
  const v = $('#va'); v.classList.toggle('open');
  if (v.classList.contains('open') && !$('#msgs').children.length) { addMsg(`Hi ${S.user.name.split(' ')[0]}! I'm MedMate. Talk or type to me in any language.${S.cfg.ai ? '' : ' (Built-in mode: I reply in English, Hindi, Telugu and Spanish. Add an API key to unlock every language.)'}`, 'bot'); }
  if (v.classList.contains('open')) setTimeout(() => $('#vi').focus(), 100);
};
async function sendToAssistant(text) {
  addMsg(text, 'me'); const ty = addMsg('', 'bot typing'); ty.innerHTML = '<i></i><i></i><i></i>';
  try {
    const r = await api('/assistant', { body: B({ text, lang: S.vlang === 'auto' ? navigator.language : S.vlang, history: S.chat.slice(-8) }) });
    S.chat.push({ role: 'user', content: text }); ty.remove(); const m = addMsg('', 'bot'); await typeOut(m, r.reply); S.chat.push({ role: 'assistant', content: r.reply });
    say(r.reply, r.lang); handleActions(r.actions || []);
  } catch (e) { ty.remove(); addMsg(e.message, 'bot'); }
}
function handleActions(acs) {
  let refresh = false;
  acs.forEach(a => {
    if (a.type === 'navigate' && PAGES[a.page]) show(a.page);
    else if (a.type === 'take' && a.ok !== false) { confetti(innerWidth - 120, innerHeight - 160, 70); chime([660, 880, 1320]); refresh = true; }
    else if (a.type === 'sos') { toast('SOS sent to your care circle.', 'bad', 8000); refresh = true; }
    else if (['add_med', 'vital', 'snooze'].includes(a.type)) refresh = true;
  });
  if (refresh && !acs.some(a => a.type === 'navigate')) show(S.page, true);
}
acts.vsend = () => { const i = $('#vi'), t = i.value.trim(); if (!t) return; i.value = ''; sendToAssistant(t); };
acts.chip = b => sendToAssistant(b.dataset.q);
let rec = null;
acts.mic = () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast('Voice input needs Chrome, Edge or Safari. You can still type in any language.', 'bad');
  if (rec) { rec.stop(); return; }
  if (window.speechSynthesis) speechSynthesis.cancel();
  rec = new SR(); rec.lang = S.vlang === 'auto' ? navigator.language : S.vlang; rec.interimResults = true; let fin = '';
  $('#mic').classList.add('live');
  rec.onresult = e => { let t = ''; for (const r of e.results) t += r[0].transcript; $('#vi').value = t; fin = t; };
  rec.onerror = e => toast(`Mic problem: ${esc(e.error)}. Check the permission and the language.`, 'bad');
  rec.onend = () => { $('#mic').classList.remove('live'); rec = null; if (fin.trim()) { $('#vi').value = ''; sendToAssistant(fin.trim()); } };
  rec.start();
};

// ------------------------------------------------------------ live events
function connectEvents() {
  if (S.es) S.es.close();
  const es = new EventSource('/api/events?token=' + S.token); S.es = es;
  const refresh = () => { if ($('.modal') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return; if (['today', 'circle', 'insights', 'box'].includes(S.page)) show(S.page, true); };
  const on = (n, f) => es.addEventListener(n, e => f(JSON.parse(e.data)));
  on('due', d => { chime(); const mine = S.user.role === 'patient'; toast(`${ico('pill')} <b>${mine ? 'Time for ' : esc(d.patient) + ' is due for '}${esc(d.name)}</b><br>${esc(d.dose || '')} at ${fmt12(d.time)}`); if (mine) { say(`Time for your ${d.name}`, S.user.lang); notify('Time for ' + d.name, d.dose || 'Tap to log it.'); } refresh(); });
  on('missed', d => { chime([300, 240]); toast(`${esc(S.user.role === 'patient' ? 'You' : d.patient)} missed <b>${esc(d.name)}</b> (${fmt12(d.time)}).`, 'bad', 7000); notify('Missed dose', d.name); refresh(); });
  on('taken', d => { if (S.user.role === 'caregiver') toast(`${esc(d.patient)} took <b>${esc(d.name)}</b>${d.via === 'box' ? ' (via the smart box)' : ''}.`); refresh(); });
  on('skipped', refresh); on('snooze', refresh);
  on('box', d => toast(esc(d.msg), 'bad'));
  on('sos', d => sosModal(d));
  on('alert', () => { S.unread++; updateDot(); const b = $('#bell'); if (b) { b.classList.remove('ring'); void b.offsetWidth; b.classList.add('ring'); } });
  on('nudge', d => { chime(); toast(`${ico('bell')} <b>${esc(d.from)}</b> sends a gentle nudge: take your medicine!`); say(`${d.from} says: please take your medicine.`, S.user.lang); });
}
boot();
