// Keyboard shortcut cheat sheet.
import { h, icon, $ } from './util.js';

const GROUPS = [
  ['Moving', [
    ['Space · Page Down', 'Next screen or page'],
    ['Shift+Space · Page Up', 'Previous screen or page'],
    ['← →', 'Turn pages (page style)'],
    ['↓ ↑ · J K', 'Scroll a little'],
    ['[  ]', 'Previous or next chapter'],
    ['Home · End', 'Start or end of the book'],
  ]],
  ['Panels', [
    ['C', 'Contents'],
    ['/', 'Search in book'],
    ['N', 'Highlights and bookmarks'],
    ['A', 'Appearance'],
    ['I', 'Reading insights'],
  ]],
  ['Reading', [
    ['B', 'Bookmark this spot'],
    ['L', 'Read aloud'],
    ['O', 'Original pages or reading view'],
    ['+  −', 'Bigger or smaller text'],
    ['T', 'Next theme'],
    ['H', 'Hide or show the toolbars'],
    ['F', 'Full screen'],
    ['Esc', 'Close a panel, or go back to the library'],
  ]],
];

export function openKeys() {
  const dlg = $('#keys-dlg');
  dlg.replaceChildren(
    h('div', { class: 'stats-head' }, h('h2', null, 'Keyboard shortcuts'), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => dlg.close() }, icon('x'))),
    ...GROUPS.map(([title, rows]) => h('section', { class: 'keys-group' }, h('h3', null, title),
      h('dl', { class: 'keys' }, rows.flatMap(([k, d]) => [h('dt', null, k.split(' · ').map((x, i) => [i ? ' or ' : '', h('kbd', null, x)])), h('dd', null, d)])))));
  if (!dlg.open) dlg.showModal();
}
