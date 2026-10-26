// Highlights, notes and bookmarks for the open book, plus the selection popup.
import { dbGet, dbPut } from './db.js';
import { HIGHLIGHTS } from './themes.js';
import { h, icon, uid, debounce, copyText } from './util.js';
import { toast, promptDialog } from './ui.js';

let host = null;
let bookId = null;
let data = { bookmarks: [], highlights: [] };
const byBlock = new Map();
const subs = new Set();
export const onAnnot = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const emit = () => subs.forEach((f) => f());

const persist = debounce(() => { if (bookId) dbPut('notes', { id: bookId, bookmarks: data.bookmarks, highlights: data.highlights, ts: Date.now() }).catch(() => {}); }, 350);
export const flushAnnot = () => persist.flush();

export const getData = () => data;
export const highlightsFor = (c, b) => byBlock.get(`${c}:${b}`) || null;

function index() {
  byBlock.clear();
  for (const hl of data.highlights) {
    const k = `${hl.c}:${hl.b}`;
    (byBlock.get(k) || byBlock.set(k, []).get(k)).push(hl);
  }
  for (const list of byBlock.values()) list.sort((a, b) => a.s - b.s);
}

export async function loadAnnot(id) {
  bookId = id;
  const row = await dbGet('notes', id).catch(() => null);
  data = { bookmarks: row?.bookmarks || [], highlights: row?.highlights || [] };
  index();
  emit();
}
export function unloadAnnot() { flushAnnot(); bookId = null; data = { bookmarks: [], highlights: [] }; index(); hidePop(); }

/* -------------------------------------------------------------- highlights */
export function addHighlight({ c, b, s, e }, color = 'yellow', note = '') {
  const txt = host.blockText(c, b);
  let ns = s, ne = e, nn = note;
  const overlapped = data.highlights.filter((x) => x.c === c && x.b === b && x.s < e && x.e > s);
  for (const o of overlapped) { ns = Math.min(ns, o.s); ne = Math.max(ne, o.e); if (o.note) nn = nn ? `${o.note}\n${nn}` : o.note; }
  data.highlights = data.highlights.filter((x) => !overlapped.includes(x));
  const hl = { id: uid(), c, b, s: ns, e: ne, color, note: nn, text: txt.slice(ns, ne), ts: Date.now() };
  data.highlights.push(hl);
  index(); host.repaint(c, b); persist(); emit();
  return hl;
}
export function updateHighlight(id, patch) {
  const hl = data.highlights.find((x) => x.id === id);
  if (!hl) return;
  Object.assign(hl, patch);
  index(); host.repaint(hl.c, hl.b); persist(); emit();
}
export function removeHighlight(id) {
  const hl = data.highlights.find((x) => x.id === id);
  if (!hl) return;
  data.highlights = data.highlights.filter((x) => x !== hl);
  index(); host.repaint(hl.c, hl.b); persist(); emit();
}

/* --------------------------------------------------------------- bookmarks */
export function toggleBookmark(pos, info) {
  const near = data.bookmarks.find((m) => m.c === pos.c && m.b === pos.b);
  if (near) {
    data.bookmarks = data.bookmarks.filter((m) => m !== near);
    persist(); emit();
    return false;
  }
  data.bookmarks.push({ id: uid(), c: pos.c, b: pos.b, f: pos.f || 0, pct: info.pct, label: info.label, chapter: info.chapter, ts: Date.now() });
  persist(); emit();
  return true;
}
export function removeBookmark(id) { data.bookmarks = data.bookmarks.filter((m) => m.id !== id); persist(); emit(); }
export function renameBookmark(id, label) { const m = data.bookmarks.find((x) => x.id === id); if (m) { m.label = label; persist(); emit(); } }
export const hasBookmarkAt = (c, b) => data.bookmarks.some((m) => m.c === c && m.b === b);

export function toMarkdown(book, chapters) {
  const out = [`# Notes from ${book.title}`, book.author ? `*${book.author}*` : '', ''];
  const marks = [...data.bookmarks].sort((a, b) => a.c - b.c || a.b - b.b);
  const hls = [...data.highlights].sort((a, b) => a.c - b.c || a.b - b.b || a.s - b.s);
  if (marks.length) { out.push('## Bookmarks'); for (const m of marks) out.push(`- ${chapters[m.c]?.title || 'Chapter'} (${Math.round(m.pct * 100)}%): ${m.label}`); out.push(''); }
  if (hls.length) {
    out.push('## Highlights');
    let last = -1;
    for (const x of hls) {
      if (x.c !== last) { out.push('', `### ${chapters[x.c]?.title || 'Chapter'}`); last = x.c; }
      out.push(`> ${x.text}`);
      if (x.note) out.push('', x.note);
      out.push('');
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/* ----------------------------------------------------------- selection popup */
const pop = () => document.getElementById('sel-pop');
let popOpen = false;
export function hidePop() { const p = pop(); if (p) p.hidden = true; popOpen = false; }

function blockOf(node) {
  const el = node?.nodeType === 1 ? node : node?.parentElement;
  const b = el?.closest?.('[data-b]');
  return b && +b.dataset.b >= 0 ? b : null;
}
function offsetIn(block, node, offset) {
  const r = document.createRange();
  r.selectNodeContents(block);
  r.setEnd(node, offset);
  return r.toString().length;
}

function readSelection() {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  const root = host.textRoot();
  if (!root || !root.contains(r.commonAncestorContainer)) return null;
  const a = blockOf(r.startContainer);
  if (!a) return null;
  const z = blockOf(r.endContainer);
  const full = a.textContent;
  let s = offsetIn(a, r.startContainer, r.startOffset);
  let e = z === a ? offsetIn(a, r.endContainer, r.endOffset) : full.length;
  while (s < e && /\s/.test(full[s])) s++;
  while (e > s && /\s/.test(full[e - 1])) e--;
  if (e - s < 1) return null;
  return { c: +a.dataset.c, b: +a.dataset.b, s, e, text: full.slice(s, e), rect: r.getBoundingClientRect() };
}

function place(rect) {
  const p = pop();
  p.hidden = false;
  popOpen = true;
  const w = p.offsetWidth, hgt = p.offsetHeight;
  let x = rect.left + rect.width / 2 - w / 2;
  let y = rect.top - hgt - 10;
  if (y < 64) y = rect.bottom + 12;
  x = Math.max(8, Math.min(x, innerWidth - w - 8));
  y = Math.max(8, Math.min(y, innerHeight - hgt - 8));
  p.style.left = `${x}px`;
  p.style.top = `${y}px`;
}

function colorDots(current, onPick) {
  return Object.keys(HIGHLIGHTS).map((name) => h('button', {
    class: `dot hl-${name}${current === name ? ' on' : ''}`, 'aria-label': `Highlight ${name}`, title: name[0].toUpperCase() + name.slice(1),
    onpointerdown: (e) => e.preventDefault(), onclick: () => onPick(name),
  }));
}

function showForSelection(info) {
  const p = pop();
  const make = async (color, withNote) => {
    const hl = addHighlight(info, color);
    getSelection()?.removeAllRanges();
    hidePop();
    if (withNote) editNote(hl.id);
  };
  p.replaceChildren(
    ...colorDots(null, (c) => make(c, false)),
    h('span', { class: 'pop-sep' }),
    h('button', { class: 'pop-btn', onpointerdown: (e) => e.preventDefault(), onclick: () => make('yellow', true) }, icon('note'), h('span', null, 'Note')),
    h('button', { class: 'pop-btn', onpointerdown: (e) => e.preventDefault(), onclick: async () => { await copyText(info.text); toast('Copied'); getSelection()?.removeAllRanges(); hidePop(); } }, icon('copy'), h('span', null, 'Copy')),
  );
  place(info.rect);
}

export function showHighlightPop(id, rect) {
  const hl = data.highlights.find((x) => x.id === id);
  if (!hl) return;
  const p = pop();
  p.replaceChildren(
    ...colorDots(hl.color, (c) => { updateHighlight(id, { color: c }); showHighlightPop(id, rect); }),
    h('span', { class: 'pop-sep' }),
    h('button', { class: 'pop-btn', onclick: () => { hidePop(); editNote(id); } }, icon('note'), h('span', null, hl.note ? 'Edit note' : 'Note')),
    h('button', { class: 'pop-btn', onclick: async () => { await copyText(hl.text); toast('Copied'); hidePop(); } }, icon('copy'), h('span', null, 'Copy')),
    h('button', { class: 'pop-btn danger', onclick: () => { removeHighlight(id); hidePop(); } }, icon('trash'), h('span', null, 'Remove')),
  );
  place(rect);
}

export async function editNote(id) {
  const hl = data.highlights.find((x) => x.id === id);
  if (!hl) return;
  const v = await promptDialog({ title: 'Note', value: hl.note || '', label: `On “${hl.text.length > 70 ? `${hl.text.slice(0, 70)}…` : hl.text}”`, multiline: true });
  if (v !== null) updateHighlight(id, { note: v });
}

export function initAnnot(hostApi) {
  host = hostApi;
  const check = debounce(() => {
    if (!host.textRoot()) return;
    const info = readSelection();
    if (info) showForSelection(info); else if (popOpen && !pop().matches(':hover')) hidePop();
  }, 180);
  document.addEventListener('selectionchange', () => { if (host.active()) check(); });
  document.addEventListener('pointerdown', (e) => { if (popOpen && !pop().contains(e.target)) hidePop(); }, true);
  window.addEventListener('scroll', () => { if (popOpen) hidePop(); }, true);
}
