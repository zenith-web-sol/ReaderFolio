// Toasts, dialogs, popup menus and drawers.
import { h, icon, $ } from './util.js';

/* ------------------------------------------------------------------ toasts */
export function toast(message, { action, onAction, timeout = 3800 } = {}) {
  const host = $('#toasts');
  const el = h('div', { class: 'toast', role: 'status' }, h('span', null, message));
  if (action) el.append(h('button', { class: 'toast-act', onclick: () => { onAction?.(); close(); } }, action));
  host.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  const close = () => { el.classList.remove('in'); setTimeout(() => el.remove(), 250); };
  if (timeout) setTimeout(close, timeout);
  return close;
}

/* ----------------------------------------------------------------- dialogs */
function runDialog(build) {
  const dlg = $('#dialog');
  return new Promise((resolve) => {
    dlg.replaceChildren();
    const finish = (v) => { dlg.removeEventListener('close', onClose); dlg.close(); resolve(v); };
    const onClose = () => resolve(null);
    dlg.addEventListener('close', onClose, { once: true });
    build(dlg, finish);
    dlg.showModal();
  });
}

export function confirmDialog({ title, body, confirm = 'OK', cancel = 'Cancel', danger = false }) {
  return runDialog((dlg, finish) => {
    dlg.append(
      h('h3', null, title),
      body ? h('p', null, body) : null,
      h('div', { class: 'dlg-actions' },
        h('button', { class: 'btn', onclick: () => finish(false) }, cancel),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, autofocus: true, onclick: () => finish(true) }, confirm)),
    );
  }).then((v) => v === true);
}

export function promptDialog({ title, value = '', label = '', confirm = 'Save', multiline = false }) {
  return runDialog((dlg, finish) => {
    const input = multiline ? h('textarea', { rows: 4 }) : h('input', { type: 'text' });
    input.value = value;
    input.setAttribute('aria-label', label || title);
    const form = h('form', { onsubmit: (e) => { e.preventDefault(); finish(input.value.trim()); } },
      h('h3', null, title),
      label ? h('label', { class: 'dlg-label' }, label) : null,
      input,
      h('div', { class: 'dlg-actions' },
        h('button', { type: 'button', class: 'btn', onclick: () => finish(null) }, 'Cancel'),
        h('button', { type: 'submit', class: 'btn primary' }, confirm)));
    dlg.append(form);
    setTimeout(() => { input.focus(); input.select?.(); }, 30);
  });
}

export function infoDialog({ title, rows }) {
  return runDialog((dlg, finish) => {
    dlg.append(
      h('h3', null, title),
      h('dl', { class: 'info-list' }, rows.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
      h('div', { class: 'dlg-actions' }, h('button', { class: 'btn primary', autofocus: true, onclick: () => finish(true) }, 'Close')));
  });
}

/* ------------------------------------------------------------------ menus */
let menuCleanup = null;
export function closeMenu() { if (menuCleanup) menuCleanup(); }

/** items: [{label, icon, onClick, danger, disabled, checked}] | {heading} | 'sep'. anchor: Element or {x,y}. */
export function showMenu(items, anchor, { align = 'right', minWidth = 0 } = {}) {
  closeMenu();
  const menu = $('#menu');
  menu.replaceChildren();
  menu.style.minWidth = minWidth ? `${minWidth}px` : '';
  menu.style.transformOrigin = align === 'left' ? 'top left' : 'top right';
  for (const it of items) {
    if (it === 'sep') { menu.append(h('div', { class: 'menu-sep', role: 'separator' })); continue; }
    if (it.heading) { menu.append(h('div', { class: 'menu-head' }, it.heading)); continue; }
    const radio = it.checked !== undefined;
    menu.append(h('button', {
      class: `menu-item${it.danger ? ' danger' : ''}${it.checked ? ' on' : ''}`, role: radio ? 'menuitemradio' : 'menuitem', 'aria-checked': radio ? String(!!it.checked) : null, disabled: it.disabled,
      onclick: () => { closeMenu(); it.onClick?.(); },
    }, it.icon ? icon(it.icon) : radio ? null : h('span', { class: 'ico-gap' }), h('span', { class: 'menu-label' }, it.label), radio && it.checked ? icon('check', 'ico menu-check') : null));
  }
  menu.hidden = false;
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let x, y;
  if (anchor instanceof Element) {
    const r = anchor.getBoundingClientRect();
    x = align === 'left' ? r.left : r.right - mw; y = r.bottom + 6;
    if (y + mh > innerHeight - 8) y = r.top - mh - 6;
  } else { x = anchor.x; y = anchor.y; }
  x = Math.max(8, Math.min(x, innerWidth - mw - 8));
  y = Math.max(8, Math.min(y, innerHeight - mh - 8));
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.querySelector('.menu-item:not([disabled])')?.focus({ preventScroll: true });

  const onDown = (e) => { if (!menu.contains(e.target)) closeMenu(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const els = [...menu.querySelectorAll('.menu-item:not([disabled])')];
      const i = els.indexOf(document.activeElement);
      els[(i + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length]?.focus();
    }
  };
  setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', closeMenu);
  menuCleanup = () => {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', closeMenu);
    menu.hidden = true;
    menuCleanup = null;
  };
}

/* ---------------------------------------------------------------- drawers */
let openId = null;
let opener = null;
const scrim = () => $('#scrim');

export const drawerOpenId = () => openId;

export function openDrawer(id) {
  if (openId === id) return;
  if (openId) closeDrawers({ restoreFocus: false });
  const d = document.getElementById(id);
  opener = document.activeElement;
  d.hidden = false;
  scrim().hidden = false;
  openId = id;
  document.body.dataset.drawer = id;
  requestAnimationFrame(() => requestAnimationFrame(() => { d.classList.add('open'); scrim().classList.add('open'); }));
  setTimeout(() => (d.querySelector('[role=tab][aria-selected=true], .drawer-body input, .drawer-body button') || d).focus?.({ preventScroll: true }), 60);
}

export function closeDrawers({ restoreFocus = true } = {}) {
  if (!openId) return;
  const d = document.getElementById(openId);
  d.classList.remove('open');
  scrim().classList.remove('open');
  const done = () => { d.hidden = true; if (!openId) scrim().hidden = true; };
  openId = null;
  delete document.body.dataset.drawer;
  setTimeout(done, 240);
  if (restoreFocus && opener?.focus) opener.focus({ preventScroll: true });
  opener = null;
}

export function initDrawers() {
  scrim().addEventListener('click', () => closeDrawers());
  document.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeDrawers(); });
}

/** Replaces a native <select> with a styled dropdown button + menu; the select stays the source of truth. */
export function enhanceSelect(sel, { compact = false } = {}) {
  const label = h('span', { class: 'dd-label' });
  const btn = h('button', { type: 'button', class: `dd${compact ? ' compact' : ''}`, 'aria-haspopup': 'menu', 'aria-label': sel.getAttribute('aria-label') || 'Choose an option' }, label, icon('chev-down'));
  const sync = () => { label.textContent = sel.selectedOptions[0]?.textContent || ''; };
  sel.style.display = 'none';
  sel.after(btn);
  sel.addEventListener('change', sync);
  new MutationObserver(sync).observe(sel, { childList: true, subtree: true });
  sync();
  btn.addEventListener('click', () => {
    showMenu([...sel.options].map((o) => ({
      label: o.textContent, checked: o.value === sel.value,
      onClick: () => { sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true })); btn.focus(); },
    })), btn, { align: 'left', minWidth: btn.offsetWidth });
  });
  return btn;
}
