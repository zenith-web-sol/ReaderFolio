// Read aloud with the browser's built-in speech voices (nothing is sent anywhere).
import { readJSON, writeJSON, setIcon, $ } from './util.js';
import { toast } from './ui.js';

let host = null;
let active = false, playing = false;
let cur = null;          // {c,b}
let chunks = [], idx = 0, token = 0;
const prefs = { rate: 1, voice: '', ...readJSON('folio:tts', {}) };

export const isActive = () => active;
export const isPlaying = () => active && playing;
const supported = () => 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

function splitText(text) {
  const sentences = text.match(/[^.!?…]+(?:[.!?…]+["”’')\]]*|$)\s*/g) || [text];
  const out = [];
  let buf = '';
  for (const s of sentences) {
    if ((buf + s).length > 240 && buf) { out.push(buf.trim()); buf = s; } else buf += s;
    while (buf.length > 320) { const cut = buf.lastIndexOf(' ', 280); const at = cut > 80 ? cut : 280; out.push(buf.slice(0, at).trim()); buf = buf.slice(at); }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function voices() { try { return speechSynthesis.getVoices(); } catch { return []; } }

function fillVoices() {
  const sel = $('#tts-voice');
  if (!sel) return;
  const all = voices();
  if (!all.length) return;
  const lang = (navigator.language || 'en').slice(0, 2).toLowerCase();
  const sorted = [...all].sort((a, b) => (b.lang.toLowerCase().startsWith(lang) - a.lang.toLowerCase().startsWith(lang)) || a.name.localeCompare(b.name));
  sel.replaceChildren(...sorted.map((v) => { const o = document.createElement('option'); o.value = v.voiceURI; o.textContent = `${v.name} (${v.lang})`; return o; }));
  const have = sorted.find((v) => v.voiceURI === prefs.voice) || sorted.find((v) => v.default) || sorted[0];
  sel.value = have.voiceURI;
}

function setBar() {
  const bar = $('#tts-bar');
  bar.hidden = !active;
  const btn = $('#tts-play');
  setIcon(btn.querySelector('svg'), playing ? 'pause' : 'play');
  btn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  document.getElementById('r-listen')?.classList.toggle('on', active);
}

function speakChunk() {
  const my = ++token;
  speechSynthesis.cancel();
  if (idx >= chunks.length) { nextBlock(); return; }
  const u = new SpeechSynthesisUtterance(chunks[idx]);
  const v = voices().find((x) => x.voiceURI === prefs.voice);
  if (v) { u.voice = v; u.lang = v.lang; }
  u.rate = prefs.rate;
  u.onend = () => { if (my !== token || !playing) return; idx++; speakChunk(); };
  u.onerror = (e) => { if (my !== token) return; if (e.error === 'interrupted' || e.error === 'canceled') return; stop(); toast('Read aloud stopped. This browser could not play the voice.'); };
  setTimeout(() => { if (my === token) speechSynthesis.speak(u); }, 40);   // avoids Chrome dropping speak() right after cancel()
}

function loadBlock(c, b) {
  cur = { c, b };
  chunks = splitText(host.blockText(c, b));
  idx = 0;
  host.speaking(c, b);
  host.reveal(c, b);
}
function nextBlock() {
  const n = cur && host.nextBlock(cur.c, cur.b);
  if (!n) { stop(); toast('Reached the end of the book'); return; }
  loadBlock(n.c, n.b);
  speakChunk();
}
function prevBlock() {
  const p = cur && host.prevBlock(cur.c, cur.b);
  if (!p) return;
  loadBlock(p.c, p.b);
  if (playing) speakChunk();
}

export function start() {
  if (!supported()) { toast('Your browser can’t read aloud. Try Chrome, Edge or Safari.'); return; }
  if (active) { stop(); return; }
  const pos = host.pos();
  active = true; playing = true;
  fillVoices();
  loadBlock(pos.c, pos.b);
  setBar();
  speakChunk();
}

export function stop() {
  token++;
  try { speechSynthesis.cancel(); } catch { /* ignore */ }
  active = false; playing = false; cur = null;
  host?.speaking(null);
  setBar();
}

export function toggle() {
  if (!active) return;
  playing = !playing;
  if (playing) speakChunk(); else { token++; speechSynthesis.cancel(); }
  setBar();
}

export function initTts(hostApi) {
  host = hostApi;
  if (supported()) {
    fillVoices();
    speechSynthesis.addEventListener?.('voiceschanged', fillVoices);
  }
  $('#tts-play').addEventListener('click', toggle);
  $('#tts-close').addEventListener('click', stop);
  $('#tts-next').addEventListener('click', () => { if (active) { playing = true; nextBlock(); setBar(); } });
  $('#tts-prev').addEventListener('click', () => { if (active) { playing = true; prevBlock(); setBar(); } });
  const rate = $('#tts-rate');
  rate.value = String(prefs.rate);
  rate.addEventListener('change', () => { prefs.rate = +rate.value; writeJSON('folio:tts', prefs); if (playing) speakChunk(); });
  $('#tts-voice').addEventListener('change', (e) => { prefs.voice = e.target.value; writeJSON('folio:tts', prefs); if (playing) speakChunk(); });
  window.addEventListener('pagehide', () => { try { speechSynthesis.cancel(); } catch { /* ignore */ } });
}
