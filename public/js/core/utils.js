// public/js/core/utils.js
// Date/currency formatting, debounce, escapeHtml, image compression, CSV export.
import { getState } from './store.js';

// ---- Escaping (XSS prevention) ----
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---- Dates ----
export function formatDate(date, opts = {}) {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const locale = getState().language === 'rw' ? 'rw-RW' : 'en-GB';
  return d.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric', ...opts });
}

export function formatDateTime(date) {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function toInputDate(date) {
  // yyyy-mm-dd for <input type="date">
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

export function addDays(date, days) {
  const d = new Date(date || Date.now());
  d.setDate(d.getDate() + days);
  return d;
}

export function daysUntil(date) {
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((d - now) / 86400000);
}

// ---- Currency (uses Settings) ----
export function formatMoney(amount) {
  const s = getState().settings;
  const symbol = (s && s.currencySymbol) || '';
  const num = Number(amount || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return symbol ? `${symbol} ${num}` : num;
}

// ---- Misc ----
export function debounce(fn, wait = 300) {
  let t;
  return function debounced(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

export function initials(name) {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

export function uid(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export function download(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

// ---- CSV export ----
// rows: array of plain objects. columns: [{key,label}] (optional; inferred if omitted).
export function exportCSV(filename, rows, columns) {
  if (!rows || !rows.length) { download(filename, '', 'text/csv'); return; }
  const cols = columns || Object.keys(rows[0]).map((k) => ({ key: k, label: k }));
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const header = cols.map((c) => esc(c.label)).join(',');
  const body = rows.map((r) => cols.map((c) => esc(c.key.includes('.') ? c.key.split('.').reduce((a, k) => (a == null ? a : a[k]), r) : r[c.key])).join(',')).join('\n');
  download(filename, `${header}\n${body}`, 'text/csv;charset=utf-8;');
}

// ---- Image compression ----
// Resize to max dimension, JPEG quality, keep under targetKB by reducing quality.
export function compressImage(file, { maxDim = 600, quality = 0.7, targetKB = 100 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No file'));
    if (!file.type.startsWith('image/')) return reject(new Error('Not an image file'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not load image'));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        // White background so transparent PNGs don't turn black in JPEG.
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        let q = quality;
        let dataUrl = canvas.toDataURL('image/jpeg', q);
        // Step down quality until under target size.
        let guard = 0;
        while (dataUrl.length * 0.75 / 1024 > targetKB && q > 0.3 && guard < 8) {
          q -= 0.08; guard++;
          dataUrl = canvas.toDataURL('image/jpeg', q);
        }
        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---- Parse a query string into an object ----
export function parseQuery(search) {
  const q = {};
  new URLSearchParams(search).forEach((v, k) => { q[k] = v; });
  return q;
}

export function buildQuery(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}
