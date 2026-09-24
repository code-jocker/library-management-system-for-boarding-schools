// public/js/components/dropdown.js
// Small dropdown menu attached to a trigger button (row actions, profile menu).
import { uid } from '../core/utils.js';

const openMenus = new Set();

function closeAll(except) {
  openMenus.forEach((m) => { if (m !== except) m.close(); });
}

/**
 * @param {HTMLElement} trigger  the button that toggles the menu
 * @param {Array} items  [{ label, icon, onClick, danger, href, divider }]
 */
export function attachDropdown(trigger, items) {
  const id = uid('dd');
  let menu = null;

  const close = () => {
    if (menu) { menu.remove(); menu = null; openMenus.delete(api); }
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', outside, true);
    document.removeEventListener('keydown', onKey);
  };

  const outside = (e) => { if (menu && !menu.contains(e.target) && !trigger.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  const open = () => {
    closeAll(api);
    trigger.setAttribute('aria-expanded', 'true');
    menu = document.createElement('div');
    menu.id = id;
    menu.className = 'absolute right-0 mt-2 w-48 bg-white dark:bg-slate-800 rounded-card shadow-card border border-slate-200 dark:border-slate-700 py-1 z-50';
    menu.setAttribute('role', 'menu');
    items.forEach((it) => {
      if (it.divider) { menu.insertAdjacentHTML('beforeend', '<div class="my-1 border-t border-slate-100 dark:border-slate-700"></div>'); return; }
      const el = document.createElement(it.href ? 'a' : 'button');
      el.className = `w-full flex items-center gap-2 px-3 py-2 text-sm text-left ${it.danger ? 'text-danger hover:bg-red-50 dark:hover:bg-red-900/20' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'}`;
      if (it.href) el.href = it.href;
      el.setAttribute('role', 'menuitem');
      el.innerHTML = `${it.icon ? `<i data-lucide="${it.icon}" class="w-4 h-4"></i>` : ''}<span>${it.label}</span>`;
      el.addEventListener('click', (e) => {
        if (it.onClick) { e.preventDefault(); it.onClick(e); }
        close();
      });
      menu.appendChild(el);
    });
    // Position relative to trigger.
    trigger.parentElement.classList.add('relative');
    trigger.parentElement.appendChild(menu);
    if (window.lucide) window.lucide.createIcons();
    openMenus.add(api);
    document.addEventListener('click', outside, true);
    document.addEventListener('keydown', onKey);
    const first = menu.querySelector('a,button');
    if (first) first.focus();
  };

  const api = { open, close };
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.addEventListener('click', (e) => { e.stopPropagation(); menu ? close() : open(); });
  return api;
}

// Global Esc closes any open dropdown.
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
