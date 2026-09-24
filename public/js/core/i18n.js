// public/js/core/i18n.js
// English + Kinyarwanda dictionaries, t(key) helper, instant language switch.
import { getState, set, subscribe } from './store.js';
import en from '../locales/en.js';
import rw from '../locales/rw.js';

const dictionaries = { en, rw };

export function getLanguages() {
  return [
    { code: 'en', label: 'English' },
    { code: 'rw', label: 'Kinyarwanda' }
  ];
}

export function setLanguage(code) {
  if (dictionaries[code]) set({ language: code });
}

// t('books.title', { name: 'x' }) -> looks up in current dict, falls back to English.
export function t(key, vars) {
  const lang = getState().language;
  const dict = dictionaries[lang] || en;
  let value = lookup(dict, key);
  if (value === undefined) value = lookup(en, key);
  if (value === undefined) value = key; // last resort: show the key
  if (vars && typeof value === 'string') {
    for (const [k, v] of Object.entries(vars)) {
      value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
  }
  return value;
}

function lookup(obj, path) {
  return path.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

// Re-render the whole app shell + current view when the language changes.
let onChangeCallback = null;
export function onLanguageChange(fn) {
  onChangeCallback = fn;
}
subscribe('language', () => {
  document.documentElement.lang = getState().language;
  if (typeof onChangeCallback === 'function') onChangeCallback();
});

// Convenience: translate every [data-i18n] node in a subtree.
export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
  });
}
