// Adds a PDF to the library: reads metadata, cover and text, then stores everything locally.
import { openPdf } from './pdf.js';
import { extractBook, renderCover, readMeta } from './extract.js';
import { dbPutMany, kvGet, dbDelete } from './db.js';
import { books, putBook } from './store.js';

const MAX_BYTES = 600 * 1024 * 1024;

async function fileId(buf) {
  const head = new Uint8Array(buf, 0, Math.min(buf.byteLength, 262144));
  const tailStart = Math.max(0, buf.byteLength - 262144);
  const tail = new Uint8Array(buf, tailStart, buf.byteLength - tailStart);
  const data = new Uint8Array(head.length + tail.length + 8);
  data.set(head); data.set(tail, head.length);
  new DataView(data.buffer).setFloat64(data.length - 8, buf.byteLength);
  if (crypto?.subtle) {
    const d = await crypto.subtle.digest('SHA-1', data);
    return [...new Uint8Array(d)].slice(0, 10).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let a = 0x811c9dc5, b = 0x1b873593;   // non-secure context fallback (FNV-style)
  for (let i = 0; i < data.length; i++) { a = Math.imul(a ^ data[i], 16777619); b = Math.imul(b + data[i], 2246822519) ^ (b >>> 13); }
  return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`.padEnd(20, '0');
}

/** Returns { book, existed }. Throws an Error with a message fit to show to the reader. */
export async function addPdf(file, onProgress = () => {}) {
  if (file.size > MAX_BYTES) throw new Error(`“${file.name}” is larger than 600 MB, which is too big to keep in the browser.`);
  const buf = await file.arrayBuffer();
  const head = new TextDecoder('latin1').decode(new Uint8Array(buf, 0, Math.min(1024, buf.byteLength)));
  if (!head.includes('%PDF')) throw new Error(`“${file.name}” is not a PDF file.`);

  const id = await fileId(buf);
  if (books.has(id)) return { book: books.get(id), existed: true };

  let pdf;
  try { pdf = await openPdf(buf); } catch (e) {
    if (e?.name === 'PasswordException') throw new Error(`“${file.name}” is password-protected. Remove the password, then add it again.`);
    throw new Error(`Could not open “${file.name}”. The file may be damaged.`);
  }
  try {
    onProgress(0.01, 'Reading details');
    const meta = await readMeta(pdf, file.name);
    const cover = await renderCover(pdf);
    const content = await extractBook(pdf, { onProgress });

    let start = 0;
    const chapters = content.chapters.map((c) => { const o = { title: c.title, pg: c.pg, words: c.words, start }; start += c.words; return o; });
    const book = {
      id, title: meta.title, author: meta.author, added: Date.now(), lastRead: 0,
      pages: pdf.numPages, words: content.words, hasText: content.hasText, source: content.source,
      chapters, pct: 0, pos: { c: 0, b: 0, f: 0 }, page: 1, finished: null,
      stats: { sec: 0, rSec: 0, rWords: 0 }, size: file.size, fileName: file.name,
      mode: content.hasText ? 'reflow' : 'orig',
    };

    // A restored backup may be waiting for this exact file.
    const pending = await kvGet(`pending:${id}`);
    const entries = [];
    if (pending) {
      const { book: p, notes } = pending;
      Object.assign(book, { pct: p.pct ?? 0, pos: p.pos || book.pos, page: p.page || 1, finished: p.finished || null, stats: p.stats || book.stats, lastRead: p.lastRead || 0, title: p.title || book.title, mode: book.hasText ? (p.mode || 'reflow') : 'orig' });
      if (notes) entries.push(['notes', { id, ...notes }]);
    }
    entries.push(
      ['content', { id, chapters: content.chapters, source: content.source, words: content.words, pages: content.pages, hasText: content.hasText }],
      ['files', { id, blob: new Blob([buf], { type: 'application/pdf' }), name: file.name }],
      ['covers', { id, data: cover }],
      ['books', book],
    );
    onProgress(0.97, 'Saving to your library');
    await dbPutMany(entries);
    if (pending) await dbDelete('kv', `pending:${id}`);
    await putBook(book);
    return { book, existed: false };
  } finally {
    try { pdf.destroy(); } catch { /* ignore */ }
  }
}
