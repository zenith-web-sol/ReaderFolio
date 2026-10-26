// Reader + app settings. Persisted in localStorage, applied as CSS variables.
import { applyTheme } from './themes.js';
import { fontById, familyStack, loadFont } from './fonts.js';
import { readJSON, writeJSON } from './util.js';

export const DEFAULTS = {
  theme: 'auto',
  font: 'literata',
  size: 20,          // px
  lh: 1.7,           // line height
  para: 0.8,         // paragraph spacing, em
  ls: 0,             // letter spacing, em
  ws: 0,             // word spacing, em
  width: 62,         // measure in characters
  align: 'left',     // left | justify
  hyphens: true,
  indent: false,     // first-line indent
  dropcap: false,
  weight: 400,
  layout: 'scroll',  // scroll | paged
  spread: 'auto',    // auto | single | double (paged only)
  ruler: false,
  dim: 0,            // 0–60 (%)
  warm: 0,           // 0–45 (%)
  pdfTint: true,     // recolour PDF pages to match the theme in Original view
  pdfZoom: 100,
  goal: 20,          // daily reading goal, minutes
};

export const PRESETS = {
  comfort:  { size: 20, lh: 1.7, para: 0.8, ls: 0, ws: 0, width: 62, align: 'left', hyphens: true, indent: false, weight: 400 },
  book:     { size: 19, lh: 1.55, para: 0, ls: 0, ws: 0, width: 56, align: 'justify', hyphens: true, indent: true, weight: 400 },
  large:    { size: 28, lh: 1.8, para: 1, ls: 0.01, ws: 0.04, width: 48, align: 'left', hyphens: false, indent: false, weight: 400 },
  compact:  { size: 16, lh: 1.5, para: 0.6, ls: 0, ws: 0, width: 78, align: 'left', hyphens: true, indent: false, weight: 400 },
  novel:    { font: 'roboto', size: 21, lh: 1.95, para: 1.2, ls: 0.035, ws: 0, width: 58, align: 'left', hyphens: false, indent: false, weight: 400 },
  easy:     { font: 'lexend', size: 22, lh: 1.9, para: 1.1, ls: 0.03, ws: 0.12, width: 52, align: 'left', hyphens: false, indent: false, weight: 400 },
};

export const RANGES = {
  size: [14, 40, 1], lh: [1.2, 2.4, 0.05], para: [0, 2, 0.1], ls: [-0.02, 0.12, 0.005],
  ws: [0, 0.5, 0.02], width: [30, 100, 1], dim: [0, 60, 1], warm: [0, 45, 1], pdfZoom: [60, 220, 5], goal: [5, 240, 5],
};

export const settings = { ...DEFAULTS, ...readJSON('folio:settings', {}) };
const listeners = new Set();

export const onSettings = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export function applySettings() {
  const root = document.documentElement;
  const s = settings;
  const font = fontById(s.font);
  loadFont(font);
  root.style.setProperty('--read-font', familyStack(font));
  root.style.setProperty('--f-size', `${s.size}px`);
  root.style.setProperty('--f-lh', String(s.lh));
  root.style.setProperty('--f-para', `${s.para}em`);
  root.style.setProperty('--f-ls', `${s.ls}em`);
  root.style.setProperty('--f-ws', `${s.ws}em`);
  root.style.setProperty('--f-width', String(s.width));
  root.style.setProperty('--f-weight', String(s.weight));
  root.dataset.align = s.align;
  root.dataset.hyphens = s.hyphens ? 'on' : 'off';
  root.dataset.indent = s.indent ? 'on' : 'off';
  root.dataset.dropcap = s.dropcap ? 'on' : 'off';
  root.dataset.layout = s.layout;
  root.dataset.pdftint = s.pdfTint ? 'on' : 'off';
  root.style.setProperty('--dim', String(s.dim / 100));
  root.style.setProperty('--warm', String(s.warm / 100));
  applyTheme(s.theme);
}

export function set(patch, { silent = false } = {}) {
  Object.assign(settings, patch);
  writeJSON('folio:settings', settings);
  applySettings();
  if (!silent) for (const fn of listeners) fn(patch);
}

export function resetTypography() {
  const keys = ['font', 'size', 'lh', 'para', 'ls', 'ws', 'width', 'align', 'hyphens', 'indent', 'dropcap', 'weight'];
  const patch = {};
  for (const k of keys) patch[k] = DEFAULTS[k];
  set(patch);
}

if (window.matchMedia) {
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (settings.theme === 'auto') applySettings();
  });
}
