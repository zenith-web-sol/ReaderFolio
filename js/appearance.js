// Right drawer: themes, fonts, spacing, layout and eye-comfort controls. Every change applies live.
import { settings, set, onSettings, PRESETS, RANGES, DEFAULTS, resetTypography } from './settings.js';
import { THEMES, resolveTheme } from './themes.js';
import { FONT_CATEGORIES, allFonts, fontById, loadFont, familyStack, addCustomFont, removeCustomFont } from './fonts.js';
import { h, icon, $, clamp } from './util.js';
import { toast } from './ui.js';
import { openDrawer } from './ui.js';

const refreshers = [];
let built = false;
let fontFilter = { q: '', cat: 'All' };
let fontIO = null;

const fmt = {
  px: (v) => `${v}px`, x: (v) => v.toFixed(2).replace(/0$/, ''), em: (v) => `${(+v).toFixed(2).replace(/\.?0+$/, '') || 0} em`,
  ch: (v) => `${v} ch`, pct: (v) => `${v}%`, min: (v) => `${v} min`,
};

function section(title, ...kids) { return h('section', { class: 'ap-sec' }, h('h3', null, title), ...kids); }

function slider(key, label, format, { unit } = {}) {
  const [min, max, step] = RANGES[key];
  const input = h('input', { type: 'range', min, max, step, 'aria-label': label });
  const out = h('output', null);
  const dec = h('button', { class: 'icon-btn sm', 'aria-label': `Decrease ${label.toLowerCase()}`, onclick: () => nudge(-1) }, icon('minus'));
  const inc = h('button', { class: 'icon-btn sm', 'aria-label': `Increase ${label.toLowerCase()}`, onclick: () => nudge(1) }, icon('plus'));
  const nudge = (dir) => { const v = clamp(+(settings[key] + dir * step).toFixed(4), min, max); set({ [key]: v }); };
  input.addEventListener('input', () => set({ [key]: +input.value }));
  const update = () => { input.value = settings[key]; input.style.setProperty('--pf', String((settings[key] - min) / (max - min))); out.textContent = format(settings[key]); };
  refreshers.push(update);
  void unit;
  return h('div', { class: 'ctl' }, h('div', { class: 'ctl-head' }, h('label', null, label), out), h('div', { class: 'ctl-row' }, dec, input, inc));
}

function segmented(key, label, options, { onChange } = {}) {
  const wrap = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
  const btns = options.map(([value, text]) => {
    const b = h('button', { role: 'radio', 'aria-checked': 'false', onclick: () => { set({ [key]: value }); onChange?.(value); } }, text);
    b.dataset.v = String(value);
    wrap.append(b);
    return [value, b];
  });
  refreshers.push(() => btns.forEach(([v, b]) => b.setAttribute('aria-checked', String(settings[key] === v))));
  return h('div', { class: 'ctl' }, h('div', { class: 'ctl-head' }, h('label', null, label)), wrap);
}

function toggle(key, label, desc) {
  const b = h('button', { class: 'switch', role: 'switch', 'aria-checked': 'false', 'aria-label': label, onclick: () => set({ [key]: !settings[key] }) }, h('span', { class: 'knob' }));
  refreshers.push(() => b.setAttribute('aria-checked', String(!!settings[key])));
  return h('div', { class: 'ctl toggle' }, h('div', { class: 'toggle-text' }, h('div', { class: 'toggle-label' }, label), desc ? h('div', { class: 'muted small' }, desc) : null), b);
}

/* ------------------------------------------------------------------ themes */
function themeSection() {
  const grid = h('div', { class: 'themes', role: 'radiogroup', 'aria-label': 'Colour theme' });
  const tile = (id, t, name, extra) => {
    const b = h('button', { class: 'theme-tile', role: 'radio', 'aria-checked': 'false', title: name, onclick: () => set({ theme: id }) },
      h('span', { class: 'swatch', style: { background: t.bg, color: t.text, borderColor: t.line } },
        h('span', { class: 'sw-aa', style: { fontFamily: 'var(--serif-ui)' } }, 'Aa'),
        h('span', { class: 'sw-lines' }, h('i', { style: { background: t.muted } }), h('i', { style: { background: t.muted } }), h('i', { style: { background: t.accent } }))),
      h('span', { class: 'theme-name' }, name, extra || ''));
    b.dataset.id = id;
    return b;
  };
  const tiles = [tile('auto', resolveTheme('auto'), 'Auto', ''), ...THEMES.map((t) => tile(t.id, t, t.name))];
  tiles.forEach((t) => grid.append(t));
  const filter = h('div', { class: 'seg compact', role: 'group', 'aria-label': 'Filter themes' },
    ...[['all', 'All'], ['light', 'Light'], ['dark', 'Dark']].map(([v, text]) => h('button', {
      'aria-pressed': v === 'all' ? 'true' : 'false', onclick: (e) => {
        filter.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === e.currentTarget)));
        tiles.forEach((t) => { const th = THEMES.find((x) => x.id === t.dataset.id); t.hidden = v !== 'all' && (!th || th.mode !== v) && t.dataset.id !== 'auto'; });
      } }, text)));
  refreshers.push(() => {
    tiles.forEach((t) => t.setAttribute('aria-checked', String(settings.theme === t.dataset.id)));
    const auto = tiles[0].querySelector('.swatch'); const r = resolveTheme('auto');
    auto.style.background = r.bg; auto.style.color = r.text; auto.style.borderColor = r.line;
  });
  return section('Theme', h('p', { class: 'muted small ap-hint' }, 'Auto follows your device’s light or dark setting.'), filter, grid);
}

/* ------------------------------------------------------------------- fonts */
function fontRow(f) {
  const row = h('div', { class: 'font-row' },
    h('button', { class: 'font-btn', role: 'radio', 'aria-checked': 'false', onclick: () => set({ font: f.id }) },
      h('span', { class: 'font-sample', style: { fontFamily: familyStack(f) } }, f.name),
      h('span', { class: 'font-cat muted small' }, f.cat)),
    f.custom ? h('button', { class: 'icon-btn sm', 'aria-label': `Remove ${f.name}`, onclick: async () => { await removeCustomFont(f); if (settings.font === f.id) set({ font: DEFAULTS.font }); renderFonts(); } }, icon('trash')) : null);
  row.dataset.id = f.id;
  if (fontIO && f.gf) { row._font = f; fontIO.observe(row); }
  return row;
}

let fontList;
function renderFonts() {
  if (!fontList) return;
  const { q, cat } = fontFilter;
  const list = allFonts().filter((f) => (cat === 'All' || f.cat === cat) && f.name.toLowerCase().includes(q.toLowerCase()));
  fontList.replaceChildren(...(list.length ? list.map(fontRow) : [h('p', { class: 'muted small pane-hint' }, 'No fonts match.')]));
  paintFontChecks();
}
function paintFontChecks() {
  fontList?.querySelectorAll('.font-row').forEach((r) => r.querySelector('.font-btn').setAttribute('aria-checked', String(r.dataset.id === settings.font)));
}

function fontSection() {
  fontIO = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { loadFont(e.target._font); fontIO.unobserve(e.target); }
  }, { root: null, rootMargin: '120px' });

  const preview = h('div', { class: 'preview', 'aria-hidden': 'true' },
    h('p', null, 'Call me Ishmael. Some years ago—never mind how long precisely—having little or no money in my purse, and nothing particular to interest me on shore, I thought I would sail about a little and see the watery part of the world.'));
  refreshers.push(() => preview.classList.toggle('is-justify', settings.align === 'justify'));

  const search = h('input', { type: 'search', placeholder: 'Search fonts', 'aria-label': 'Search fonts', autocomplete: 'off' });
  search.addEventListener('input', () => { fontFilter.q = search.value; renderFonts(); });
  const cats = ['All', ...FONT_CATEGORIES];
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Font categories' }, cats.map((c) => h('button', {
    class: 'chip', 'aria-pressed': c === 'All' ? 'true' : 'false',
    onclick: (e) => { fontFilter.cat = c; chips.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', String(x === e.currentTarget))); renderFonts(); } }, c)));
  fontList = h('div', { class: 'font-list', role: 'radiogroup', 'aria-label': 'Reading font' });
  const addBtn = h('button', { class: 'link-btn', onclick: () => $('#font-input').click() }, icon('upload'), 'Use your own font file');
  $('#font-input').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { const font = await addCustomFont(f); fontFilter = { q: '', cat: 'All' }; set({ font: font.id }); renderFonts(); toast(`${font.name} added`); } catch { toast('That font file could not be read.'); }
  });
  refreshers.push(paintFontChecks);
  return section('Font', preview, h('div', { class: 'font-search' }, icon('search'), search), chips, fontList, addBtn);
}

/* ----------------------------------------------------------------- compose */
function build() {
  const body = $('#appearance-body');
  const presets = h('div', { class: 'chips presets', role: 'group', 'aria-label': 'Typography presets' },
    [['comfort', 'Comfort'], ['book', 'Book page'], ['large', 'Large print'], ['compact', 'Compact'], ['novel', 'Web novel'], ['easy', 'Easy reading']].map(([id, name]) =>
      h('button', { class: 'chip', onclick: () => { set(PRESETS[id]); renderFonts(); } }, name)));

  body.replaceChildren(
    themeSection(),
    fontSection(),
    section('Text',
      presets,
      slider('size', 'Text size', fmt.px),
      slider('lh', 'Line spacing', (v) => v.toFixed(2)),
      slider('para', 'Paragraph spacing', fmt.em),
      slider('ls', 'Letter spacing', fmt.em),
      slider('ws', 'Word spacing', fmt.em),
      slider('width', 'Line width', fmt.ch),
      segmented('weight', 'Weight', [[400, 'Regular'], [700, 'Bold']]),
      segmented('align', 'Alignment', [['left', 'Left'], ['justify', 'Justified']]),
      toggle('hyphens', 'Hyphenation', 'Breaks long words at the line end'),
      toggle('indent', 'First-line indent', 'Book-style paragraphs'),
      toggle('dropcap', 'Drop caps', 'Large first letter of each chapter'),
      h('button', { class: 'link-btn', onclick: () => { resetTypography(); renderFonts(); } }, icon('reset'), 'Reset text settings')),
    section('Layout',
      segmented('layout', 'Page style', [['scroll', 'Scrolling'], ['paged', 'Pages']]),
      segmented('spread', 'Pages per view', [['auto', 'Auto'], ['single', 'One'], ['double', 'Two']])),
    section('Eye comfort',
      slider('dim', 'Dim screen', fmt.pct),
      slider('warm', 'Warm filter', fmt.pct),
      toggle('ruler', 'Reading ruler', 'Spotlights the lines you are on')),
    section('Original PDF pages',
      toggle('pdfTint', 'Match theme', 'Recolour pages to your theme'),
      slider('pdfZoom', 'Page zoom', fmt.pct)),
    section('Goal', slider('goal', 'Daily reading goal', fmt.min)));
  refresh();
  renderFonts();
}

function refresh() { refreshers.forEach((f) => f()); }

export function openAppearance() {
  if (!built) { build(); built = true; }
  refresh();
  openDrawer('drawer-right');
  setTimeout(() => $('#appearance-body .theme-tile[aria-checked=true]')?.scrollIntoView({ block: 'nearest' }), 80);
}

export function initAppearance() {
  onSettings(() => { if (built) refresh(); });
}

export { fontById };
