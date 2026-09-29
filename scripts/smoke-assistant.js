require('dotenv').config();

// Stub the models so the intent engine can be exercised without a live Mongo.
const Setting = require('../models/Setting');
const Book = require('../models/Book');
const Category = require('../models/Category');
const Member = require('../models/Member');
const Transaction = require('../models/Transaction');
const Fine = require('../models/Fine');

const settings = {
  schoolName: 'Green Hills',
  currencySymbol: 'RF',
  finePerDay: 100,
  loanDays: 14,
  borrowingLimit: 3,
  teacherBorrowingLimit: 5,
  reservationHoldDays: 3,
  phone: '+250 788 000 000',
  email: 'library@greenhills.rw',
  address: 'Kigali'
};

Setting.get = async () => settings;

const books = [
  { _id: 'b1', title: 'Harry Potter and the Goblet of Fire', author: 'J. K. Rowling', totalCopies: 4, availableCopies: 2, shelfLocation: 'Fiction A3' },
  { _id: 'b2', title: 'Introduction to Algorithms', author: 'Cormen', totalCopies: 2, availableCopies: 0, shelfLocation: 'Science B1' }
];

Book.find = () => ({ sort: () => ({ limit: () => ({ populate: () => ({ lean: async () => [] }) }) }) });
Book.countDocuments = async () => 2;
Book.prototype.populate = function () { return this; };
Book.prototype.lean = function () { return this; };
Book.prototype.limit = function () { return this; };
Book.prototype.sort = function () { return this; };
Category.find = () => ({ sort: () => ({ lean: async () => [{ _id: 'c1', name: 'Fiction' }, { _id: 'c2', name: 'Science' }] }) });
Book.aggregate = async () => [{ _id: 'c1', total: 12 }, { _id: 'c2', total: 5 }];
Member.findOne = () => ({ lean: async () => ({ _id: 'm1', fullName: 'Alice Mukamana', admissionNo: 'STU001', classLevel: 'S3' }) });
Transaction.find = () => ({ sort: () => ({ lean: async () => [{ bookTitle: 'Harry Potter and the Goblet of Fire', dueDate: new Date(Date.now() - 2 * 86400000) }] }) });
Fine.find = () => ({ sort: () => ({ lean: async () => [{ receiptNo: 'R-9', bookTitle: 'Harry Potter and the Goblet of Fire', amount: 300, paidAmount: 0 }] }) });

const { handleIntent, findBooks } = require('../utils/libraryAssistant');

// Patch findBooks indirectly by feeding the stubbed Book.find through it.
const origFind = Book.find;
Book.find = (filter) => {
  if (filter && filter.$text) {
    const q = filter.$text.$search.toLowerCase();
    const hit = books.filter((b) => (b.title + b.author).toLowerCase().includes(q.split(' ')[0]));
    const chain = { sort: () => chain, limit: () => chain, populate: () => chain, lean: async () => hit };
    return chain;
  }
  const rxSource = filter?.$or?.[0]?.title;
  const needle = rxSource ? String(rxSource).replace(/[\\^$.*+?()[\]{}|]/g, '').toLowerCase() : '';
  const hit = books.filter((b) => b.title.toLowerCase().includes(needle) || b.author.toLowerCase().includes(needle));
  const chain = { sort: () => chain, limit: () => chain, populate: () => chain, lean: async () => hit };
  return chain;
};
void origFind;

const QUESTIONS = [
  'hello',
  'thanks',
  'how many books can I borrow?',
  'what is the fine per day?',
  'how do I renew a book?',
  'do you have harry potter',
  'is introduction to algorithms available',
  'list categories',
  'library contact',
  'my books for STU001',
  'my fines',
  'asdkjh qwe zxc'
];

(async () => {
  let failures = 0;
  for (const q of QUESTIONS) {
    try {
      const r = await handleIntent(q, {});
      if (!r.answer || !r.intent) throw new Error('empty result');
      console.log(`[${r.intent}] ${q}\n   -> ${String(r.answer).split('\n')[0].slice(0, 120)}`);
    } catch (e) {
      failures++;
      console.log(`FAIL  ${q} -> ${e.message}`);
    }
  }
  console.log(failures ? `\n${failures} FAILURES` : '\nAll intents answered');
  process.exit(failures ? 1 : 0);
})();
