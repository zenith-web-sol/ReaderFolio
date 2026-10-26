// PDF -> reflowable book.
//
// Pipeline:  text items -> lines -> (drop running headers / page numbers) -> headings & paragraphs
//            -> chapters (PDF outline, else detected headings, else even chunks).
// Output shape:
//   { chapters: [{ title, pg, blocks: [{ k:'p'|'h'|'n', t, pg, l? }], words }], words, pages, source }
import { smartTitleCase } from './util.js';

const LIGATURES = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' };
const LIG_RE = /[ﬀ-ﬆ]/g;
const TERMINAL = /[.!?…:;”"’')\]»]$/;
const BULLET = /^[•▪◦‣●○■□–—\-*·]\s+\S/;
const CHAPTER_WORDS = /^(chapter|part|book|section|prologue|epilogue|preface|foreword|introduction|afterword|appendix|acknowledg(e)?ments?|conclusion|interlude)\b/i;
const CHAPTER_LABEL_ONLY = /^(chapter|part|book|section)\s+([0-9]+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\.?$/i;
const PAGE_NUMBER = /^(page\s+)?(\d{1,4}|[ivxlc]{1,6})(\s*(of|\/)\s*\d{1,4})?$|^[-–—]\s*\d{1,4}\s*[-–—]$/i;

const yieldToUI = () => new Promise((r) => setTimeout(r, 0));
const median = (arr) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const percentile = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const normKey = (t) => t.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
const alnum = (t) => t.toLowerCase().replace(/[^a-z0-9À-ɏ]+/g, '');
const countWords = (t) => (t.match(/\S+/g) || []).length;

/* ------------------------------------------------------------------ lines */

async function readPageLines(page, pageNo) {
  const viewport = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const lines = [];
  let cur = null;
  const push = () => {
    if (!cur) return;
    const text = cur.text.replace(/\s+/g, ' ').trim();
    if (text) lines.push({ t: text.replace(LIG_RE, (c) => LIGATURES[c] || c), x0: cur.x0, x1: cur.x1, y: cur.y, fs: cur.bestFs || cur.fs, pg: pageNo });
    cur = null;
  };
  for (const it of tc.items) {
    if (typeof it.str !== 'string') continue; // marked-content markers
    const [a, b, , d, x, y] = it.transform;
    const fs = Math.abs(d) || Math.hypot(a, b) || it.height || 10;
    const width = it.width || 0;
    const str = it.str;
    if (!str.length) { if (it.hasEOL) push(); continue; }
    if (cur) {
      const dy = Math.abs(y - cur.y);
      const sameLine = dy < Math.max(cur.fs, fs) * 0.45 && x >= cur.x1 - Math.max(cur.fs, fs) * 2.5;
      if (!sameLine) push();
    }
    if (!cur) {
      cur = { text: str, x0: x, x1: x + width, y, fs, bestFs: fs, bestLen: str.trim().length };
    } else {
      const gap = x - cur.x1;
      if (!cur.text.endsWith(' ') && !str.startsWith(' ') && gap > fs * 0.17) cur.text += ' ';
      cur.text += str;
      cur.x1 = Math.max(cur.x1, x + width);
      const len = str.trim().length;
      if (len > cur.bestLen) { cur.bestLen = len; cur.bestFs = fs; }
      cur.fs = Math.max(cur.fs, fs);
    }
    if (it.hasEOL) push();
  }
  push();
  return { n: pageNo, w: viewport.width, h: viewport.height, lines };
}

/* ----------------------------------------------------------- main routine */

export async function extractBook(pdf, { onProgress } = {}) {
  const numPages = pdf.numPages;
  const pages = [];
  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    try { pages.push(await readPageLines(page, i)); } catch { pages.push({ n: i, w: 612, h: 792, lines: [] }); }
    page.cleanup();
    onProgress?.(i / numPages * 0.85, `Reading page ${i} of ${numPages}`);
    if (i % 4 === 0) await yieldToUI();
  }

  // ---- document statistics
  const sizeVotes = new Map();
  for (const p of pages) for (const l of p.lines) {
    const k = Math.round(l.fs * 2) / 2;
    sizeVotes.set(k, (sizeVotes.get(k) || 0) + l.t.length);
  }
  let body = 11, best = 0;
  for (const [k, v] of sizeVotes) if (v > best) { best = v; body = k; }

  const ratios = [];
  const lefts = [], rights = [];
  for (const p of pages) {
    for (let i = 0; i < p.lines.length; i++) {
      const l = p.lines[i];
      if (Math.abs(l.fs - body) > 0.8) continue;
      if (l.t.length >= 35) { lefts.push(l.x0); rights.push(l.x1); }
      const n = p.lines[i + 1];
      if (n && Math.abs(n.fs - body) < 0.8) {
        const gap = l.y - n.y;
        if (gap > 0 && gap < body * 2.2) ratios.push(gap / body);
      }
    }
  }
  const leadRatio = clampNum(median(ratios) || 1.3, 1.0, 2.2);
  const docLeft = percentile(lefts, 0.1) || 0;
  const docRight = percentile(rights, 0.9) || (pages[0]?.w ?? 612);
  const lead = leadRatio * body;

  // ---- running headers / footers / page numbers
  const edgeCount = new Map();
  for (const p of pages) {
    const seen = new Set();
    for (const l of p.lines) {
      if (!inEdge(l, p)) continue;
      if (l.fs >= body * 1.15 || l.t.length > 120) continue;
      const key = normKey(l.t);
      if (!seen.has(key)) { seen.add(key); edgeCount.set(key, (edgeCount.get(key) || 0) + 1); }
    }
  }
  const minRepeat = Math.max(3, Math.ceil(numPages * 0.12));
  const running = new Set([...edgeCount].filter(([, c]) => c >= minRepeat).map(([k]) => k));
  for (const p of pages) {
    p.lines = p.lines.filter((l) => {
      if (!inEdge(l, p)) return true;
      if (l.fs >= body * 1.15) return true;
      if (PAGE_NUMBER.test(l.t)) return false;
      return !running.has(normKey(l.t));
    });
  }

  // ---- blocks
  const blocks = [];
  let para = null;
  let notes = [];
  const flushNotes = (pg) => {
    if (!notes.length) return;
    let cur = null;
    const out = [];
    for (const l of notes) {
      if (!cur || /^[\d*†‡§]{1,3}[.)]?\s+\S/.test(l.t)) { cur = { k: 'n', t: l.t, pg: l.pg, y: l.y }; out.push(cur); }
      else cur.t = joinLines(cur.t, l.t);
    }
    blocks.push(...out);
    notes = [];
  };
  const flushPara = () => {
    if (!para) return;
    blocks.push({ k: 'p', t: para.t, pg: para.pg, y: para.y });
    para = null;
    flushNotes();
  };
  const pushHeading = (text, level, pg, y, fs) => {
    flushPara();
    const prev = blocks[blocks.length - 1];
    if (prev && prev.k === 'h' && prev.pg === pg && prev.fsLast != null && Math.abs(prev.yLast - y) < prev.fsLast * 3.2 && Math.abs(prev.l - level) <= 1) {
      prev.t = CHAPTER_LABEL_ONLY.test(prev.t) || /^\d{1,3}\.?$/.test(prev.t) || /^[IVXLC]+\.?$/.test(prev.t) ? `${prev.t} — ${text}` : `${prev.t} ${text}`;
      prev.l = Math.min(prev.l, level);
      prev.yLast = y; prev.fsLast = fs;
      return;
    }
    blocks.push({ k: 'h', t: text, l: level, pg, y, yLast: y, fsLast: fs });
  };

  for (const p of pages) {
    const lines = p.lines;
    const bodyLines = lines.filter((l) => Math.abs(l.fs - body) < 0.9 && l.t.length > 25);
    let left = docLeft, right = docRight;
    if (bodyLines.length >= 12) {
      left = percentile(bodyLines.map((l) => l.x0), 0.1);
      right = percentile(bodyLines.map((l) => l.x1), 0.9);
    }
    const ctx = { body, lead, left, width: Math.max(50, right - left) };

    for (let i = 0; i < lines.length; i++) {
      let l = lines[i];
      // Drop caps: a single large letter followed by a line that continues the word.
      const next = lines[i + 1];
      if (l.t.length <= 2 && l.fs >= body * 1.8 && next && /^[a-zà-ÿ]/.test(next.t)) {
        lines[i + 1] = { ...next, t: l.t + next.t };
        continue;
      }
      const level = headingLevel(l, body, lines[i - 1], lead);
      if (level) {
        let t = l.t;
        if (t === t.toUpperCase() && /[A-Z]{3,}/.test(t)) t = smartTitleCase(t);
        pushHeading(t, level, p.n, l.y, l.fs);
        continue;
      }
      if (l.fs < body * 0.86 && l.y < p.h * 0.35 && l.t.length < 400) { notes.push(l); continue; }

      if (!para) {
        para = { t: l.t, pg: p.n, y: l.y, last: l, lastPg: p.n };
        continue;
      }
      const cross = para.lastPg !== p.n;
      if (startsNewParagraph(para.last, l, cross, ctx)) {
        flushPara();
        para = { t: l.t, pg: p.n, y: l.y, last: l, lastPg: p.n };
      } else {
        para.t = joinLines(para.t, l.t);
        para.last = l;
        para.lastPg = p.n;
      }
    }
  }
  flushPara();
  flushNotes();
  onProgress?.(0.9, 'Finding chapters');

  // ---- chapters
  for (const b of blocks) b.t = b.t.replace(/\s{2,}/g, ' ').trim();
  const cleanBlocks = blocks.filter((b) => b.t.length > 0);
  let chapters = null, source = 'chunks';

  const fromOutline = await chaptersFromOutline(pdf, cleanBlocks, pages);
  if (fromOutline && fromOutline.length >= 2) { chapters = fromOutline; source = 'outline'; }
  if (!chapters) {
    const fromHeadings = chaptersFromHeadings(cleanBlocks);
    if (fromHeadings && fromHeadings.length >= 2) { chapters = fromHeadings; source = 'headings'; }
  }
  if (!chapters) chapters = chaptersFromChunks(cleanBlocks, numPages);

  // tidy: drop the leading heading that repeats the chapter title, strip helper fields
  for (const ch of chapters) {
    let dropped = 0;
    while (dropped < 2 && ch.blocks[0] && ch.blocks[0].k === 'h') {
      const a = alnum(ch.blocks[0].t), t = alnum(ch.title);
      if (a && t && (t.includes(a) || a.includes(t))) { ch.blocks.shift(); dropped++; } else break;
    }
    ch.blocks = ch.blocks.map((b) => (b.k === 'h' ? { k: 'h', t: b.t, pg: b.pg, l: b.l } : { k: b.k, t: b.t, pg: b.pg }));
    ch.words = ch.blocks.reduce((n, b) => n + countWords(b.t), 0);
  }
  chapters = chapters.filter((c) => c.blocks.length > 0);
  const words = chapters.reduce((n, c) => n + c.words, 0);
  onProgress?.(1, 'Done');
  return { chapters, words, pages: numPages, source, hasText: words >= numPages * 15 };
}

function clampNum(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
const inEdge = (l, p) => l.y > p.h * 0.9 || l.y < p.h * 0.1;

function joinLines(a, b) {
  if (/[A-Za-zÀ-ÿ]{2}-$/.test(a) && /^[a-zß-ÿ]/.test(b)) return a.slice(0, -1) + b;
  if (a.endsWith('­')) return a.slice(0, -1) + b;
  return `${a} ${b}`;
}

function startsNewParagraph(prev, cur, cross, ctx) {
  const fs = ctx.body;
  if (BULLET.test(cur.t)) return true;
  if (cur.x0 - prev.x0 > 0.9 * fs && cur.x0 - ctx.left > 0.9 * fs) return true; // first-line indent
  if (!cross) {
    const gap = prev.y - cur.y;
    if (gap < -fs * 0.5) return true; // jumped back up (new column / block)
    if (gap > ctx.lead * 1.28) return true; // extra paragraph spacing
  }
  const prevShort = prev.x1 - ctx.left < 0.72 * ctx.width;
  if (prevShort && TERMINAL.test(prev.t)) return true;
  if (/^\d{1,2}[.)]\s+\S/.test(cur.t) && TERMINAL.test(prev.t)) return true;
  return false;
}

function headingLevel(l, body, prev, lead) {
  const len = l.t.length;
  if (len > 150) return 0;
  const r = l.fs / body;
  if (r >= 1.18) {
    if (/[,;]$/.test(l.t)) return 0;
    return r >= 1.7 ? 1 : r >= 1.35 ? 2 : 3;
  }
  // body-sized "Chapter 4" / "PROLOGUE" lines standing on their own
  const isolated = !prev || prev.pg !== l.pg || (prev.y - l.y) > lead * 1.6;
  if (isolated && len <= 60 && (CHAPTER_LABEL_ONLY.test(l.t) || (CHAPTER_WORDS.test(l.t) && !/[.,;]$/.test(l.t) && l.t === l.t.toUpperCase()))) return 2;
  return 0;
}

/* --------------------------------------------------------------- chapters */

async function chaptersFromOutline(pdf, blocks, pages) {
  let outline;
  try { outline = await pdf.getOutline(); } catch { return null; }
  if (!outline || !outline.length) return null;

  const resolve = async (dest) => {
    try {
      if (typeof dest === 'string') dest = await pdf.getDestination(dest);
      if (!Array.isArray(dest)) return null;
      const ref = dest[0];
      let idx;
      if (ref && typeof ref === 'object') idx = await pdf.getPageIndex(ref);
      else if (Number.isInteger(ref)) idx = ref;
      else return null;
      const mode = dest[1]?.name;
      const top = mode === 'XYZ' ? dest[3] : (mode === 'FitH' || mode === 'FitBH') ? dest[2] : null;
      return { page: idx + 1, top: typeof top === 'number' ? top : null };
    } catch { return null; }
  };

  const collect = (items, depth, out) => { for (const it of items) { out.push({ it, depth }); if (it.items?.length) collect(it.items, depth + 1, out); } return out; };
  const flat = collect(outline, 0, []);
  const maxDepth = Math.max(...flat.map((f) => f.depth));
  let level = 0;
  const countAt = (d) => flat.filter((f) => f.depth === d).length;
  while (level < maxDepth && countAt(level) < 3) level++;
  let chosen = flat.filter((f) => f.depth === level);
  if (chosen.length > 250 && level > 0) chosen = flat.filter((f) => f.depth === 0);
  if (chosen.length < 2) return null;

  const anchors = [];
  const resolved = await Promise.all(chosen.map((c) => resolve(c.it.dest)));
  chosen.forEach((c, i) => { const r = resolved[i]; if (r && c.it.title?.trim()) anchors.push({ title: c.it.title.replace(/\s+/g, ' ').trim(), ...r }); });
  if (anchors.length < 2) return null;
  anchors.sort((a, b) => a.page - b.page || (b.top ?? 1e9) - (a.top ?? 1e9));

  const pageH = new Map(pages.map((p) => [p.n, p.h]));
  const chapters = [];
  let bi = 0;
  const before = [];
  const startsAt = (b, a) => b.pg > a.page || (b.pg === a.page && (a.top == null || b.y <= a.top + 12));
  while (bi < blocks.length && !startsAt(blocks[bi], anchors[0])) before.push(blocks[bi++]);
  for (let i = 0; i < anchors.length; i++) {
    const cur = anchors[i], nxt = anchors[i + 1];
    const mine = [];
    while (bi < blocks.length && (!nxt || !startsAt(blocks[bi], nxt))) mine.push(blocks[bi++]);
    chapters.push({ title: cur.title, pg: cur.page, blocks: mine });
  }
  void pageH;
  // merge empty chapters into a neighbour title-wise (keep the first title when two share a spot)
  const merged = [];
  for (const c of chapters) {
    if (!c.blocks.length) continue;
    merged.push(c);
  }
  const frontWords = before.reduce((n, b) => n + countWords(b.t), 0);
  if (frontWords >= 20) merged.unshift({ title: 'Opening pages', pg: before[0].pg, blocks: before });
  return merged;
}

function chaptersFromHeadings(blocks) {
  const heads = blocks.map((b, i) => ({ b, i })).filter((x) => x.b.k === 'h');
  if (heads.length < 2) return null;
  const patterned = heads.filter((x) => CHAPTER_WORDS.test(x.b.t) || /^\d{1,3}[.:]?\s+\S/.test(x.b.t) || /^[IVXLC]+[.:]\s+\S/.test(x.b.t));
  let picks = null;
  if (patterned.length >= 2) picks = patterned;
  else {
    const top = Math.min(...heads.map((x) => x.b.l));
    const lvl = heads.filter((x) => x.b.l === top);
    if (lvl.length >= 2 && lvl.length <= 150) picks = lvl;
  }
  if (!picks) return null;
  const chapters = [];
  const firstIdx = picks[0].i;
  const front = blocks.slice(0, firstIdx);
  if (front.reduce((n, b) => n + countWords(b.t), 0) >= 20) chapters.push({ title: 'Opening pages', pg: front[0].pg, blocks: front });
  picks.forEach((x, k) => {
    const end = k + 1 < picks.length ? picks[k + 1].i : blocks.length;
    chapters.push({ title: x.b.t, pg: x.b.pg, blocks: blocks.slice(x.i, end) });
  });
  return chapters;
}

function chaptersFromChunks(blocks, numPages) {
  const total = blocks.reduce((n, b) => n + countWords(b.t), 0);
  if (!blocks.length) return [];
  const parts = total < 2500 ? 1 : clampNum(Math.round(total / 6000), 2, 60);
  const target = total / parts;
  const chapters = [];
  let cur = [], acc = 0;
  const close = () => {
    if (!cur.length) return;
    const a = cur[0].pg, z = cur[cur.length - 1].pg;
    chapters.push({ title: parts === 1 ? 'Document' : (a === z ? `Page ${a}` : `Pages ${a}–${z}`), pg: a, blocks: cur });
    cur = []; acc = 0;
  };
  for (const b of blocks) {
    cur.push(b);
    acc += countWords(b.t);
    if (acc >= target && chapters.length < parts - 1) close();
  }
  close();
  void numPages;
  return chapters;
}

/* ------------------------------------------------------------ cover + meta */

export async function renderCover(pdf, width = 360) {
  try {
    const page = await pdf.getPage(1);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = width / vp1.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, viewport, background: '#ffffff' }).promise;
    page.cleanup();
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch { return null; }
}

export async function readMeta(pdf, fileName) {
  let title = '', author = '';
  try {
    const m = await pdf.getMetadata();
    title = (m.info?.Title || m.metadata?.get?.('dc:title') || '').toString().trim();
    author = (m.info?.Author || m.metadata?.get?.('dc:creator') || '').toString().trim();
  } catch { /* no metadata */ }
  title = title.replace(/^Microsoft Word - /i, '').replace(/\.(docx?|pdf|indd|tex)$/i, '').trim();
  const fromName = fileName.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').replace(/\s*-\s*/g, ' – ').replace(/\s+/g, ' ').trim();
  const bad = !title || /^(untitled|document\d*|slide\s*\d*)$/i.test(title) || title.length < 2 || /^[\w-]+\.\w{2,4}$/.test(title);
  return { title: bad ? fromName : title, author: author.slice(0, 120) };
}
