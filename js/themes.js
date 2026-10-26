// 19 colour themes. Every pair is checked for contrast (text ≥ 9:1 on the page, muted ≥ 4.5:1)
// so long reading sessions stay comfortable. Dark themes use softened whites, never pure #fff.

export const THEMES = [
  // ---- light
  { id: 'frost',    name: 'Frost',       mode: 'light', bg: '#eceff4', raised: '#f7f9fc', text: '#2a3140', muted: '#586377', line: '#d3d9e4', accent: '#3f6293' },
  { id: 'paper',    name: 'Paper',       mode: 'light', bg: '#f8f7f4', raised: '#ffffff', text: '#25221e', muted: '#66615a', line: '#e2dfd7', accent: '#2f5d7c' },
  { id: 'sepia',    name: 'Sepia',       mode: 'light', bg: '#f1e6d0', raised: '#f8f0df', text: '#3f3422', muted: '#6f5f47', line: '#dfd0b2', accent: '#8a5a2b' },
  { id: 'sage',     name: 'Sage',        mode: 'light', bg: '#e6ede4', raised: '#f1f6ef', text: '#223025', muted: '#506353', line: '#cdd9ca', accent: '#3b7650' },
  { id: 'mist',     name: 'Mist',        mode: 'light', bg: '#e3eef0', raised: '#f0f7f8', text: '#1d3036', muted: '#4b6871', line: '#c9dce0', accent: '#25758a' },
  { id: 'rose',     name: 'Rosewater',   mode: 'light', bg: '#f5e8eb', raised: '#fcf3f5', text: '#38232a', muted: '#745660', line: '#e6cfd5', accent: '#a0425b' },
  { id: 'lavender', name: 'Lavender',    mode: 'light', bg: '#eae7f4', raised: '#f5f3fb', text: '#2a2740', muted: '#5c587c', line: '#d5d0e9', accent: '#6050ab' },
  { id: 'solar',    name: 'Daybreak',    mode: 'light', bg: '#fbf4e0', raised: '#fffaea', text: '#2f3f46', muted: '#586d74', line: '#e8dfc4', accent: '#2d7d87' },
  { id: 'snow',     name: 'Snow',        mode: 'light', bg: '#ffffff', raised: '#f5f6f8', text: '#1a1d23', muted: '#585f6c', line: '#e3e6eb', accent: '#3a56c9' },
  // ---- dark
  { id: 'dusk',     name: 'Dusk',        mode: 'dark',  bg: '#222736', raised: '#2c3245', text: '#d9deea', muted: '#9ca6bd', line: '#394059', accent: '#92abea' },
  { id: 'midnight', name: 'Midnight',    mode: 'dark',  bg: '#10131a', raised: '#181c26', text: '#ccd2df', muted: '#8991a6', line: '#262c3b', accent: '#7ea4f4' },
  { id: 'graphite', name: 'Graphite',    mode: 'dark',  bg: '#1e1f22', raised: '#27282c', text: '#d5d5d6', muted: '#9a9ba0', line: '#36373c', accent: '#9db3cc' },
  { id: 'nord',     name: 'Nord',        mode: 'dark',  bg: '#2e3440', raised: '#3a4150', text: '#e3e8f0', muted: '#a6b0c3', line: '#444d5f', accent: '#88c0d0' },
  { id: 'forest',   name: 'Forest',      mode: 'dark',  bg: '#17201b', raised: '#1f2b24', text: '#d2ded5', muted: '#92a69a', line: '#2d3c33', accent: '#8ecb9b' },
  { id: 'mocha',    name: 'Mocha',       mode: 'dark',  bg: '#24201d', raised: '#2f2a26', text: '#e2d8cd', muted: '#a99b8c', line: '#403933', accent: '#d6a577' },
  { id: 'plum',     name: 'Plum',        mode: 'dark',  bg: '#211a28', raised: '#2b2235', text: '#dfd6e9', muted: '#a597b5', line: '#3d3049', accent: '#c79cea' },
  { id: 'ocean',    name: 'Deep Ocean',  mode: 'dark',  bg: '#0d1c26', raised: '#142836', text: '#cde0ea', muted: '#86a4b6', line: '#203949', accent: '#5fc3d8' },
  { id: 'slate',    name: 'Slate',       mode: 'dark',  bg: '#424242', raised: '#4b4b4b', text: '#f5f5f5', muted: '#c0c0c0', line: '#5c5c5c', accent: '#a3bf80' },
  { id: 'amoled',   name: 'Amoled',      mode: 'dark',  bg: '#000000', raised: '#111111', text: '#c8c8c8', muted: '#8c8c8c', line: '#262626', accent: '#8ab4f8' },
];

export const themeById = (id) => THEMES.find((t) => t.id === id);
const prefersDark = () => !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);

export function resolveTheme(id) {
  if (id === 'auto' || !themeById(id)) return themeById(prefersDark() ? 'dusk' : 'frost');
  return themeById(id);
}

const hexToRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
const rgba = (hex, a) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };

export const HIGHLIGHTS = {
  yellow: '#f2c94c',
  green: '#6fcf97',
  blue: '#6aa9f4',
  pink: '#f08fb6',
};

export function applyTheme(id) {
  const t = resolveTheme(id);
  const root = document.documentElement;
  const s = root.style;
  const dark = t.mode === 'dark';
  s.setProperty('--bg', t.bg);
  s.setProperty('--raised', t.raised);
  s.setProperty('--text', t.text);
  s.setProperty('--muted', t.muted);
  s.setProperty('--line', t.line);
  s.setProperty('--accent', t.accent);
  s.setProperty('--accent-ink', luminance(t.accent) > 0.32 ? '#101318' : '#ffffff');
  s.setProperty('--accent-soft', rgba(t.accent, dark ? 0.2 : 0.12));
  s.setProperty('--sel', rgba(t.accent, dark ? 0.4 : 0.26));
  s.setProperty('--shadow', dark ? 'rgba(0,0,0,.45)' : 'rgba(30,40,60,.14)');
  for (const [name, hex] of Object.entries(HIGHLIGHTS)) s.setProperty(`--hl-${name}`, rgba(hex, dark ? 0.34 : 0.45));
  s.setProperty('--paper', t.bg);
  s.colorScheme = t.mode;
  root.dataset.theme = t.id;
  root.dataset.mode = t.mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.bg);
  try { localStorage.setItem('folio:themeBoot', JSON.stringify({ bg: t.bg, mode: t.mode })); } catch { /* ignore */ }
  return t;
}
