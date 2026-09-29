// public/js/views/reminders.js
// Overdue/fine reminders over WhatsApp and email.
// WhatsApp: the server returns wa.me deep links, so the librarian taps a row and
// the message opens in WhatsApp already addressed and typed - no WhatsApp
// Business API account needed. Email: sent server-side over SMTP in bulk.
import { api } from '../core/api.js';
import { t } from '../core/i18n.js';
import { escapeHtml, formatMoney, formatDate } from '../core/utils.js';
import { pageHeader } from '../components/pageHeader.js';
import { dataTable } from '../components/dataTable.js';
import { skeletonTable } from '../components/skeleton.js';
import { statCard } from '../components/statCard.js';
import { openModal, closeModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { confirmDialog } from '../components/confirm.js';

const CHANNELS = { whatsapp: 'whatsapp', email: 'email', both: 'both' };

export async function mount(ctx) {
  const host = document.getElementById('view-container');

  host.innerHTML = '';
  host.appendChild(pageHeader({
    title: t('reminders.title'),
    crumbs: ctx.defaultCrumbs,
    actions: [
      { id: 'rem-bulk', label: t('reminders.sendSelected'), icon: 'send', variant: 'primary', onClick: sendSelected }
    ]
  }));

  const statsHost = document.createElement('div');
  statsHost.className = 'mb-4';
  host.appendChild(statsHost);
  const listHost = document.createElement('div');
  host.appendChild(listHost);

  const selected = new Set();
  let rows = [];
  let channels = { whatsapp: { available: true }, email: { available: false } };

  // A librarian with no phone number on file cannot be reminded on WhatsApp.
  const canSend = () => channels.whatsapp.available || channels.email.available;

  try {
    const ch = await api.get('/notifications/channels', { signal: ctx.signal });
    if (ch && ch.data) channels = ch.data;
  } catch (err) {
    // Default assumptions are fine; the send endpoint reports the real problem.
  }

  renderChannelNote();

  function renderChannelNote() {
    const bits = [];
    if (channels.whatsapp.available) {
      bits.push(t('reminders.waAvailable'));
    }
    if (channels.email.available) {
      bits.push(t('reminders.emailAvailable'));
    } else {
      bits.push(t('reminders.emailUnavailable'));
    }
    const note = document.createElement('p');
    note.className = 'text-xs text-slate-500 dark:text-slate-400 mb-4';
    note.innerHTML = `<i data-lucide="info" class="w-3.5 h-3.5 inline align-[-2px]"></i> ${escapeHtml(bits.join(' · '))}`;
    statsHost.parentNode.insertBefore(note, statsHost.nextSibling);
    if (window.lucide) window.lucide.createIcons();
  }

  async function load() {
    listHost.innerHTML = skeletonTable(8, 6);
    try {
      const res = await api.get('/notifications/overdue', { signal: ctx.signal });
      const data = res.data || { items: [] };
      rows = data.items || [];
      renderStats(data);
      render(rows);
    } catch (err) {
      listHost.innerHTML = `<div class="p-6 text-danger">${escapeHtml(err.message)}</div>`;
    }
  }

  function renderStats(data) {
    statsHost.className = 'grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4';
    statsHost.innerHTML = [
      statCard({ label: t('reminders.studentsToRemind'), value: data.total, icon: 'users', tone: 'primary' }),
      statCard({ label: t('reminders.overdueBooks'), value: data.totalBooks, icon: 'alert-triangle', tone: 'warning' }),
      statCard({ label: t('reminders.outstandingFines'), value: formatMoney(data.totalFines), icon: 'badge-dollar-sign', tone: 'danger' })
    ].join('');
    if (window.lucide) window.lucide.createIcons();
  }

  function render(items) {
    // Drop selections for rows that are no longer listed.
    const present = new Set(items.map((i) => String(i.memberId)));
    for (const id of [...selected]) if (!present.has(id)) selected.delete(id);

    dataTable(listHost, {
      columns: [
        { key: 'name', label: t('reminders.student'), render: (r) =>
          `<a href="#/members/${escapeHtml(r.memberId)}" class="text-primary hover:underline font-medium">${escapeHtml(r.name)}</a>
           <p class="text-xs text-slate-400">${escapeHtml(r.admissionNo)}${r.classLevel ? ' · ' + escapeHtml(r.classLevel) : ''}</p>` },
        { key: 'overdueCount', label: t('reminders.overdueBooks'), render: (r) =>
          `<span class="font-medium">${r.overdueCount}</span>${r.maxDaysLate ? `<span class="text-xs text-danger ml-1">${escapeHtml(t('reminders.daysLateShort', { n: r.maxDaysLate }))}</span>` : ''}` },
        { key: 'fineBalance', label: t('reminders.fineBalance'), render: (r) =>
          r.fineBalance > 0 ? `<span class="text-danger font-semibold">${escapeHtml(formatMoney(r.fineBalance))}</span>` : '<span class="text-slate-400">-</span>' },
        { key: 'contact', label: t('reminders.contact'), render: (r) => {
          const phone = r.guardianPhone || r.phone;
          return phone
            ? `<span class="font-mono text-xs">${escapeHtml(phone)}</span>${r.guardianPhone ? `<p class="text-xs text-slate-400">${escapeHtml(t('reminders.guardian'))}</p>` : ''}`
            : '<span class="text-slate-400 text-xs">' + escapeHtml(t('reminders.noPhone')) + '</span>';
        } }
      ],
      rows: items,
      actions: (r) => [
        { label: t('reminders.preview'), icon: 'eye', onClick: () => preview(r) },
        { label: t('reminders.sendWhatsapp'), icon: 'message-circle', onClick: () => sendOne(r, CHANNELS.whatsapp) },
        { label: t('reminders.sendEmail'), icon: 'mail', onClick: () => sendOne(r, CHANNELS.email) }
      ],
      empty: { title: t('reminders.empty') },
      selectable: true,
      selected,
      onSelectionChange: (ids) => { ids.forEach((id) => selected.add(id)); },
      stackedRender: (r) => `<div class="min-w-0">
        <div class="flex justify-between gap-2">
          <span class="font-medium text-slate-800 dark:text-slate-100 truncate">${escapeHtml(r.name)}</span>
          <span class="text-xs text-slate-400 shrink-0">${escapeHtml(r.admissionNo)}</span>
        </div>
        <p class="text-xs text-slate-400 mt-1">${escapeHtml(t('reminders.overdueBooks'))}: ${r.overdueCount}${r.maxDaysLate ? ' · ' + escapeHtml(t('reminders.daysLateShort', { n: r.maxDaysLate })) : ''}${r.fineBalance > 0 ? ' · ' + escapeHtml(formatMoney(r.fineBalance)) : ''}</p>
        <div class="flex justify-end mt-2" data-mobile-actions></div>
      </div>`
    });
  }

  async function preview(row) {
    const modalId = openModal({
      title: t('reminders.preview'),
      size: 'lg',
      body: '<div class="p-4 text-sm text-slate-500">' + escapeHtml(t('common.loading')) + '</div>',
      actions: [{ label: t('common.close'), variant: 'ghost', onClick: () => closeModal(modalId) }]
    });
    const root = document.getElementById(modalId);
    const body = root.querySelector('.modal-body') || root;
    try {
      const res = await api.post(`/notifications/overdue/${row.memberId}/send`, { channel: 'whatsapp' }, { signal: ctx.signal });
      const data = res.data || {};
      const first = (data.results || []).find((r) => r.channel === 'whatsapp');
      const books = (data.books || []).join(', ');
      body.innerHTML = `
        <p class="text-sm text-slate-500 mb-3">${escapeHtml(t('reminders.previewRecipient', { name: row.name, phone: row.guardianPhone || row.phone || '—' }))}</p>
        <pre class="whitespace-pre-wrap text-sm bg-slate-50 dark:bg-slate-700/50 rounded-input p-3 border border-slate-200 dark:border-slate-600">${escapeHtml(first ? first.message : t('reminders.noPhone'))}</pre>
        ${books ? `<p class="text-xs text-slate-400 mt-2">${escapeHtml(t('reminders.booksInMessage'))}: ${escapeHtml(books)}</p>` : ''}`;
    } catch (err) {
      body.innerHTML = `<div class="p-4 text-danger text-sm">${escapeHtml(err.message)}</div>`;
    }
  }

  async function sendOne(row, channel) {
    if (channel === CHANNELS.whatsapp && !channels.whatsapp.available) {
      toast(t('reminders.waUnavailable'), 'error');
      return;
    }
    if (channel === CHANNELS.email && !channels.email.available) {
      toast(t('reminders.emailUnavailable'), 'error');
      return;
    }
    const recipientType = row.guardianPhone || row.guardianName ? 'guardian' : 'member';
    try {
      const res = await api.post(`/notifications/overdue/${row.memberId}/send`, { channel, recipientType });
      const results = (res.data && res.data.results) || [];
      const wa = results.find((r) => r.channel === 'whatsapp');
      if (wa && wa.link) {
        // Open WhatsApp with the message ready. Popup blockers allow this
        // because it happens inside the click handler.
        window.open(wa.link, '_blank', 'noopener');
        toast(t('reminders.waOpened'), 'success');
      } else {
        const sent = results.find((r) => r.status === 'sent');
        if (sent) toast(t('reminders.emailSent'), 'success');
        else {
          const bad = results.find((r) => r.status === 'failed' || r.status === 'skipped');
          toast(bad ? bad.error : t('errors.generic'), 'error');
          return;
        }
      }
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function sendSelected() {
    if (!selected.size) {
      toast(t('reminders.selectSome'), 'warning');
      return;
    }
    if (!canSend()) {
      toast(t('reminders.noChannel'), 'error');
      return;
    }
    const ok = await confirmDialog({
      title: t('reminders.sendSelected'),
      message: t('reminders.sendSelectedConfirm', { n: selected.size }),
      confirmLabel: t('reminders.send'),
      variant: 'primary'
    });
    if (!ok) return;

    const modalId = openModal({
      title: t('reminders.sending'),
      size: 'sm',
      body: '<div class="p-4 text-sm text-slate-500">' + escapeHtml(t('reminders.pleaseWait')) + '</div>',
      actions: []
    });

    try {
      const res = await api.post('/notifications/bulk', {
        channel: channels.email.available && !channels.whatsapp.available ? 'email' : 'whatsapp',
        memberIds: [...selected],
        limit: selected.size
      });
      const data = res.data || {};
      closeModal(modalId);

      const links = data.whatsapp || [];
      if (links.length === 1) {
        window.open(links[0].link, '_blank', 'noopener');
      } else if (links.length > 1) {
        // Several students cannot share one chat. Offer the combined notice
        // the backend builds, addressed to the library's own number.
        await offerCombined(links);
      } else if ((data.emails || []).length) {
        const sentCount = data.emails.filter((e) => e.status === 'sent').length;
        toast(t('reminders.bulkSent', { n: sentCount }), 'success');
      }
      selected.clear();
      load();
    } catch (err) {
      closeModal(modalId);
      toast(err.message, 'error');
    }
  }

  // Ask the backend for one message covering everyone selected.
  async function offerCombined(links) {
    const ids = links.map((l) => l.admissionNo);
    try {
      const res = await api.get(`/notifications/export-whatsapp?ids=${encodeURIComponent(ids.join(','))}`, { signal: ctx.signal });
      const data = res.data || {};
      const modalId = openModal({
        title: t('reminders.combinedTitle'),
        size: 'lg',
        body: `<p class="text-sm text-slate-500 mb-3">${escapeHtml(t('reminders.combinedHint', { n: data.count || ids.length }))}</p>
               <pre class="whitespace-pre-wrap text-xs bg-slate-50 dark:bg-slate-700/50 rounded-input p-3 border border-slate-200 dark:border-slate-600 max-h-72 overflow-y-auto scroll-slim">${escapeHtml(data.message || '')}</pre>`,
        actions: [
          { label: t('common.close'), variant: 'ghost', onClick: () => closeModal(modalId) },
          { label: t('reminders.openWhatsapp'), variant: 'primary', onClick: () => { window.open(data.link, '_blank', 'noopener'); closeModal(modalId); } }
        ]
      });
      void modalId;
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  await load();
  return function unmount() {};
}
