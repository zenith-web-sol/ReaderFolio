// Folio: boot, routing and global keyboard handling.
import { applySettings, settings } from './settings.js';
import { restoreCustomFonts } from './fonts.js';
import { loadBooks } from './store.js';
import { initDrawers, closeDrawers, drawerOpenId, closeMenu, toast, enhanceSelect } from './ui.js';
import { initLibrary, renderLibrary, loadCovers } from './library.js';
import { initReader, openBook, closeBook, handleKey, current } from './reader.js';
import { initAppearance, openAppearance } from './appearance.js';
import { initStats, loadStats, openStats } from './stats.js';
import { openKeys } from './keys.js';
import { $ } from './util.js';

const viewLib = () => $('#view-library');
const viewRead = () => $('#view-reader');
const inReader = () => !viewRead().hidden;

async function route() {
  const m = location.hash.match(/^#\/read\/([\w-]+)/);
  closeMenu();
  closeDrawers({ restoreFocus: false });
  $('#toasts').replaceChildren();
  document.body.dataset.view = m ? 'reader' : 'library';
  if (m) {
    viewLib().hidden = true;
    viewRead().hidden = false;
    await openBook(m[1]);
  } else {
    await closeBook();
    viewRead().hidden = true;
    viewLib().hidden = false;
    renderLibrary();
  }
}

function onKey(e) {
  if (e.defaultPrevented) return;
  if (document.querySelector('dialog[open]')) return;
  const t = e.target;
  const typing = t?.matches?.('input:not([type=range]):not([type=checkbox]), textarea, select, [contenteditable=true]');
  if (e.key === 'Escape') {
    if (drawerOpenId()) { closeDrawers(); e.preventDefault(); return; }
    const pop = $('#sel-pop');
    if (pop && !pop.hidden) { pop.hidden = true; return; }
    if (inReader() && !typing) { location.hash = '#/'; e.preventDefault(); }
    else if (typing && t.type === 'search' && t.value) { t.value = ''; t.dispatchEvent(new Event('input')); }
    return;
  }
  if (typing) return;
  const onControl = t?.matches?.('button, a, [role=tab], [role=radio], [role=switch], summary');
  if (onControl && (e.key === ' ' || e.key === 'Enter')) return;
  if (inReader()) { if (handleKey(e)) e.preventDefault(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '/') { $('#lib-q').focus(); e.preventDefault(); }
  else if (e.key === 'a') { openAppearance(); e.preventDefault(); }
  else if (e.key === 'i') { openStats(); e.preventDefault(); }
  else if (e.key === '?') { openKeys(); e.preventDefault(); }
}

async function boot() {
  applySettings();
  try { await restoreCustomFonts(); } catch { /* ignore */ }
  applySettings();
  initDrawers();
  initAppearance();
  initLibrary();
  initReader();
  initStats(() => current());
  enhanceSelect($('#lib-sort'));
  enhanceSelect($('#tts-rate'), { compact: true });
  enhanceSelect($('#tts-voice'), { compact: true });
  $('#lib-appearance').addEventListener('click', openAppearance);
  $('#lib-stats').addEventListener('click', openStats);
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', route);

  try {
    await Promise.all([loadBooks(), loadCovers(), loadStats()]);
  } catch (e) {
    $('#view-library').hidden = false;
    $('#empty').hidden = false;
    toast(e?.message || 'Your browser is blocking local storage, so Folio cannot keep books. Try a normal (not private) window.', { timeout: 0 });
    return;
  }
  document.documentElement.dataset.ready = '1';
  await route();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
void settings;
