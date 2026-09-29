require('dotenv').config();

// Stub the models so the notification flow can be exercised without a live Mongo.
const Setting = require('../models/Setting');
const Member = require('../models/Member');
const Transaction = require('../models/Transaction');
const Fine = require('../models/Fine');
const Notification = require('../models/Notification');
const ActivityLog = require('../models/ActivityLog');

const created = [];

Setting.get = async () => ({
  schoolName: 'Green Hills',
  currencySymbol: 'RF',
  finePerDay: 100,
  phone: '+250 788 000 000',
  email: 'library@greenhills.rw'
});

const member = {
  _id: 'm1',
  fullName: 'Alice Mukamana',
  admissionNo: 'STU001',
  classLevel: 'S3',
  dormitory: 'Kigali',
  phone: '0788123456',
  email: 'alice@greenhills.rw',
  guardianName: 'Mr Mukamana',
  guardianPhone: '+250788999888',
  guardianEmail: 'guardian@example.com',
  status: 'active'
};

Member.find = () => {
  const chain = { limit: () => chain, lean: async () => [member] };
  return chain;
};
Member.findById = async (id) => (String(id) === 'm1' ? member : null);

const overdue = { _id: 't1', member: 'm1', bookTitle: 'Harry Potter', dueDate: new Date(Date.now() - 4 * 86400000) };
Transaction.find = () => ({ lean: async () => [overdue] });
Fine.find = () => ({ lean: async () => [{ _id: 'f1', member: 'm1', receiptNo: 'R-9', bookTitle: 'Harry Potter', amount: 400, paidAmount: 100 }] });
Notification.create = async (doc) => { created.push(doc); return doc; };
Notification.find = () => ({ populate: () => ({ sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => created }) }) }) }) });
Notification.countDocuments = async () => created.length;
ActivityLog.create = async () => ({});

const ctrl = require('../controllers/notificationController');

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

(async () => {
  let failures = 0;
  const check = (name, cond, extra) => {
    if (cond) console.log(`PASS  ${name}`);
    else { failures++; console.log(`FAIL  ${name} ${extra || ''}`); }
  };

  // 1. Overdue list
  let res = fakeRes();
  await ctrl.overdue({ query: {} }, res);
  check('overdue list returns one member', res.body?.data?.items?.length === 1, JSON.stringify(res.body));
  check('overdue list counts 1 book', res.body?.data?.items?.[0]?.overdueCount === 1);
  check('overdue list sums fine balance 300', res.body?.data?.items?.[0]?.fineBalance === 300);
  check('overdue list reports days late 4', res.body?.data?.items?.[0]?.maxDaysLate === 4);

  // 2. Single WhatsApp reminder to guardian
  res = fakeRes();
  await ctrl.sendReminder({ params: { memberId: 'm1' }, body: { channel: 'whatsapp' }, user: { _id: 'u1', fullName: 'Lib' } }, res);
  const wa = res.body?.data?.results?.[0];
  check('whatsapp queued', wa?.status === 'queued', JSON.stringify(res.body));
  check('whatsapp link uses guardian number', /wa\.me\/250788999888/.test(wa?.link || ''), wa?.link);
  check('link carries pre-filled text', /text=/.test(wa?.link || ''));
  check('whatsapp message lists the book', /Harry Potter/.test(wa?.message || ''));
  check('notification audit row written', created.some((c) => c.channel === 'whatsapp' && c.status === 'queued'));

  // 3. Email reminder: SMTP not configured on this box
  res = fakeRes();
  await ctrl.sendReminder({ params: { memberId: 'm1' }, body: { channel: 'email' }, user: { _id: 'u1', fullName: 'Lib' } }, res);
  const em = res.body?.data?.results?.[0];
  check('email skipped without SMTP', em?.status === 'skipped', JSON.stringify(em));

  // 4. Bulk WhatsApp for a class
  res = fakeRes();
  await ctrl.sendBulkReminders({ body: { channel: 'whatsapp', limit: 50 }, user: { _id: 'u1', fullName: 'Lib' } }, res);
  check('bulk targeted 1 member', res.body?.data?.targeted === 1, JSON.stringify(res.body?.data));
  check('bulk produced a wa link', /wa\.me\/250788999888/.test(res.body?.data?.whatsapp?.[0]?.link || ''));

  // 5. Channel availability
  res = fakeRes();
  await ctrl.channels({}, res);
  check('whatsapp channel available', res.body?.data?.whatsapp?.available === true);
  check('email availability reflects env', typeof res.body?.data?.email?.available === 'boolean');

  // 6. Unknown member 404s
  res = fakeRes();
  await ctrl.sendReminder({ params: { memberId: 'nope' }, body: { channel: 'whatsapp' }, user: { _id: 'u1', fullName: 'Lib' } }, res);
  check('unknown member returns 404', res.statusCode === 404);

  console.log(failures ? `\n${failures} FAILURES` : '\nAll notification checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('CRASH', e);
  process.exit(1);
});
