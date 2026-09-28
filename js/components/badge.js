// public/js/components/badge.js
// Status pill with the required colour mapping.
import { escapeHtml } from '../core/utils.js';
import { t } from '../core/i18n.js';

const STATUS_MAP = {
  available: { cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300', key: 'status.available' },
  borrowed: { cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300', key: 'status.borrowed' },
  overdue: { cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', key: 'status.overdue' },
  reserved: { cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300', key: 'status.reserved' },
  lost: { cls: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300', key: 'status.lost' },
  damaged: { cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300', key: 'status.damaged' },
  returned: { cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300', key: 'status.returned' },
  paid: { cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300', key: 'status.paid' },
  unpaid: { cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', key: 'status.unpaid' },
  partial: { cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300', key: 'status.partial' },
  waived: { cls: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300', key: 'status.waived' },
  waiting: { cls: 'bg-yellow-100 text-yellow-700', key: 'reservations.statusWaiting' },
  ready: { cls: 'bg-blue-100 text-blue-700', key: 'reservations.statusReady' },
  fulfilled: { cls: 'bg-green-100 text-green-700', key: 'reservations.statusFulfilled' },
  cancelled: { cls: 'bg-slate-200 text-slate-600', key: 'reservations.statusCancelled' },
  expired: { cls: 'bg-slate-200 text-slate-600', key: 'reservations.statusExpired' },
  active: { cls: 'bg-green-100 text-green-700', key: 'members.active' },
  inactive: { cls: 'bg-slate-200 text-slate-600', key: 'members.inactive' },
  graduated: { cls: 'bg-blue-100 text-blue-700', key: 'members.graduated' }
};

export function badge(status, { label } = {}) {
  const s = String(status || '').toLowerCase();
  const map = STATUS_MAP[s] || { cls: 'bg-slate-100 text-slate-600', key: null };
  const text = label || (map.key ? t(map.key) : status);
  return `<span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${map.cls}">${escapeHtml(text)}</span>`;
}

// Generic coloured chip (e.g. categories).
export function chip(text, color = '#1E3A8A') {
  return `<span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium" style="background:${color}1a;color:${color}">${escapeHtml(text)}</span>`;
}
