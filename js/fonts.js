// Reading fonts. Google Fonts families load lazily (only when picked or previewed);
// every entry has a system fallback so the reader still works offline.
import { dbAll, dbPut, dbDelete } from './db.js';

const SERIF_FB = 'Georgia, "Times New Roman", serif';
const SANS_FB = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO_FB = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

// gf = Google Fonts family name, ital = family ships true italics.
export const FONTS = [
  // Serif — the classic book faces
  { id: 'literata', name: 'Literata', cat: 'Serif', gf: 'Literata', ital: true, fb: SERIF_FB },
  { id: 'source-serif', name: 'Source Serif', cat: 'Serif', gf: 'Source Serif 4', ital: true, fb: SERIF_FB },
  { id: 'newsreader', name: 'Newsreader', cat: 'Serif', gf: 'Newsreader', ital: true, fb: SERIF_FB },
  { id: 'lora', name: 'Lora', cat: 'Serif', gf: 'Lora', ital: true, fb: SERIF_FB },
  { id: 'merriweather', name: 'Merriweather', cat: 'Serif', gf: 'Merriweather', ital: true, fb: SERIF_FB },
  { id: 'crimson', name: 'Crimson Pro', cat: 'Serif', gf: 'Crimson Pro', ital: true, fb: SERIF_FB },
  { id: 'eb-garamond', name: 'EB Garamond', cat: 'Serif', gf: 'EB Garamond', ital: true, fb: SERIF_FB },
  { id: 'spectral', name: 'Spectral', cat: 'Serif', gf: 'Spectral', ital: true, fb: SERIF_FB },
  { id: 'baskerville', name: 'Libre Baskerville', cat: 'Serif', gf: 'Libre Baskerville', ital: true, fb: SERIF_FB },
  { id: 'pt-serif', name: 'PT Serif', cat: 'Serif', gf: 'PT Serif', ital: true, fb: SERIF_FB },
  { id: 'vollkorn', name: 'Vollkorn', cat: 'Serif', gf: 'Vollkorn', ital: true, fb: SERIF_FB },
  { id: 'cormorant', name: 'Cormorant Garamond', cat: 'Serif', gf: 'Cormorant Garamond', ital: true, fb: SERIF_FB },
  { id: 'playfair', name: 'Playfair Display', cat: 'Serif', gf: 'Playfair Display', ital: true, fb: SERIF_FB },
  { id: 'bitter', name: 'Bitter', cat: 'Serif', gf: 'Bitter', ital: true, fb: SERIF_FB },
  { id: 'noto-serif', name: 'Noto Serif', cat: 'Serif', gf: 'Noto Serif', ital: true, fb: SERIF_FB },
  // Sans
  { id: 'inter', name: 'Inter', cat: 'Sans', gf: 'Inter', ital: false, fb: SANS_FB },
  { id: 'source-sans', name: 'Source Sans', cat: 'Sans', gf: 'Source Sans 3', ital: true, fb: SANS_FB },
  { id: 'open-sans', name: 'Open Sans', cat: 'Sans', gf: 'Open Sans', ital: true, fb: SANS_FB },
  { id: 'lato', name: 'Lato', cat: 'Sans', gf: 'Lato', ital: true, fb: SANS_FB },
  { id: 'nunito', name: 'Nunito', cat: 'Sans', gf: 'Nunito', ital: true, fb: SANS_FB },
  { id: 'work-sans', name: 'Work Sans', cat: 'Sans', gf: 'Work Sans', ital: true, fb: SANS_FB },
  { id: 'dm-sans', name: 'DM Sans', cat: 'Sans', gf: 'DM Sans', ital: true, fb: SANS_FB },
  { id: 'plex-sans', name: 'IBM Plex Sans', cat: 'Sans', gf: 'IBM Plex Sans', ital: true, fb: SANS_FB },
  { id: 'roboto', name: 'Roboto', cat: 'Sans', gf: 'Roboto', ital: true, fb: SANS_FB },
  { id: 'rubik', name: 'Rubik', cat: 'Sans', gf: 'Rubik', ital: true, fb: SANS_FB },
  { id: 'karla', name: 'Karla', cat: 'Sans', gf: 'Karla', ital: true, fb: SANS_FB },
  { id: 'quicksand', name: 'Quicksand', cat: 'Sans', gf: 'Quicksand', ital: false, fb: SANS_FB },
  { id: 'noto-sans', name: 'Noto Sans', cat: 'Sans', gf: 'Noto Sans', ital: true, fb: SANS_FB },
  // Easier on the eyes
  { id: 'atkinson', name: 'Atkinson Hyperlegible', cat: 'Easy reading', gf: 'Atkinson Hyperlegible', ital: true, fb: SANS_FB },
  { id: 'lexend', name: 'Lexend', cat: 'Easy reading', gf: 'Lexend', ital: false, fb: SANS_FB },
  // Mono
  { id: 'plex-mono', name: 'IBM Plex Mono', cat: 'Mono', gf: 'IBM Plex Mono', ital: true, fb: MONO_FB },
  { id: 'jetbrains', name: 'JetBrains Mono', cat: 'Mono', gf: 'JetBrains Mono', ital: true, fb: MONO_FB },
  // System (no download)
  { id: 'sys-serif', name: 'System serif', cat: 'System', gf: null, stack: 'Charter, "Iowan Old Style", "Palatino Linotype", Georgia, serif' },
  { id: 'sys-sans', name: 'System sans', cat: 'System', gf: null, stack: SANS_FB },
  { id: 'georgia', name: 'Georgia', cat: 'System', gf: null, stack: 'Georgia, "Times New Roman", serif' },
];

export const FONT_CATEGORIES = ['Serif', 'Sans', 'Easy reading', 'Mono', 'System'];

const custom = new Map(); // id -> {id,name,family,cat:'Yours'}
const loaded = new Set();

export const allFonts = () => [...FONTS, ...custom.values()];
export const fontById = (id) => allFonts().find((f) => f.id === id) || FONTS[0];

export function familyStack(font) {
  if (font.stack) return font.stack;
  if (font.custom) return `"${font.family}", ${SERIF_FB}`;
  return `"${font.gf}", ${font.fb}`;
}

/** Inject the Google Fonts stylesheet for a family (once). Retries without italics if that request is rejected. */
export function loadFont(font, plain = false) {
  if (!font || !font.gf || (loaded.has(font.id) && !plain)) return;
  loaded.add(font.id);
  const fam = encodeURIComponent(font.gf).replace(/%20/g, '+');
  const spec = font.ital && !plain ? 'ital,wght@0,400;0,700;1,400;1,700' : 'wght@400;700';
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${fam}:${spec}&display=swap`;
  link.dataset.folioFont = font.id;
  link.onerror = () => { link.remove(); if (!plain && font.ital) loadFont(font, true); else loaded.delete(font.id); };
  document.head.append(link);
}

/* ---- user-supplied fonts (.ttf / .otf / .woff / .woff2), stored locally ---- */
async function registerCustom(rec) {
  const family = `FolioCustom-${rec.id}`;
  const face = new FontFace(family, rec.data);
  await face.load();
  document.fonts.add(face);
  const font = { id: `custom-${rec.id}`, name: rec.name, family, cat: 'Yours', custom: true, gf: null, rawId: rec.id };
  custom.set(font.id, font);
  return font;
}

export async function restoreCustomFonts() {
  try {
    const rows = (await dbAll('kv')).filter((r) => r.key.startsWith('font:'));
    for (const r of rows) { try { await registerCustom(r.value); } catch { /* corrupt font – skip */ } }
  } catch { /* storage unavailable */ }
}

export async function addCustomFont(file) {
  const data = await file.arrayBuffer();
  const id = Math.random().toString(36).slice(2, 9);
  const name = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
  const rec = { id, name, data };
  const font = await registerCustom(rec);
  await dbPut('kv', { key: `font:${id}`, value: rec });
  return font;
}

export async function removeCustomFont(font) {
  custom.delete(font.id);
  await dbDelete('kv', `font:${font.rawId}`);
}
