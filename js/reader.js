// The reader: reflowed text (scrolling or paged), original PDF pages, progress, speed and auto-bookmark.
import { settings, set, onSettings } from './settings.js';
import { THEMES, resolveTheme } from './themes.js';
import { books, putBook, mirrorPosition, wpmOf, hasMeasuredSpeed, setStatus, statusOf, statusLabel } from './store.js';
import { openShelfMenu } from './library.js';
import { dbGet, dbPut } from './db.js';
import { openPdf } from './pdf.js';
import { extractBook } from './extract.js';
import * as annot from './annot.js';
import * as panel from './panel.js';
import * as tts from './tts.js';
import { addDay, flushStats, openStats } from './stats.js';
import { toast, showMenu, openDrawer, infoDialog, confirmDialog } from './ui.js';
import { openAppearance } from './appearance.js';
import { openKeys } from './keys.js';
import { h, icon, setIcon, clamp, nextFrame, fmtDuration, debounce, wordCount, readJSON, writeJSON, fmtNum } from './util.js';

const D = {};
let S = null;
const TYPO = ['font', 'size', 'lh', 'para', 'ls', 'ws', 'width', 'align', 'hyphens', 'indent', 'dropcap', 'weight', 'spread'];
const GAP = 48;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export const isOpen = () => !!S;
export const current = () => (S ? { book: S.book, session: S.session, where: whereText() } : null);

/* ================================================================== index */
function buildIndex() {
  const chs = S.chs;
  S.cum = []; S.chStart = [];
  let t = 0;
  chs.forEach((ch) => {
    const a = new Float64Array(ch.blocks.length + 1);
    let s = 0;
    ch.blocks.forEach((b, i) => { a[i] = s; s += wordCount(b.t); });
    a[ch.blocks.length] = s;
    S.cum.push(a); S.chStart.push(t); t += s;
  });
  S.total = t;
  S.pageMap = new Array(S.book.pages + 2).fill(null);
  chs.forEach((ch, c) => ch.blocks.forEach((b, i) => { if (b.pg && !S.pageMap[b.pg]) S.pageMap[b.pg] = { c, b: i, f: 0 }; }));
  let last = { c: 0, b: 0, f: 0 };
  for (let p = 1; p <= S.book.pages; p++) { if (S.pageMap[p]) last = S.pageMap[p]; else S.pageMap[p] = last; }
}
const blockWords = (c, b) => S.cum[c][b + 1] - S.cum[c][b];
function wordOf(pos) {
  const ch = S.chs[pos.c];
  if (!ch) return 0;
  if (pos.b < 0) return S.chStart[pos.c];
  const b = Math.min(pos.b, ch.blocks.length - 1);
  return S.chStart[pos.c] + S.cum[pos.c][b] + (pos.f || 0) * blockWords(pos.c, b);
}
function posOfWord(w) {
  w = clamp(w, 0, S.total);
  let lo = 0, hi = S.chs.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (S.chStart[m] <= w) lo = m; else hi = m - 1; }
  const c = lo, a = S.cum[c], n = S.chs[c].blocks.length;
  const local = w - S.chStart[c];
  let l = 0, r = n - 1;
  while (l < r) { const m = (l + r + 1) >> 1; if (a[m] <= local) l = m; else r = m - 1; }
  const bw = a[l + 1] - a[l];
  return { c, b: l, f: bw ? clamp((local - a[l]) / bw, 0, 1) : 0 };
}
const pageOfPos = (pos) => S.chs[pos.c]?.blocks[Math.max(0, pos.b)]?.pg || S.chs[pos.c]?.pg || 1;
const blockText = (c, b) => S.chs[c]?.blocks[b]?.t || '';

/* ============================================================== rendering */
function paint(el, block, c, i) {
  const hls = annot.highlightsFor(c, i);
  const find = S.find && S.find.c === c && S.find.b === i ? S.find : null;
  if (!hls && !find) { el.textContent = block.t; return; }
  const ranges = (hls || []).map((x) => ({ s: x.s, e: x.e, cls: `hl hl-${x.color}${x.note ? ' has-note' : ''}`, id: x.id }));
  if (find) ranges.push({ s: find.s, e: find.e, cls: 'find' });
  ranges.sort((a, b) => a.s - b.s);
  const text = block.t, frag = document.createDocumentFragment();
  let at = 0;
  for (const r of ranges) {
    if (r.s < at) continue;
    if (r.s > at) frag.append(text.slice(at, r.s));
    const m = document.createElement('mark');
    m.className = r.cls;
    if (r.id) m.dataset.hl = r.id;
    m.textContent = text.slice(r.s, r.e);
    frag.append(m);
    at = r.e;
  }
  if (at < text.length) frag.append(text.slice(at));
  el.replaceChildren(frag);
}

function blockEl(block, c, i) {
  const tag = block.k === 'h' ? `h${Math.min(6, 2 + (block.l || 1))}` : 'p';
  const e = document.createElement(tag);
  e.dataset.c = c; e.dataset.b = i;
  if (block.k === 'n') e.className = 'note';
  if (S.speaking && S.speaking.c === c && S.speaking.b === i) e.classList.add('speaking');
  paint(e, block, c, i);
  return e;
}

function chapHead(ch, c) {
  const quiet = S.book.source === 'chunks';
  const head = h('header', { class: `chap-head${quiet ? ' quiet' : ''}`, dataset: { c, b: -1 } }, h('h2', null, ch.title));
  return head;
}

function buildChapter(c, parent, grouped) {
  const ch = S.chs[c];
  const els = [];
  S.els[c] = els;
  let grp = null;
  const newGroup = () => { grp = document.createElement('div'); grp.className = 'grp'; parent.append(grp); S.groups.push(grp); };
  const head = chapHead(ch, c);
  S.heads[c] = head;
  if (grouped) { newGroup(); grp.append(head); } else parent.append(head);
  ch.blocks.forEach((b, i) => {
    if (grouped && grp.childElementCount >= 14) newGroup();
    const e = blockEl(b, c, i);
    els.push(e);
    (grouped ? grp : parent).append(e);
  });
}

function renderScroll() {
  S.els = []; S.heads = []; S.groups = [];
  const frag = document.createDocumentFragment();
  S.chs.forEach((_, c) => buildChapter(c, frag, true));
  D.text.replaceChildren(frag);
  S.pagedC = -1;
}

function renderPagedChapter(c) {
  S.els = []; S.heads = []; S.groups = [];
  const frag = document.createDocumentFragment();
  buildChapter(c, frag, false);
  D.text.replaceChildren(frag);
  S.pagedC = c;
  layoutPaged();
}

function repaintBlock(c, i) {
  const el = S.els?.[c]?.[i];
  if (el) paint(el, S.chs[c].blocks[i], c, i);
}

/* ============================================================ scroll mode */
const readingLine = () => Math.round(Math.min(150, D.scroller.clientHeight * 0.24));

function locateScroll() {
  const sc = D.scroller;
  const sr = sc.getBoundingClientRect();
  if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4 && sc.scrollTop > 0) {
    const c = S.chs.length - 1, b = S.chs[c].blocks.length - 1;
    return { c, b, f: 1 };
  }
  const y = sr.top + readingLine();
  const g = S.groups;
  let lo = 0, hi = g.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (g[m].getBoundingClientRect().top <= y) lo = m; else hi = m - 1; }
  let best = null;
  for (const e of g[lo].children) {
    const r = e.getBoundingClientRect();
    if (r.width === 0) break;
    if (r.top <= y) best = e; else break;
  }
  if (!best) best = g[lo].firstElementChild;
  const r = best.getBoundingClientRect();
  const c = +best.dataset.c, b = +best.dataset.b;
  if (b < 0) return { c, b: 0, f: 0 };
  return { c, b, f: clamp((y - r.top) / Math.max(1, r.height), 0, 1) };
}

async function scrollToPos(pos) {
  if (pos.b === 0 && !(pos.f > 0)) pos = { ...pos, b: -1 };   // top of a chapter: show its heading too
  const el = pos.b < 0 ? S.heads[pos.c] : S.els[pos.c]?.[pos.b];
  if (!el) return;
  const sc = D.scroller;
  S.programmatic = true;
  try {
    for (let i = 0; i < 5; i++) {
      const sr = sc.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (r.width === 0) {   // inside a skipped (off-screen) group: scroll to the group first so it renders
        const gr = el.closest('.grp').getBoundingClientRect();
        sc.scrollTop += gr.top - sr.top - readingLine();
        await nextFrame();
        continue;
      }
      const target = pos.b < 0 ? 72 : readingLine();
      const delta = r.top - sr.top + (pos.b < 0 ? 0 : (pos.f || 0) * r.height) - target;
      if (Math.abs(delta) < 2) break;
      const before = sc.scrollTop;
      sc.scrollTop += delta;
      if (sc.scrollTop === before) break;
      await nextFrame();
    }
  } finally { S.programmatic = false; }
}

/* ============================================================== paged mode */
function colsNow() {
  const w = D.scroller.clientWidth;
  return settings.spread === 'double' || (settings.spread === 'auto' && w >= 1100) ? 2 : 1;
}

function layoutPaged() {
  const sc = D.scroller;
  const cs = getComputedStyle(sc);
  const cols = colsNow();
  D.wrap.dataset.cols = cols;
  const W = D.wrap.clientWidth;
  const fs = parseFloat(getComputedStyle(D.text).fontSize) || 20;
  const lhpx = fs * settings.lh;
  const avail = sc.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const H = Math.max(lhpx * 6, Math.floor(avail / lhpx) * lhpx);
  Object.assign(D.text.style, { width: `${W}px`, height: `${H}px`, columnCount: String(cols), columnGap: `${GAP}px`, columnFill: 'auto' });
  S.step = W + GAP;
  S.pages = Math.max(1, Math.round((D.text.scrollWidth + GAP) / S.step));
  S.page = clamp(S.page || 0, 0, S.pages - 1);
  D.text.style.transform = `translate3d(${-S.page * S.step}px,0,0)`;
}

function pageOfEl(el, f = 0) {
  const rects = [...el.getClientRects()];
  if (!rects.length) return 0;
  const art = D.text.getBoundingClientRect();
  const r = rects[Math.min(rects.length - 1, Math.floor((f || 0) * rects.length))];
  return clamp(Math.floor((r.left - art.left + 2) / S.step), 0, S.pages - 1);
}

function showPage(p, { instant = false } = {}) {
  S.page = clamp(p, 0, S.pages - 1);
  D.text.classList.toggle('anim', !instant && !reduceMotion());
  D.text.style.transform = `translate3d(${-S.page * S.step}px,0,0)`;
  pagedTrack();
}

function pagedTrack() {
  const c = S.pagedC;
  const art = D.text.getBoundingClientRect();
  const x0 = S.page * S.step;
  const list = [S.heads[c], ...S.els[c]];
  let pos = null;
  outer: for (const el of list) {
    const rs = [...el.getClientRects()];
    for (let k = 0; k < rs.length; k++) {
      const x = rs[k].left - art.left;
      if (x >= x0 - 2 && x < x0 + S.step - GAP - 2) {
        pos = el === S.heads[c] ? { c, b: 0, f: 0 } : { c, b: +el.dataset.b, f: k / rs.length };
        break outer;
      }
    }
  }
  if (!pos) pos = { c, b: 0, f: 0 };
  if (S.page === S.pages - 1 && c === S.chs.length - 1) pos = { c, b: S.chs[c].blocks.length - 1, f: 1 };
  updatePosition(pos);
}

async function pagedGoTo(pos) {
  if (S.pagedC !== pos.c || !D.text.childElementCount) { S.page = 0; renderPagedChapter(pos.c); } else layoutPaged();
  const el = pos.b < 0 ? S.heads[pos.c] : S.els[pos.c][pos.b];
  showPage(el ? pageOfEl(el, pos.f) : 0, { instant: true });
}

function nextPage() {
  if (S.page < S.pages - 1) return showPage(S.page + 1);
  if (S.pagedC < S.chs.length - 1) { S.page = 0; renderPagedChapter(S.pagedC + 1); showPage(0, { instant: true }); return; }
  toast('You reached the end of the book');
}
function prevPage() {
  if (S.page > 0) return showPage(S.page - 1);
  if (S.pagedC > 0) { renderPagedChapter(S.pagedC - 1); showPage(S.pages - 1, { instant: true }); }
}

/* ============================================================ original pages */
async function ensurePdf() {
  if (S.pdf) return S.pdf;
  const row = await dbGet('files', S.book.id);
  if (!row) throw new Error('The PDF file is missing from this browser.');
  S.pdf = await openPdf(await row.blob.arrayBuffer());
  return S.pdf;
}

const origWidth = () => Math.max(220, Math.round(Math.min(D.orig.clientWidth - 24, 980) * settings.pdfZoom / 100));

async function renderOrig() {
  const pdf = await ensurePdf();
  if (!S.vp1) { const p = await pdf.getPage(1); S.vp1 = p.getViewport({ scale: 1 }); p.cleanup(); }
  buildOrigPages();
}

function buildOrigPages() {
  S.io?.disconnect();
  const w = origWidth();
  S.origW = w;
  const hgt = Math.round((w * S.vp1.height) / S.vp1.width);
  const frag = document.createDocumentFragment();
  S.pgEls = [];
  for (let n = 1; n <= S.book.pages; n++) {
    const el = h('div', { class: 'pg', dataset: { n }, style: { width: `${w}px`, height: `${hgt}px` } });
    S.pgEls.push(el); frag.append(el);
  }
  D.orig.replaceChildren(frag);
  S.io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) renderOrigPage(e.target); else releaseOrigPage(e.target);
    }
  }, { root: D.orig, rootMargin: '120% 0px' });
  S.pgEls.forEach((el) => S.io.observe(el));
}

async function renderOrigPage(el) {
  if (el._state) return;
  el._state = 'busy';
  const my = S;
  try {
    const page = await S.pdf.getPage(+el.dataset.n);
    if (S !== my || el._state !== 'busy') { page.cleanup(); return; }
    const vp1 = page.getViewport({ scale: 1 });
    const scale = S.origW / vp1.width;
    const vp = page.getViewport({ scale });
    el.style.height = `${Math.round(vp.height)}px`;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width * dpr); canvas.height = Math.floor(vp.height * dpr);
    const task = page.render({ canvas, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null, background: '#ffffff' });
    el._task = task;
    await task.promise;
    if (S !== my || el._state !== 'busy') return;
    el.replaceChildren(canvas);
    el._state = 'done';
    page.cleanup();
  } catch (e) {
    if (e?.name !== 'RenderingCancelledException') console.warn('page render failed', e);
    el._state = null;
  } finally { el._task = null; }
}
function releaseOrigPage(el) {
  if (el._task) { try { el._task.cancel(); } catch { /* ignore */ } }
  if (el._state) { el._state = null; el.replaceChildren(); }
}

function locateOrig() {
  const sr = D.orig.getBoundingClientRect();
  const y = sr.top + Math.min(120, D.orig.clientHeight * 0.2);
  const g = S.pgEls;
  let lo = 0, hi = g.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (g[m].getBoundingClientRect().top <= y) lo = m; else hi = m - 1; }
  const r = g[lo].getBoundingClientRect();
  return { n: lo + 1, f: clamp((y - r.top) / Math.max(1, r.height), 0, 1) };
}

function origGoPage(n, f = 0) {
  n = clamp(Math.round(n) || 1, 1, S.book.pages);
  const el = S.pgEls[n - 1];
  const sr = D.orig.getBoundingClientRect(), r = el.getBoundingClientRect();
  S.programmatic = true;
  D.orig.scrollTop += r.top - sr.top - Math.min(120, D.orig.clientHeight * 0.2) + f * r.height;
  requestAnimationFrame(() => { S.programmatic = false; trackNow(); });
}

/* ============================================================== position */
function trackNow() {
  if (!S || !S.ready) return;
  if (S.mode === 'orig') {
    const { n, f } = locateOrig();
    S.origPage = n;
    if (S.textless) { S.pos = { c: 0, b: 0, f: 0 }; S.wordPos = 0; commit((n - 1 + f) / S.book.pages, n); return; }
    updatePosition({ ...S.pageMap[n] }, n, (n - 1 + f) / S.book.pages);
  } else if (S.layout === 'paged') pagedTrack();
  else updatePosition(locateScroll());
}

function updatePosition(pos, page, pctOverride) {
  S.pos = pos;
  S.wordPos = wordOf(pos);
  commit(pctOverride ?? (S.total ? S.wordPos / S.total : 0), page ?? pageOfPos(pos));
}

function commit(pct, page) {
  const b = S.book;
  b.pct = clamp(pct, 0, 1);
  b.pos = { c: S.pos.c, b: S.pos.b, f: +(S.pos.f || 0).toFixed(4) };
  b.page = page;
  b.lastRead = Date.now();
  b.posTs = b.lastRead;
  mirrorPosition(b);
  if (b.status && b.status !== 'reading' && b.status !== 'completed') b.status = 'reading';   // picking a book up again moves it to Reading
  if (b.pct >= 0.985 && !b.finished) { b.finished = Date.now(); b.status = 'completed'; toast(`You finished “${b.title}”.`, { timeout: 5000 }); }
  S.dirty = true;
  saveSoon();
  scheduleInfo();
}
const saveSoon = debounce(() => { if (S?.dirty) { S.dirty = false; putBook(S.book).catch(() => {}); } }, 900);

/* ================================================================== info */
let infoQueued = false;
const scheduleInfo = () => { if (infoQueued) return; infoQueued = true; requestAnimationFrame(() => { infoQueued = false; if (S) updateInfo(); }); };
const noun = () => (S.book.source === 'chunks' ? 'Section' : 'Chapter');

function whereText() {
  const b = S.book;
  if (S.textless || !S.chs.length) return `Page ${b.page || 1} of ${b.pages}`;
  const total = S.chs.length;
  return total > 1 ? `${noun()} ${S.pos.c + 1} of ${total} · page ${b.page} of ${b.pages}` : `Page ${b.page} of ${b.pages}`;
}

function leftText() {
  const b = S.book, mode = S.leftMode;
  if (!S.total || S.textless) return `${Math.max(0, b.pages - (b.page || 1))} pages left`;
  const wpm = wpmOf(b);
  if (mode === 'pages') return `${Math.max(0, b.pages - b.page)} pages left`;
  if (mode === 'chapter' && S.chs.length > 1) {
    const rest = S.chStart[S.pos.c] + S.cum[S.pos.c][S.chs[S.pos.c].blocks.length] - S.wordPos;
    return `${fmtDuration((Math.max(0, rest) / wpm) * 60)} left in ${noun().toLowerCase()}`;
  }
  return `${fmtDuration((Math.max(0, S.total - S.wordPos) / wpm) * 60)} left in book`;
}

function updateInfo() {
  const b = S.book;
  const pct = Math.round(b.pct * 100);
  if (!S.scrubbing) { D.pct.textContent = `${pct}%`; D.scrub.value = Math.round(b.pct * 1000); D.scrub.setAttribute('aria-valuetext', `${pct}%`); D.scrub.style.setProperty('--pf', String(b.pct)); }
  D.where.textContent = whereText();
  D.left.textContent = leftText();
  D.left.title = hasMeasuredSpeed(b) ? `Your pace: ${wpmOf(b)} words a minute. Click to change what is shown.` : 'Estimated at an average pace until Folio learns yours. Click to change what is shown.';
  D.chap.textContent = S.textless ? '' : (S.chs[S.pos.c]?.title || '');
  const marked = annot.hasBookmarkAt(S.pos.c, S.pos.b);
  D.mark.classList.toggle('on', marked);
  D.mark.setAttribute('aria-pressed', String(marked));
}

function buildTicks() {
  D.ticks.replaceChildren();
  if (S.textless || !S.total || S.chs.length < 2 || S.chs.length > 250) return;
  const frag = document.createDocumentFragment();
  S.chs.forEach((_, c) => { if (c) frag.append(h('i', { style: { left: `${(S.chStart[c] / S.total) * 100}%` } })); });
  D.ticks.append(frag);
}

/* ================================================================ navigation */
export async function goTo(pos, { flash = false, find = null } = {}) {
  if (!S) return;
  if (S.mode === 'orig') { origGoPage(pageOfPos(pos)); return; }
  const prevFind = S.find;
  S.find = find ? { c: find.c, b: find.b, s: find.s, e: find.e } : null;
  if (prevFind) repaintBlock(prevFind.c, prevFind.b);
  if (S.find) repaintBlock(S.find.c, S.find.b);
  if (S.layout === 'paged') await pagedGoTo(pos); else await scrollToPos(pos);
  trackNow();
  if (flash || find) {
    const el = S.els[pos.c]?.[pos.b];
    if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 2200); }
  }
  if (find) setTimeout(() => { if (S?.find === null) return; const f = S.find; S.find = null; if (f) repaintBlock(f.c, f.b); }, 6000);
}

export function goChapter(c) { goTo({ c: clamp(c, 0, S.chs.length - 1), b: -1, f: 0 }); }
export function goPage(n) {
  if (!S) return;
  if (S.mode === 'orig') origGoPage(n);
  else goTo({ ...S.pageMap[clamp(Math.round(n) || 1, 1, S.book.pages)] });
}
function stepChapter(dir) {
  if (S.textless) return;
  const c = S.pos.c;
  // "previous" first returns to the top of the current chapter when you are well into it
  if (dir < 0 && (S.pos.b > 1 || S.pos.f > 0.2) && S.wordPos - S.chStart[c] > 30) return goChapter(c);
  goChapter(c + dir);
}
function jumpToPct(p) {
  if (S.textless || S.mode === 'orig' && !S.total) return origGoPage(Math.round(p * (S.book.pages - 1)) + 1);
  if (S.mode === 'orig') return origGoPage(pageOfPos(posOfWord(p * S.total)));
  goTo(posOfWord(p * S.total));
}

/* ================================================================ chrome */
function showChrome() { D.view.dataset.chrome = 'shown'; }
function hideChrome() { if (S?.layout === 'paged' && S.mode === 'reflow' && D.view.dataset.chrome !== 'shown') return; D.view.dataset.chrome = 'hidden'; }
function toggleChrome() { D.view.dataset.chrome = D.view.dataset.chrome === 'hidden' ? 'shown' : 'hidden'; }

function onScroll() {
  if (!S || !S.ready) return;
  S.lastActive = performance.now();
  if (S.programmatic) return;
  const sc = S.mode === 'orig' ? D.orig : D.scroller;
  const top = sc.scrollTop, dy = top - (S.lastTop ?? top);
  S.lastTop = top;
  if (Math.abs(dy) > 14) { if (dy > 0 && top > 140) { hideChrome(); } else if (dy < 0) showChrome(); }
  if (top < 40) showChrome();
  if (!S.raf) S.raf = requestAnimationFrame(() => { S.raf = 0; if (S && !S.programmatic) trackNow(); });
}

/* ============================================================== mode switch */
async function enterMode(mode, pos) {
  S.mode = mode;
  S.layout = settings.layout;
  D.view.dataset.rmode = mode;
  D.scroller.hidden = mode !== 'reflow';
  D.orig.hidden = mode !== 'orig';
  setIcon(D.modeBtn.querySelector('svg'), mode === 'reflow' ? 'page' : 'reflow');
  D.modeBtn.title = mode === 'reflow' ? 'Original pages (O)' : 'Reading view (O)';
  D.modeBtn.setAttribute('aria-label', mode === 'reflow' ? 'Show original pages' : 'Show reading view');
  D.listen.disabled = false;
  if (mode === 'reflow') {
    D.view.dataset.layout = S.layout;
    D.text.style.cssText = '';
    if (S.layout === 'paged') { S.page = 0; renderPagedChapter(pos.c); } else renderScroll();
    await nextFrame();
    await goTo(pos);
  } else {
    S.layout = 'scroll';
    await renderOrig();
    await nextFrame();
    if (S.textless) origGoPage(S.book.page || 1, 0); else origGoPage(pageOfPos(pos));
    await nextFrame();
  }
  S.book.mode = mode;
  updateRuler();
  trackNow();
}

async function toggleMode() {
  if (!S) return;
  if (S.textless) { toast('This PDF is a scan, so there is no text to reflow. Original pages are the only view.'); return; }
  const pos = S.mode === 'orig' ? { ...S.pageMap[S.origPage || S.book.page || 1] } : { ...S.pos };
  S.ready = false;
  await enterMode(S.mode === 'reflow' ? 'orig' : 'reflow', pos);
  S.ready = true;
  trackNow();
}

async function relayout() {
  if (!S || !S.ready || S.mode !== 'reflow') return;
  const pos = { ...S.pos };
  S.programmatic = true;
  if (S.layout === 'paged') { layoutPaged(); await pagedGoTo(pos); } else { await nextFrame(); await scrollToPos(pos); }
  S.programmatic = false;
  trackNow();
}
const relayoutSoon = debounce(relayout, 70);

async function switchLayout() {
  if (!S || S.mode !== 'reflow' || S.layout === settings.layout) return;
  S.ready = false;
  await enterMode('reflow', { ...S.pos });
  S.ready = true;
}

function updateRuler() {
  D.ruler.hidden = !(settings.ruler && S && S.mode === 'reflow');
}

/* ================================================================== open/close */
const showLoading = (on, text = 'Opening…') => { D.loading.hidden = !on; D.loading.querySelector('span').textContent = text; };

async function rebuildContent(book) {
  showLoading(true, 'Preparing text…');
  const row = await dbGet('files', book.id);
  if (!row) throw new Error('missing');
  const pdf = await openPdf(await row.blob.arrayBuffer());
  const content = await extractBook(pdf, { onProgress: (p) => { D.loading.querySelector('span').textContent = `Preparing text… ${Math.round(p * 100)}%`; } });
  const rec = { id: book.id, chapters: content.chapters, source: content.source, words: content.words, pages: content.pages, hasText: content.hasText };
  await dbPut('content', rec);
  pdf.destroy();
  return rec;
}

export async function openBook(id) {
  await closeBook();
  const book = books.get(id);
  if (!book) { location.hash = '#/'; toast('That book is no longer in your library.'); return; }
  showLoading(true);
  let content;
  try { content = await dbGet('content', id); } catch { content = null; }
  try { if (!content) content = await rebuildContent(book); } catch {
    showLoading(false); location.hash = '#/'; toast('This book could not be opened. Try adding the PDF again.'); return;
  }
  S = {
    book, chs: content.chapters, pdf: null, mode: null, layout: settings.layout, pos: { ...(book.pos || { c: 0, b: 0, f: 0 }) },
    wordPos: 0, lastWord: null, lastActive: performance.now(), session: { sec: 0, words: 0 }, dirty: false, ready: false,
    find: null, speaking: null, els: [], heads: [], groups: [], pagedC: -1, page: 0, pages: 1, step: 1,
    leftMode: readJSON('folio:leftMode', 'book'), textless: !book.hasText, programmatic: false,
  };
  book.stats = book.stats || { sec: 0, rSec: 0, rWords: 0 };
  buildIndex();
  if (S.pos.c >= S.chs.length) S.pos = { c: 0, b: 0, f: 0 };
  if (S.chs[S.pos.c] && S.pos.b >= S.chs[S.pos.c].blocks.length) S.pos.b = Math.max(0, S.chs[S.pos.c].blocks.length - 1);
  await annot.loadAnnot(id);
  panel.resetQuery();

  D.book.textContent = book.title;
  D.scrub.disabled = false;
  D.notext.hidden = true;
  buildTicks();
  document.title = `${book.title} · Folio`;

  let mode = S.textless ? 'orig' : (book.mode === 'orig' ? 'orig' : 'reflow');
  try {
    await enterMode(mode, S.pos);
  } catch (e) {
    console.error(e);
    if (mode === 'orig') { showLoading(false); location.hash = '#/'; toast(e.message || 'Could not open the original pages.'); S = null; return; }
    mode = 'orig'; await enterMode('orig', S.pos);
  }
  S.wordPos = S.textless ? 0 : wordOf(S.pos);
  S.lastWord = S.wordPos;
  S.ready = true;
  showLoading(false);
  showChrome();
  updateInfo();
  if (S.textless) {
    D.notext.hidden = false;
    D.notext.replaceChildren(h('p', null, 'This PDF is a scan (images of pages), so there is no text to reflow. You are seeing the original pages.'), h('button', { class: 'btn', onclick: () => { D.notext.hidden = true; } }, 'Got it'));
  }
  (S.mode === 'orig' ? D.orig : D.scroller).focus({ preventScroll: true });
}

export async function closeBook() {
  if (!S) return;
  const s = S;
  tts.stop();
  s.ready = false;
  try { trackNowSafe(s); } catch { /* ignore */ }
  s.dirty = false;
  saveSoon.cancel?.();
  try { await putBook(s.book); } catch { /* ignore */ }
  flushStats();
  annot.unloadAnnot();
  s.io?.disconnect();
  S = null;
  try { s.pdf?.destroy(); } catch { /* ignore */ }
  D.text.replaceChildren(); D.text.style.cssText = ''; D.orig.replaceChildren();
  document.title = 'Folio · a calm PDF reader';
}
function trackNowSafe(s) { const keep = S; S = s; s.ready = true; try { trackNow(); } finally { S = keep; } }

/* =================================================================== menus */
function openMore() {
  if (!S) return;
  const b = S.book;
  showMenu([
    { label: 'Search in book', icon: 'search', onClick: () => panel.openPanel('find') },
    { label: 'Bookmark this spot', icon: 'bookmark', onClick: toggleBookmarkHere },
    { label: tts.isActive() ? 'Stop reading aloud' : 'Read aloud', icon: 'headphones', onClick: () => tts.start() },
    'sep',
    { label: S.mode === 'reflow' ? 'Show original pages' : 'Show reading view', icon: S.mode === 'reflow' ? 'page' : 'reflow', onClick: toggleMode, disabled: S.textless },
    { label: document.fullscreenElement ? 'Exit full screen' : 'Full screen', icon: 'expand', onClick: toggleFullscreen },
    { label: 'Reading insights', icon: 'chart', onClick: openStats },
    'sep',
    { label: `Shelf: ${statusLabel(statusOf(b))}`, icon: 'list', onClick: () => setTimeout(() => openShelfMenu(b, D.more), 0) },
    b.finished ? { label: 'Mark as unread', icon: 'reset', onClick: () => { setStatus(b, 'reading'); toast('Moved to Reading'); } }
      : { label: 'Mark as finished', icon: 'check', onClick: () => { setStatus(b, 'completed'); toast('Moved to Completed'); } },
    { label: 'Book details', icon: 'book', onClick: showDetails },
    { label: 'Keyboard shortcuts', icon: 'keyboard', onClick: openKeys },
    'sep',
    { label: 'Back to library', icon: 'arrow-left', onClick: () => { location.hash = '#/'; } },
  ], D.more);
}

function showDetails() {
  const b = S.book;
  infoDialog({
    title: b.title,
    rows: [
      b.author ? ['Author', b.author] : null,
      ['Pages', fmtNum(b.pages)],
      b.words ? ['Length', `${fmtNum(b.words)} words`] : null,
      b.hasText ? [S.book.source === 'chunks' ? 'Sections' : 'Chapters', `${S.chs.length}${b.source === 'outline' ? ' (from the PDF’s contents)' : b.source === 'headings' ? ' (found from headings)' : ' (even sections, no chapter markers found)'}`] : null,
      b.words ? ['Reading speed', `${wpmOf(b)} words a minute${hasMeasuredSpeed(b) ? '' : ' (estimate)'}`] : null,
      ['Time reading', fmtDuration(b.stats?.sec || 0)],
      ['Added', new Date(b.added).toLocaleDateString(undefined, { dateStyle: 'medium' })],
      ['File', `${b.fileName || ''} · ${(b.size / 1e6).toFixed(1)} MB`],
    ].filter(Boolean),
  });
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => toast('Full screen is not available here.'));
}

function toggleBookmarkHere() {
  if (!S) return;
  if (S.textless) { toast('Bookmarks need text, and this PDF is a scan. Folio still remembers your page.'); return; }
  const pos = S.mode === 'orig' ? { ...S.pageMap[S.origPage || 1] } : S.pos;
  const text = blockText(pos.c, pos.b);
  const added = annot.toggleBookmark(pos, { pct: S.total ? wordOf(pos) / S.total : 0, label: text.length > 80 ? `${text.slice(0, 80)}…` : text, chapter: S.chs[pos.c]?.title });
  toast(added ? 'Bookmark added' : 'Bookmark removed', { timeout: 1800 });
  updateInfo();
}

/* ============================================================== keyboard */
export function handleKey(e) {
  if (!S || !S.ready) return false;
  const k = e.key;
  const paged = S.mode === 'reflow' && S.layout === 'paged';
  const sc = S.mode === 'orig' ? D.orig : D.scroller;
  const page = () => sc.clientHeight * 0.88;
  S.lastActive = performance.now();
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  switch (k) {
    case 'ArrowRight': if (paged) { nextPage(); return true; } return false;
    case 'ArrowLeft': if (paged) { prevPage(); return true; } return false;
    case 'PageDown': case ' ':
      if (e.shiftKey && k === ' ') { if (paged) prevPage(); else sc.scrollBy({ top: -page(), behavior: reduceMotion() ? 'auto' : 'smooth' }); return true; }
      if (paged) nextPage(); else sc.scrollBy({ top: page(), behavior: reduceMotion() ? 'auto' : 'smooth' });
      return true;
    case 'PageUp': if (paged) prevPage(); else sc.scrollBy({ top: -page(), behavior: reduceMotion() ? 'auto' : 'smooth' }); return true;
    case 'ArrowDown': case 'j': if (paged) { nextPage(); } else sc.scrollBy({ top: 90 }); return true;
    case 'ArrowUp': case 'k': if (paged) { prevPage(); } else sc.scrollBy({ top: -90 }); return true;
    case 'Home': if (e.shiftKey) return false; jumpToPct(0); return true;
    case 'End': jumpToPct(1); return true;
    case '[': stepChapter(-1); return true;
    case ']': stepChapter(1); return true;
    case 'c': panel.openPanel('toc'); return true;
    case '/': panel.openPanel('find'); return true;
    case 'n': panel.openPanel('marks'); return true;
    case 'b': toggleBookmarkHere(); return true;
    case 'l': tts.start(); return true;
    case 'i': openStats(); return true;
    case 'a': openAppearance(); return true;
    case 'o': toggleMode(); return true;
    case 'f': toggleFullscreen(); return true;
    case 'h': toggleChrome(); return true;
    case '+': case '=': set({ size: clamp(settings.size + 1, 14, 40) }); return true;
    case '-': case '_': set({ size: clamp(settings.size - 1, 14, 40) }); return true;
    case 't': {
      const cur = resolveTheme(settings.theme).id;
      const i = THEMES.findIndex((t) => t.id === cur);
      set({ theme: THEMES[(i + 1) % THEMES.length].id });
      toast(`Theme: ${resolveTheme(settings.theme).name}`, { timeout: 1500 });
      return true;
    }
    case '?': openKeys(); return true;
    default: return false;
  }
}

/* ================================================================ ticking */
function tick() {
  if (!S || !S.ready || document.hidden) return;
  const active = performance.now() - S.lastActive < 60000 || tts.isPlaying();
  if (!active) { S.lastWord = S.wordPos; return; }
  const st = S.book.stats;
  st.sec++; S.session.sec++;
  let words = 0;
  if (!S.textless) {
    const d = S.wordPos - (S.lastWord ?? S.wordPos);
    S.lastWord = S.wordPos;
    if (d >= 0 && d < 15) { words = d; st.rSec++; st.rWords += d; S.session.words += d; }
  }
  addDay(1, words);
  S.dirty = true;
  if (S.session.sec % 5 === 0) { saveSoon(); updateInfo(); }
}

/* ==================================================================== init */
export function initReader() {
  const g = (id) => document.getElementById(id);
  Object.assign(D, {
    view: g('view-reader'), stage: g('r-stage'), scroller: g('scroller'), wrap: g('pagedwrap'), text: g('text'), orig: g('orig'),
    loading: g('r-loading'), notext: g('r-notext'), book: g('r-book'), chap: g('r-chap'), pct: g('r-pct'), where: g('r-where'),
    left: g('r-left'), scrub: g('scrub'), ticks: g('scrub-ticks'), ruler: g('ruler'), modeBtn: g('r-mode'), mark: g('r-mark'),
    more: g('r-more'), listen: g('r-listen'),
  });

  g('r-back').addEventListener('click', () => { location.hash = '#/'; });
  D.modeBtn.addEventListener('click', toggleMode);
  g('r-search').addEventListener('click', () => panel.openPanel('find'));
  g('r-toc').addEventListener('click', () => panel.openPanel('toc'));
  D.mark.addEventListener('click', toggleBookmarkHere);
  D.listen.addEventListener('click', () => tts.start());
  g('r-stats').addEventListener('click', openStats);
  g('r-appearance').addEventListener('click', openAppearance);
  D.more.addEventListener('click', openMore);
  D.left.addEventListener('click', () => {
    const order = ['book', 'chapter', 'pages'];
    S.leftMode = order[(order.indexOf(S.leftMode) + 1) % order.length];
    writeJSON('folio:leftMode', S.leftMode);
    updateInfo();
  });

  // scrubber
  const jump = debounce(() => { if (S) jumpToPct(D.scrub.value / 1000); }, 120);
  D.scrub.addEventListener('input', () => {
    if (!S) return;
    S.scrubbing = true;
    const p = D.scrub.value / 1000;
    D.pct.textContent = `${Math.round(p * 100)}%`;
    D.scrub.style.setProperty('--pf', String(p));
    if (!S.textless && S.total) { const pos = posOfWord(p * S.total); D.chap.textContent = S.chs[pos.c]?.title || ''; }
    jump();
  });
  D.scrub.addEventListener('change', () => { if (!S) return; jump.flush(); S.scrubbing = false; scheduleInfo(); });

  D.scroller.addEventListener('scroll', onScroll, { passive: true });
  D.orig.addEventListener('scroll', onScroll, { passive: true });

  // activity, reveal chrome near the edges, ruler follows the pointer
  D.stage.addEventListener('pointermove', (e) => {
    if (!S) return;
    S.lastActive = performance.now();
    if (e.pointerType === 'mouse') {
      if (e.clientY < 70 || e.clientY > innerHeight - 90) showChrome();
      document.documentElement.style.setProperty('--ruler-y', `${e.clientY}px`);
    }
  });
  D.stage.addEventListener('touchmove', (e) => { if (S && e.touches[0]) { S.lastActive = performance.now(); document.documentElement.style.setProperty('--ruler-y', `${e.touches[0].clientY}px`); } }, { passive: true });
  D.stage.addEventListener('pointerdown', (e) => { if (S) { S.ptype = e.pointerType; S.downX = e.clientX; S.downY = e.clientY; S.lastActive = performance.now(); } });

  D.stage.addEventListener('click', (e) => {
    if (!S || !S.ready) return;
    const mk = e.target.closest?.('mark[data-hl]');
    if (mk) { annot.showHighlightPop(mk.dataset.hl, mk.getBoundingClientRect()); return; }
    if (e.target.closest('a, button, input, .notext')) return;
    if (!getSelection().isCollapsed) return;
    if (Math.hypot(e.clientX - (S.downX ?? e.clientX), e.clientY - (S.downY ?? e.clientY)) > 8) return;
    const w = D.stage.clientWidth, x = e.clientX;
    if (S.mode === 'reflow' && S.layout === 'paged') {
      if (x < w * 0.28) prevPage(); else if (x > w * 0.72) nextPage(); else toggleChrome();
    } else if (S.ptype === 'touch' || S.ptype === 'pen') toggleChrome();
  });

  // swipe + wheel for paged layout
  let sx = 0, sy = 0, st = 0;
  D.scroller.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now(); }, { passive: true });
  D.scroller.addEventListener('touchend', (e) => {
    if (!S || S.layout !== 'paged' || S.mode !== 'reflow') return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - st < 800) { if (dx < 0) nextPage(); else prevPage(); }
  }, { passive: true });
  let wheelAt = 0;
  D.scroller.addEventListener('wheel', (e) => {
    if (!S || S.layout !== 'paged' || S.mode !== 'reflow') return;
    e.preventDefault();
    const now = Date.now();
    if (now - wheelAt < 380 || Math.abs(e.deltaY) + Math.abs(e.deltaX) < 12) return;
    wheelAt = now;
    if (e.deltaY + e.deltaX > 0) nextPage(); else prevPage();
  }, { passive: false });

  window.addEventListener('resize', debounce(() => {
    if (!S || !S.ready) return;
    if (S.mode === 'reflow') relayout();
    else if (S.mode === 'orig' && Math.abs(origWidth() - S.origW) > 8) { const n = S.origPage || 1; buildOrigPages(); origGoPage(n); }
  }, 180));
  document.fonts?.addEventListener?.('loadingdone', () => { if (S?.ready && S.mode === 'reflow') relayoutSoon(); });

  onSettings((patch) => {
    if (!S || !S.ready) return;
    const keys = Object.keys(patch);
    if (S.mode === 'reflow') {
      if (keys.includes('layout')) switchLayout();
      else if (keys.some((k) => TYPO.includes(k))) relayoutSoon();
    }
    if (S.mode === 'orig' && keys.includes('pdfZoom')) { const n = S.origPage || 1; debounce(() => { buildOrigPages(); origGoPage(n); }, 120)(); }
    if (keys.includes('ruler')) updateRuler();
  });

  document.addEventListener('visibilitychange', () => { if (document.hidden && S) { trackNowSafe(S); putBook(S.book).catch(() => {}); flushStats(); annot.flushAnnot(); } });
  window.addEventListener('pagehide', () => { if (S) { trackNowSafe(S); mirrorPosition(S.book); putBook(S.book).catch(() => {}); flushStats(); annot.flushAnnot(); } });
  setInterval(tick, 1000);

  /* ---- hosts for the helper modules ---- */
  const host = {
    book: () => S?.book, chapters: () => S?.chs || [], pages: () => S?.book.pages || 0,
    currentChapter: () => S?.pos.c ?? 0, goChapter, goTo, goPage,
  };
  panel.initPanel(host);
  annot.initAnnot({
    textRoot: () => (S && S.mode === 'reflow' ? D.text : null),
    active: () => !!S, blockText, repaint: repaintBlock,
  });
  tts.initTts({
    pos: () => (S.mode === 'orig' && !S.textless ? { ...S.pageMap[S.origPage || 1] } : S.pos),
    blockText,
    nextBlock: (c, b) => {
      for (let cc = c, bb = b + 1; cc < S.chs.length; cc++, bb = 0) for (; bb < S.chs[cc].blocks.length; bb++) if (S.chs[cc].blocks[bb].k !== 'n') return { c: cc, b: bb };
      return null;
    },
    prevBlock: (c, b) => {
      for (let cc = c, bb = b - 1; cc >= 0; cc--, bb = (S.chs[cc]?.blocks.length ?? 0) - 1) for (; bb >= 0; bb--) if (S.chs[cc].blocks[bb].k !== 'n') return { c: cc, b: bb };
      return null;
    },
    speaking: (c, b) => {
      if (!S) return;
      const old = S.speaking;
      S.speaking = c == null ? null : { c, b };
      if (old) S.els[old.c]?.[old.b]?.classList.remove('speaking');
      if (S.speaking) S.els[c]?.[b]?.classList.add('speaking');
    },
    reveal: async (c, b) => {
      if (!S || S.mode !== 'reflow') return;
      if (S.layout === 'paged') {
        if (S.pagedC !== c) { S.page = 0; renderPagedChapter(c); }
        const el = S.els[c]?.[b];
        if (el) { const p = pageOfEl(el, 0); if (p !== S.page) showPage(p); }
        S.els[c]?.[b]?.classList.add('speaking');
      } else {
        const el = S.els[c]?.[b];
        if (!el) return;
        const r = el.getBoundingClientRect(), sr = D.scroller.getBoundingClientRect();
        if (r.width === 0 || r.top < sr.top + 60 || r.bottom > sr.bottom - 110) await scrollToPos({ c, b, f: 0 });
      }
    },
  });
}
