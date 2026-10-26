// Library view: shelf of books, the "continue reading" panel, adding PDFs, backups.
import { books, onBooks, removeBook, putBook, timeLeftSec, wpmOf, hasMeasuredSpeed, STATUSES, statusOf, statusLabel, setStatus } from './store.js';
import { dbAll, dbPut, kvGet, kvSet } from './db.js';
import { addPdf } from './importer.js';
import { settings, set } from './settings.js';
import { h, icon, $, fmtDuration, timeAgo, download, readJSON, writeJSON, uid } from './util.js';
import { toast, confirmDialog, promptDialog, showMenu } from './ui.js';

const covers = new Map();       // id -> data URL
const importing = new Map();    // temp id -> { name, p, msg, el }
let sortKey = readJSON('folio:sort', 'recent');
let shelf = readJSON('folio:shelf', 'all');
if (shelf !== 'all' && !STATUSES.some((s) => s[0] === shelf)) shelf = 'all';

/* ------------------------------------------------------------------ helpers */
const hue = (s) => { let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) % 360; return x; };
const fmtBytes = (n) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

function chapterOf(b) {
  const ch = b.chapters?.[b.pos?.c ?? 0];
  return ch?.title || '';
}

function statusLine(b) {
  if (b.finished) return `Completed ${timeAgo(b.finished)}`;
  if (!b.pct || b.pct < 0.005) return b.lastRead ? 'Just opened' : 'Not started';
  const pct = `${Math.round(b.pct * 100)}%`;
  return b.words ? `${pct} · ${fmtDuration(timeLeftSec(b))} left` : `${pct} · page ${b.page || 1} of ${b.pages}`;
}

function coverEl(b) {
  const data = covers.get(b.id);
  if (data) return h('img', { class: 'cover', src: data, alt: '', loading: 'lazy', decoding: 'async' });
  const hh = hue(b.title);
  return h('div', { class: 'cover ph', style: { background: `linear-gradient(160deg, hsl(${hh} 30% 42%), hsl(${(hh + 30) % 360} 32% 30%))` } },
    h('span', null, b.title.slice(0, 1).toUpperCase()));
}

export async function loadCovers() {
  try { for (const r of await dbAll('covers')) if (r.data) covers.set(r.id, r.data); } catch { /* ignore */ }
}

/* -------------------------------------------------------------------- cards */
function openBookHref(id) { return `#/read/${id}`; }

const shelfItems = (b) => [
  { heading: 'Move to shelf' },
  ...STATUSES.map(([id, name]) => ({ label: name, checked: statusOf(b) === id, onClick: () => { setStatus(b, id); toast(`Moved to ${name}`, { timeout: 1800 }); } })),
];
/** Shelf picker, also used from the reader's menu. */
export function openShelfMenu(b, anchor) { showMenu(shelfItems(b), anchor, { align: 'right', minWidth: 210 }); }

function bookMenu(b, anchor) {
  showMenu([
    { label: 'Open', icon: 'book', onClick: () => { location.hash = openBookHref(b.id); } },
    { label: 'Rename', icon: 'edit', onClick: async () => { const v = await promptDialog({ title: 'Rename book', value: b.title, label: 'Title' }); if (v) { b.title = v; putBook(b); } } },
    'sep',
    ...shelfItems(b),
    'sep',
    b.pct > 0 ? { label: 'Start over', icon: 'reset', onClick: () => resetProgress(b) } : null,
    { label: 'Delete from library', icon: 'trash', danger: true, onClick: () => deleteBook(b) },
  ].filter(Boolean), anchor, { minWidth: 220 });
}

function resetProgress(b) {
  Object.assign(b, { pct: 0, pos: { c: 0, b: 0, f: 0 }, page: 1, finished: null, status: 'toread', posTs: Date.now() });
  try { localStorage.removeItem(`folio:pos:${b.id}`); } catch { /* ignore */ }
  putBook(b);
}

async function deleteBook(b) {
  const ok = await confirmDialog({ title: `Delete “${b.title}”?`, body: 'The PDF, your highlights and bookmarks are removed from this browser. This cannot be undone.', confirm: 'Delete', danger: true });
  if (!ok) return;
  await removeBook(b.id);
  covers.delete(b.id);
  toast('Deleted');
}

function pillFor(b) {
  const st = statusOf(b);
  if (st === 'completed') return h('span', { class: 'badge' }, icon('check'), 'Completed');
  if (st === 'reading' || shelf !== 'all') return null;
  return h('span', { class: `badge st-${st}` }, statusLabel(st));
}

function card(b) {
  const href = openBookHref(b.id);
  const pct = Math.round((b.pct || 0) * 100);
  return h('article', { class: 'card', dataset: { id: b.id } },
    h('a', { class: 'cover-link', href, 'aria-label': `Open ${b.title}` },
      coverEl(b),
      pillFor(b),
      pct > 0 && !b.finished && statusOf(b) !== 'completed' ? h('span', { class: 'bar', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Progress' }, h('i', { style: { width: `${pct}%` } })) : null),
    h('div', { class: 'card-body' },
      h('h3', { class: 'card-title' }, h('a', { href }, b.title)),
      b.author ? h('div', { class: 'card-author' }, b.author) : null,
      h('div', { class: 'card-meta' }, statusLine(b))),
    h('button', { class: 'icon-btn card-more', 'aria-label': `More options for ${b.title}`, 'aria-haspopup': 'menu', onclick: (e) => bookMenu(b, e.currentTarget) }, icon('more')));
}

function importCard(job) {
  const bar = h('i', { style: { width: `${Math.round(job.p * 100)}%` } });
  const msg = h('div', { class: 'card-meta' }, job.msg);
  job.bar = bar; job.msgEl = msg;
  return h('article', { class: 'card importing', 'aria-busy': 'true' },
    h('div', { class: 'cover-link' }, h('div', { class: 'cover ph skeleton' }, h('div', { class: 'spinner small' })), h('span', { class: 'bar' }, bar)),
    h('div', { class: 'card-body' }, h('h3', { class: 'card-title' }, job.name.replace(/\.pdf$/i, '')), msg));
}

/* ------------------------------------------------------------------- resume */
function renderResume(list) {
  const el = $('#resume');
  const b = [...list].filter((x) => x.lastRead && statusOf(x) === 'reading' && x.pct > 0.005).sort((a, c) => c.lastRead - a.lastRead)[0];
  if (!b) { el.hidden = true; el.replaceChildren(); return; }
  const pct = Math.round(b.pct * 100);
  const where = b.hasText ? chapterOf(b) : `Page ${b.page || 1}`;
  el.hidden = false;
  el.replaceChildren(
    h('a', { class: 'resume-cover', href: openBookHref(b.id), tabindex: '-1', 'aria-hidden': 'true' }, coverEl(b)),
    h('div', { class: 'resume-body' },
      h('h2', null, b.title),
      h('p', { class: 'resume-where' }, where ? `You stopped in “${where}”.` : `You are ${pct}% through.`),
      h('div', { class: 'resume-prog' },
        h('span', { class: 'bar wide', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Progress' }, h('i', { style: { width: `${pct}%` } })),
        h('span', { class: 'resume-pct' }, `${pct}%`)),
      h('p', { class: 'muted resume-meta' }, [
        b.words ? `${fmtDuration(timeLeftSec(b))} left at ${wpmOf(b)} words a minute${hasMeasuredSpeed(b) ? '' : ' (an average until Folio learns your pace)'}` : `Page ${b.page || 1} of ${b.pages}`,
        ` · opened ${timeAgo(b.lastRead)}`].join('')),
      h('a', { class: 'btn primary big', href: openBookHref(b.id) }, icon('book'), h('span', null, 'Continue reading'))));
}

/* -------------------------------------------------------------------- shelf */
export function renderLibrary() {
  const q = $('#lib-q').value.trim().toLowerCase();
  let list = [...books.values()];
  const total = list.length;
  renderTabs(list);
  if (shelf !== 'all') list = list.filter((b) => statusOf(b) === shelf);
  if (q) list = list.filter((b) => `${b.title} ${b.author}`.toLowerCase().includes(q));
  const sorters = {
    recent: (a, b) => (b.lastRead || b.added) - (a.lastRead || a.added),
    added: (a, b) => b.added - a.added,
    title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
    progress: (a, b) => (b.pct || 0) - (a.pct || 0),
  };
  list.sort(sorters[sortKey] || sorters.recent);

  const grid = $('#grid');
  grid.replaceChildren(...[...importing.values()].map(importCard), ...list.map(card));
  const empty = !total && !importing.size;
  $('#empty').hidden = !empty;
  $('.shelf-head').hidden = empty;
  grid.hidden = empty;
  $('#shelf-tabs').hidden = empty;
  $('#shelf-count').textContent = total ? `${list.length} ${list.length === 1 ? 'book' : 'books'}` : '';
  if (!list.length && total && !importing.size) {
    grid.replaceChildren(h('div', { class: 'no-match' },
      h('p', null, q ? `No books match “${q}”.` : shelf === 'all' ? 'Nothing here yet.' : `No books on the “${statusLabel(shelf)}” shelf yet.`),
      !q && shelf !== 'all' ? h('p', { class: 'muted small' }, 'Use a book’s ⋯ menu to move it to this shelf.') : null));
  }
  renderResume(q || (shelf !== 'all' && shelf !== 'reading') ? [] : [...books.values()]);
  updateStorage();
}

async function updateStorage() {
  const el = $('#storage-info');
  try {
    const { usage } = await navigator.storage.estimate();
    el.textContent = usage ? `${fmtBytes(usage)} used on this device` : '';
  } catch { el.textContent = ''; }
}

function renderTabs(all) {
  const counts = { all: all.length };
  for (const [id] of STATUSES) counts[id] = 0;
  for (const b of all) counts[statusOf(b)]++;
  const tabs = [['all', 'All'], ...STATUSES];
  $('#shelf-tabs').replaceChildren(...tabs.map(([id, name]) => h('button', {
    class: 'shelf-tab', role: 'tab', 'aria-selected': String(shelf === id), onclick: () => { shelf = id; writeJSON('folio:shelf', id); renderLibrary(); },
  }, name, h('span', { class: 'count' }, String(counts[id])))));
}

/* ------------------------------------------------------------------- adding */
let busy = false;
export async function addFiles(fileList) {
  const files = [...fileList].filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
  if (!files.length) { toast('Only PDF files can be added.'); return; }
  if (busy) { toast('Still adding the previous books. Try again in a moment.'); return; }
  busy = true;
  navigator.storage?.persist?.().catch(() => {});
  let last = null, added = 0, existed = 0;
  for (const file of files) {
    const key = uid();
    const job = { name: file.name, p: 0, msg: 'Starting…' };
    importing.set(key, job);
    renderLibrary();
    try {
      const res = await addPdf(file, (p, msg) => {
        job.p = p; job.msg = msg;
        if (job.bar) { job.bar.style.width = `${Math.round(p * 100)}%`; job.msgEl.textContent = msg; }
      });
      last = res.book;
      if (res.existed) existed++; else added++;
      if (!res.book.hasText && !res.existed) toast(`“${res.book.title}” is a scanned PDF. It opens as original pages, since there is no text to reflow.`, { timeout: 6000 });
    } catch (e) {
      toast(e.message || `Could not add “${file.name}”.`, { timeout: 6500 });
    } finally {
      importing.delete(key);
      await loadCoverFor(last);
      renderLibrary();
    }
  }
  busy = false;
  if (last) {
    const msg = files.length === 1 ? (existed ? `“${last.title}” is already in your library.` : `Added “${last.title}”.`) : `Added ${added} book${added === 1 ? '' : 's'}${existed ? `, ${existed} already in your library` : ''}.`;
    toast(msg, { action: 'Open', onAction: () => { location.hash = openBookHref(last.id); }, timeout: 6000 });
  }
}

async function loadCoverFor(b) {
  if (!b || covers.has(b.id)) return;
  try { const { dbGet } = await import('./db.js'); const r = await dbGet('covers', b.id); if (r?.data) covers.set(b.id, r.data); } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ backups */
async function exportBackup() {
  const notes = {};
  for (const r of await dbAll('notes')) notes[r.id] = { bookmarks: r.bookmarks || [], highlights: r.highlights || [] };
  const payload = {
    app: 'folio', version: 1, exported: new Date().toISOString(), settings,
    daily: await kvGet('daily', {}),
    books: [...books.values()].map(({ id, title, author, added, lastRead, pct, pos, page, finished, stats, mode, fileName, pages }) => ({ id, title, author, added, lastRead, pct, pos, page, finished, stats, mode, fileName, pages })),
    notes,
  };
  download(`folio-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload), 'application/json');
  toast('Backup saved. It holds progress, notes and settings, not the PDFs.');
}

async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast('That file is not a Folio backup.'); return; }
  if (data?.app !== 'folio' || !Array.isArray(data.books)) { toast('That file is not a Folio backup.'); return; }
  let applied = 0, waiting = 0;
  for (const inc of data.books) {
    const notes = data.notes?.[inc.id];
    const mine = books.get(inc.id);
    if (mine) {
      if ((inc.lastRead || 0) > (mine.lastRead || 0)) Object.assign(mine, { pct: inc.pct, pos: inc.pos, page: inc.page, finished: inc.finished, lastRead: inc.lastRead, posTs: Date.now(), stats: inc.stats || mine.stats });
      await putBook(mine);
      if (notes) {
        const { dbGet } = await import('./db.js');
        const cur = (await dbGet('notes', inc.id)) || { id: inc.id, bookmarks: [], highlights: [] };
        const seen = new Set([...cur.bookmarks, ...cur.highlights].map((x) => x.id));
        cur.bookmarks.push(...(notes.bookmarks || []).filter((x) => !seen.has(x.id)));
        cur.highlights.push(...(notes.highlights || []).filter((x) => !seen.has(x.id)));
        await dbPut('notes', cur);
      }
      applied++;
    } else {
      await kvSet(`pending:${inc.id}`, { book: inc, notes });
      waiting++;
    }
  }
  if (data.daily) {
    const cur = await kvGet('daily', {});
    for (const [k, v] of Object.entries(data.daily)) { const c = cur[k] || { sec: 0, words: 0 }; cur[k] = { sec: Math.max(c.sec, v.sec || 0), words: Math.max(c.words, v.words || 0) }; }
    await kvSet('daily', cur);
  }
  if (data.settings) set(data.settings);
  toast(`Restored progress for ${applied} book${applied === 1 ? '' : 's'}${waiting ? `. ${waiting} more will restore when you add those PDFs again.` : '.'}`, { timeout: 7000 });
}

/* --------------------------------------------------------------------- init */
export function initLibrary() {
  const input = $('#file-input');
  const pick = () => input.click();
  $('#btn-add').addEventListener('click', pick);
  $('#btn-add-empty').addEventListener('click', pick);
  input.addEventListener('change', () => { const fs = [...input.files]; input.value = ''; addFiles(fs); });

  $('#lib-q').addEventListener('input', renderLibrary);
  const sort = $('#lib-sort');
  sort.value = sortKey;
  sort.addEventListener('change', () => { sortKey = sort.value; writeJSON('folio:sort', sortKey); renderLibrary(); });

  $('#btn-export').addEventListener('click', exportBackup);
  $('#btn-import').addEventListener('click', () => $('#import-input').click());
  $('#import-input').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importBackup(f).then(renderLibrary); });

  // Drag & drop anywhere
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const overlay = $('#drop-overlay');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; overlay.hidden = false; });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) overlay.hidden = true; });
  window.addEventListener('drop', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth = 0; overlay.hidden = true; addFiles(e.dataTransfer.files); });

  let queued = false;
  onBooks(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; if (!$('#view-library').hidden) renderLibrary(); }); });
}
