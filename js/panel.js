// Left drawer: Contents, Notes (bookmarks + highlights) and Search.
import { h, icon, $, fmtDuration, debounce, download, copyText } from './util.js';
import { openDrawer, closeDrawers, toast, promptDialog } from './ui.js';
import { getData, onAnnot, removeBookmark, renameBookmark, removeHighlight, editNote, toMarkdown } from './annot.js';
import { wpmOf } from './store.js';

let host = null;
let query = '';
const TABS = ['toc', 'marks', 'find'];

export function setTab(name) {
  for (const t of TABS) {
    $(`#tab-${t}`).setAttribute('aria-selected', String(t === name));
    $(`#pane-${t}`).hidden = t !== name;
  }
  if (name === 'toc') renderToc();
  if (name === 'marks') renderMarks();
  if (name === 'find') renderFind();
}
export function openPanel(tab = 'toc') {
  setTab(tab);
  openDrawer('drawer-left');
  if (tab === 'toc') setTimeout(() => $('#pane-toc .toc-item[aria-current=true]')?.scrollIntoView({ block: 'center' }), 80);
  if (tab === 'find') setTimeout(() => { const i = $('#find-q'); i?.focus(); i?.select(); }, 80);
}
export const refreshPanel = () => { if (!$('#drawer-left').hidden) setTab(TABS.find((t) => $(`#tab-${t}`).getAttribute('aria-selected') === 'true')); };

/* ---------------------------------------------------------------- contents */
export function renderToc() {
  const pane = $('#pane-toc');
  const book = host.book();
  if (!book) return;
  const chs = host.chapters();
  const noun = book.source === 'chunks' ? 'Section' : 'Chapter';
  const here = host.currentChapter();
  if (!chs.length || !book.hasText) {
    pane.replaceChildren(h('div', { class: 'pane-empty' }, h('p', null, 'No chapters were found in this PDF.'), host.pages() ? goToPage() : null));
    return;
  }
  const wpm = wpmOf(book);
  const list = h('ol', { class: 'toc' }, chs.map((ch, i) => h('li', null,
    h('button', { class: `toc-item${i < here ? ' done' : ''}`, 'aria-current': i === here ? 'true' : null, onclick: () => { host.goChapter(i); if (innerWidth < 900) closeDrawers(); } },
      h('span', { class: 'toc-mark', 'aria-hidden': 'true' }, i < here ? icon('check') : null),
      h('span', { class: 'toc-title' }, ch.title),
      h('span', { class: 'toc-meta' }, `${fmtDuration((ch.words / wpm) * 60)}`)))));
  pane.replaceChildren(
    h('div', { class: 'pane-sum' }, `${chs.length} ${noun.toLowerCase()}${chs.length === 1 ? '' : 's'}`, book.source === 'chunks' ? h('span', { class: 'muted' }, ' · This PDF has no chapter markers, so the book is split into even sections') : null),
    list);
}

function goToPage() {
  const input = h('input', { type: 'number', min: 1, max: host.pages(), placeholder: `1–${host.pages()}`, 'aria-label': 'Page number' });
  return h('form', { class: 'goto', onsubmit: (e) => { e.preventDefault(); host.goPage(+input.value); closeDrawers(); } }, input, h('button', { class: 'btn', type: 'submit' }, 'Go to page'));
}

/* ------------------------------------------------------------------- notes */
export function renderMarks() {
  const pane = $('#pane-marks');
  const book = host.book();
  if (!book) return;
  const { bookmarks, highlights } = getData();
  const chs = host.chapters();
  if (!bookmarks.length && !highlights.length) {
    pane.replaceChildren(h('div', { class: 'pane-empty' },
      icon('highlight', 'ico big'),
      h('p', null, 'Select any text to highlight it or add a note.'),
      h('p', { class: 'muted' }, 'Press B to bookmark where you are. Folio already remembers your place without one.')));
    return;
  }
  const items = [
    ...bookmarks.map((m) => ({ kind: 'm', c: m.c, b: m.b, s: -1, m })),
    ...highlights.map((x) => ({ kind: 'h', c: x.c, b: x.b, s: x.s, x })),
  ].sort((a, b) => a.c - b.c || a.b - b.b || a.s - b.s);

  const rows = items.map((it) => {
    const ch = chs[it.c]?.title || '';
    if (it.kind === 'm') {
      const m = it.m;
      return h('li', { class: 'note-item' },
        h('button', { class: 'note-main', onclick: () => { host.goTo({ c: m.c, b: m.b, f: m.f }, { flash: true }); if (innerWidth < 900) closeDrawers(); } },
          h('span', { class: 'note-kind' }, icon('bookmark'), h('span', null, `${Math.round(m.pct * 100)}%`)),
          h('span', { class: 'note-text' }, m.label), h('span', { class: 'note-ch' }, ch)),
        h('div', { class: 'note-tools' },
          h('button', { class: 'icon-btn sm', 'aria-label': 'Rename bookmark', onclick: async () => { const v = await promptDialog({ title: 'Rename bookmark', value: m.label }); if (v) renameBookmark(m.id, v); } }, icon('edit')),
          h('button', { class: 'icon-btn sm', 'aria-label': 'Delete bookmark', onclick: () => removeBookmark(m.id) }, icon('trash'))));
    }
    const x = it.x;
    return h('li', { class: 'note-item' },
      h('button', { class: `note-main hl-${x.color}`, onclick: () => { host.goTo({ c: x.c, b: x.b, f: 0 }, { flash: true }); if (innerWidth < 900) closeDrawers(); } },
        h('span', { class: 'note-quote' }, x.text.length > 220 ? `${x.text.slice(0, 220)}…` : x.text),
        x.note ? h('span', { class: 'note-note' }, x.note) : null,
        h('span', { class: 'note-ch' }, ch)),
      h('div', { class: 'note-tools' },
        h('button', { class: 'icon-btn sm', 'aria-label': x.note ? 'Edit note' : 'Add note', onclick: () => editNote(x.id) }, icon('note')),
        h('button', { class: 'icon-btn sm', 'aria-label': 'Delete highlight', onclick: () => removeHighlight(x.id) }, icon('trash'))));
  });

  pane.replaceChildren(
    h('div', { class: 'pane-sum' }, `${highlights.length} highlight${highlights.length === 1 ? '' : 's'} · ${bookmarks.length} bookmark${bookmarks.length === 1 ? '' : 's'}`,
      h('span', { class: 'spacer' }),
      h('button', { class: 'link-btn', onclick: async () => { await copyText(toMarkdown(book, chs)); toast('Notes copied as Markdown'); } }, icon('copy'), 'Copy'),
      h('button', { class: 'link-btn', onclick: () => download(`${book.title.replace(/[^\w\- ]+/g, '').trim() || 'notes'} – notes.md`, toMarkdown(book, chs), 'text/markdown') }, icon('download'), 'Save')),
    h('ul', { class: 'notes' }, rows));
}

/* ------------------------------------------------------------------ search */
function runSearch(q) {
  const out = [];
  const needle = q.toLowerCase();
  const chs = host.chapters();
  outer: for (let c = 0; c < chs.length; c++) {
    const blocks = chs[c].blocks;
    for (let b = 0; b < blocks.length; b++) {
      const text = blocks[b].t;
      const low = text.toLowerCase();
      let from = 0, hit;
      while ((hit = low.indexOf(needle, from)) !== -1) {
        out.push({ c, b, s: hit, e: hit + needle.length, text });
        if (out.length >= 300) break outer;
        from = hit + needle.length;
        if (out.filter((r) => r.c === c && r.b === b).length >= 3) break;
      }
    }
  }
  return out;
}

function snippet(r) {
  const a = Math.max(0, r.s - 48), z = Math.min(r.text.length, r.e + 72);
  return [a > 0 ? '…' : '', r.text.slice(a, r.s), h('mark', null, r.text.slice(r.s, r.e)), r.text.slice(r.e, z), z < r.text.length ? '…' : ''];
}

export function renderFind() {
  const pane = $('#pane-find');
  if (!$('#find-q', pane)) {
    const input = h('input', { id: 'find-q', type: 'search', placeholder: 'Search this book', autocomplete: 'off', 'aria-label': 'Search this book' });
    input.value = query;
    const go = debounce(() => { query = input.value.trim(); renderResults(); }, 200);
    input.addEventListener('input', go);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go.flush(); } });
    pane.replaceChildren(h('div', { class: 'find-bar' }, icon('search'), input), h('div', { id: 'find-out' }));
  }
  renderResults();
}

function renderResults() {
  const out = $('#find-out');
  if (!out) return;
  const book = host.book();
  if (!book?.hasText) { out.replaceChildren(h('p', { class: 'pane-empty muted' }, 'This PDF has no readable text to search.')); return; }
  if (query.length < 2) { out.replaceChildren(h('p', { class: 'pane-hint muted' }, 'Type at least two letters.')); return; }
  const res = runSearch(query);
  const chs = host.chapters();
  if (!res.length) { out.replaceChildren(h('p', { class: 'pane-hint' }, `Nothing found for “${query}”.`)); return; }
  out.replaceChildren(
    h('div', { class: 'pane-sum' }, res.length >= 300 ? 'First 300 matches' : `${res.length} match${res.length === 1 ? '' : 'es'}`),
    h('ul', { class: 'results' }, res.map((r) => h('li', null,
      h('button', { class: 'result', onclick: () => { host.goTo({ c: r.c, b: r.b, f: 0 }, { find: r }); if (innerWidth < 900) closeDrawers(); } },
        h('span', { class: 'result-ch' }, chs[r.c]?.title || ''),
        h('span', { class: 'result-text' }, snippet(r)))))));
}

/* -------------------------------------------------------------------- init */
export function initPanel(hostApi) {
  host = hostApi;
  for (const t of TABS) $(`#tab-${t}`).addEventListener('click', () => setTab(t));
  $('#drawer-left .tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = TABS.findIndex((t) => $(`#tab-${t}`).getAttribute('aria-selected') === 'true');
    const n = TABS[(i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length];
    setTab(n); $(`#tab-${n}`).focus();
  });
  onAnnot(() => { if (!$('#drawer-left').hidden) refreshPanel(); });
}
export const resetQuery = () => { query = ''; const i = $('#find-q'); if (i) i.value = ''; };
