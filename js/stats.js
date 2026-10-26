// Reading insights: daily time, streaks, speed. Daily totals live in IndexedDB (kv: "daily").
import { kvGet, kvSet } from './db.js';
import { books, wpmOf, hasMeasuredSpeed, timeLeftSec } from './store.js';
import { settings, set } from './settings.js';
import { h, icon, dayKey, fmtDuration, fmtNum, debounce, clamp } from './util.js';

let daily = {};          // 'YYYY-MM-DD' -> { sec, words }
let loaded = false;
let hostCurrent = () => null;

export const initStats = (getCurrent) => { hostCurrent = getCurrent; };

export async function loadStats() {
  try { daily = (await kvGet('daily', {})) || {}; } catch { daily = {}; }
  loaded = true;
}
const persist = debounce(() => { kvSet('daily', daily).catch(() => {}); }, 4000);
export const flushStats = () => persist.flush();

export function addDay(sec, words = 0) {
  const k = dayKey();
  const d = daily[k] || (daily[k] = { sec: 0, words: 0 });
  d.sec += sec; d.words += words;
  persist();
}

export const todaySec = () => daily[dayKey()]?.sec || 0;

function streaks() {
  const ok = (k) => (daily[k]?.sec || 0) >= 60;
  const day = new Date(); day.setHours(12, 0, 0, 0);
  let cur = 0;
  const probe = new Date(day);
  if (!ok(dayKey(probe))) probe.setDate(probe.getDate() - 1);   // today may not be read yet
  while (ok(dayKey(probe))) { cur++; probe.setDate(probe.getDate() - 1); }
  let best = 0, run = 0;
  const keys = Object.keys(daily).filter(ok).sort();
  let prev = null;
  for (const k of keys) {
    const d = new Date(`${k}T12:00:00`);
    run = prev && Math.round((d - prev) / 86400000) === 1 ? run + 1 : 1;
    best = Math.max(best, run); prev = d;
  }
  return { cur, best: Math.max(best, cur) };
}

function lastDays(n) {
  const out = [];
  const d = new Date(); d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - (n - 1));
  for (let i = 0; i < n; i++) { const k = dayKey(d); out.push({ k, date: new Date(d), sec: daily[k]?.sec || 0 }); d.setDate(d.getDate() + 1); }
  return out;
}

function ring(fraction, label, sub) {
  const r = 46, c = 2 * Math.PI * r;
  const f = clamp(fraction, 0, 1);
  const wrap = h('div', { class: 'ring' });
  wrap.innerHTML = `<svg viewBox="0 0 110 110" aria-hidden="true"><circle cx="55" cy="55" r="${r}" class="ring-bg"/><circle cx="55" cy="55" r="${r}" class="ring-fg" stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 55 55)"/></svg>`;
  wrap.append(h('div', { class: 'ring-text' }, h('strong', null, label), h('span', null, sub)));
  return wrap;
}

function bars(days, goalMin) {
  const max = Math.max(goalMin * 60, ...days.map((d) => d.sec), 1);
  const W = 336, H = 96, gap = 6, bw = (W - gap * (days.length - 1)) / days.length;
  const goalY = H - (goalMin * 60 / max) * (H - 6);
  let svg = `<svg viewBox="0 0 ${W} ${H + 18}" role="img" aria-label="Minutes read in the last ${days.length} days">`;
  svg += `<line x1="0" x2="${W}" y1="${goalY.toFixed(1)}" y2="${goalY.toFixed(1)}" class="goal-line"/>`;
  days.forEach((d, i) => {
    const bh = d.sec ? Math.max(3, (d.sec / max) * (H - 6)) : 2;
    const x = i * (bw + gap);
    const met = d.sec >= goalMin * 60;
    svg += `<rect x="${x.toFixed(1)}" y="${(H - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" class="${met ? 'bx met' : 'bx'}"><title>${d.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: ${Math.round(d.sec / 60)} min</title></rect>`;
    if (i % 2 === (days.length - 1) % 2) svg += `<text x="${(x + bw / 2).toFixed(1)}" y="${H + 14}" text-anchor="middle" class="bar-label">${d.date.toLocaleDateString(undefined, { weekday: 'narrow' })}</text>`;
  });
  svg += '</svg>';
  const el = h('div', { class: 'bars' });
  el.innerHTML = svg;
  return el;
}

function stat(label, value, sub) {
  return h('div', { class: 'stat' }, h('div', { class: 'stat-v' }, value), h('div', { class: 'stat-l' }, label), sub ? h('div', { class: 'stat-s' }, sub) : null);
}

export function openStats() {
  const dlg = document.getElementById('stats-dlg');
  const render = () => {
    const goal = settings.goal;
    const today = todaySec();
    const st = streaks();
    const days = lastDays(14);
    const week = days.slice(-7).reduce((n, d) => n + d.sec, 0);
    const totalSec = [...books.values()].reduce((n, b) => n + (b.stats?.sec || 0), 0);
    const finished = [...books.values()].filter((b) => b.finished).length;
    const measured = [...books.values()].filter(hasMeasuredSpeed);
    const wpm = measured.length ? Math.round(measured.reduce((n, b) => n + wpmOf(b), 0) / measured.length) : null;
    const cur = hostCurrent();

    const body = [];
    body.push(h('div', { class: 'stats-head' },
      h('h2', null, 'Reading insights'),
      h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => dlg.close() }, icon('x'))));

    body.push(h('div', { class: 'stats-top' },
      ring(today / (goal * 60), `${Math.floor(today / 60)}`, `of ${goal} min today`),
      h('div', { class: 'stats-side' },
        h('div', { class: 'streak' }, icon('flame'), h('strong', null, `${st.cur}`), h('span', null, st.cur === 1 ? 'day streak' : 'day streak')),
        h('div', { class: 'muted small' }, st.best > st.cur ? `Best: ${st.best} days` : st.cur ? 'Your longest so far' : 'Read for a minute to start a streak'),
        h('div', { class: 'goal-ctl' },
          h('span', { class: 'muted small' }, 'Daily goal'),
          h('button', { class: 'icon-btn sm', 'aria-label': 'Lower goal', onclick: () => { set({ goal: Math.max(5, goal - 5) }); render(); } }, icon('minus')),
          h('strong', null, `${goal} min`),
          h('button', { class: 'icon-btn sm', 'aria-label': 'Raise goal', onclick: () => { set({ goal: Math.min(240, goal + 5) }); render(); } }, icon('plus'))))));

    body.push(h('div', { class: 'stats-card' }, h('div', { class: 'sc-title' }, 'Last 14 days'), bars(days, goal)));

    body.push(h('div', { class: 'stat-grid' },
      stat('This week', fmtDuration(week)),
      stat('All time', fmtDuration(totalSec)),
      stat('Books finished', String(finished)),
      stat('Average speed', wpm ? `${wpm} wpm` : '–', wpm ? null : 'Needs a few minutes of reading')));

    if (cur) {
      const b = cur.book;
      const sess = cur.session;
      body.push(h('div', { class: 'stats-card' },
        h('div', { class: 'sc-title' }, 'This book'),
        h('div', { class: 'stat-grid tight' },
          stat('Progress', `${Math.round((b.pct || 0) * 100)}%`, cur.where),
          stat('Time left', b.words ? fmtDuration(timeLeftSec(b)) : '–', b.words ? `at ${wpmOf(b)} wpm${hasMeasuredSpeed(b) ? '' : ' (estimate)'}` : null),
          stat('Read so far', fmtDuration(b.stats?.sec || 0)),
          stat('This session', fmtDuration(sess.sec), sess.words > 0 && sess.sec > 30 ? `${fmtNum(sess.words)} words` : null))));
    }

    const top = [...books.values()].filter((b) => b.stats?.sec > 0).sort((a, b) => b.stats.sec - a.stats.sec).slice(0, 5);
    if (top.length) {
      body.push(h('div', { class: 'stats-card' },
        h('div', { class: 'sc-title' }, 'Most read'),
        h('ul', { class: 'top-books' }, top.map((b) => h('li', null, h('span', { class: 'tb-title' }, b.title), h('span', { class: 'muted' }, fmtDuration(b.stats.sec)))))));
    }
    dlg.replaceChildren(...body);
  };
  render();
  if (!dlg.open) dlg.showModal();
}

export const statsLoaded = () => loaded;
