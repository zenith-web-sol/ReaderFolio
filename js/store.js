// In-memory view of the library, backed by IndexedDB. Reading position is also mirrored
// to localStorage on every save, so a tab closed mid-scroll never loses your place.
import { dbAll, dbPut, deleteBook } from './db.js';
import { readJSON, writeJSON, clamp } from './util.js';

export const books = new Map();
const subs = new Set();
export const onBooks = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const emit = () => subs.forEach((f) => f());

export async function loadBooks() {
  const rows = await dbAll('books');
  books.clear();
  for (const r of rows) {
    const bk = readJSON(`folio:pos:${r.id}`, null);
    if (bk && bk.ts > (r.posTs || 0)) Object.assign(r, { pos: bk.pos, pct: bk.pct, page: bk.page, lastRead: bk.ts, posTs: bk.ts });
    books.set(r.id, r);
  }
  emit();
}

export function putBook(b) {
  books.set(b.id, b);
  emit();
  return dbPut('books', b);
}

export async function removeBook(id) {
  await deleteBook(id);
  books.delete(id);
  try { localStorage.removeItem(`folio:pos:${id}`); } catch { /* ignore */ }
  emit();
}

export function mirrorPosition(b) {
  writeJSON(`folio:pos:${b.id}`, { pos: b.pos, pct: b.pct, page: b.page, ts: b.posTs });
}

export function touch() { emit(); }

const DEFAULT_WPM = 230;
/** Reading speed for this book, blending your measured speed with an average one until there is enough data. */
export function wpmOf(b) {
  const s = b.stats || {};
  if (!s.rSec || s.rSec < 30) return DEFAULT_WPM;
  const measured = (s.rWords / s.rSec) * 60;
  const w = Math.min(1, s.rSec / 600);
  return clamp(Math.round(measured * w + DEFAULT_WPM * (1 - w)), 80, 900);
}
export const hasMeasuredSpeed = (b) => (b.stats?.rSec || 0) >= 120;
export const wordsLeft = (b) => Math.max(0, Math.round((b.words || 0) * (1 - (b.pct || 0))));
export const timeLeftSec = (b) => (b.words ? (wordsLeft(b) / wpmOf(b)) * 60 : 0);

/* ---- shelves ---- */
export const STATUSES = [['reading', 'Reading'], ['toread', 'Yet to read'], ['completed', 'Completed'], ['hold', 'On hold'], ['dropped', 'Dropped']];
export const statusLabel = (id) => STATUSES.find((s) => s[0] === id)?.[1] || '';
/** An explicit shelf wins; otherwise it follows progress. */
export function statusOf(b) {
  if (b.status) return b.status;
  if (b.finished) return 'completed';
  return (b.pct || 0) > 0.005 ? 'reading' : 'toread';
}
export function setStatus(b, st) {
  b.status = st;
  if (st === 'completed') { if (!b.finished) b.finished = Date.now(); } else if (b.finished) b.finished = null;
  return putBook(b);
}
