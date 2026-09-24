// seed/sampleData.js
// Loads (or clears) realistic demo data so the dashboard/reports are not empty.
// Run: npm run seed:sample        (load)
// Run: npm run seed:sample:clear  (clear)
require('dotenv').config();
const mongoose = require('mongoose');
const Category = require('../models/Category');
const Book = require('../models/Book');
const Member = require('../models/Member');
const Transaction = require('../models/Transaction');
const Fine = require('../models/Fine');
const Reservation = require('../models/Reservation');
const Setting = require('../models/Setting');
const ActivityLog = require('../models/ActivityLog');
const { nextReceiptNo } = require('../utils/receiptNumber');

function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d; }
function daysAhead(n) { const d = new Date(); d.setDate(d.getDate() + n); return d; }

const CATEGORIES = [
  { name: 'Sciences', color: '#16A34A', description: 'Physics, Chemistry, Biology' },
  { name: 'Mathematics', color: '#1E3A8A', description: 'Algebra, Geometry, Calculus' },
  { name: 'Languages', color: '#7C3AED', description: 'English, French, Kinyarwanda' },
  { name: 'Literature & Novels', color: '#DB2777', description: 'Fiction and prose' },
  { name: 'History & Geography', color: '#EA580C', description: 'Past events and places' },
  { name: 'Religion', color: '#0891B2', description: 'Theology and scripture' },
  { name: 'Reference', color: '#4B5563', description: 'Dictionaries, atlases, encyclopaedias' },
  { name: 'Rwandan Authors', color: '#F59E0B', description: 'Works by Rwandan writers' }
];

// [title, author, isbn, categoryName, publisher, year, language, totalCopies, replacementValue]
const BOOKS = [
  ['Biology for Senior Secondary', 'M. Nkemdirim', 'BIO-1001', 'Sciences', 'Longman', 2019, 'English', 5, 8000],
  ['Chemistry: A Modern Course', 'J. Okonkwo', 'CHE-1002', 'Sciences', 'Oxford', 2020, 'English', 4, 9000],
  ['Physics Principles', 'A. Kagabo', 'PHY-1003', 'Sciences', 'MKUKI', 2018, 'English', 4, 8500],
  ['Advanced Mathematics S5', 'P. Nsengimana', 'MAT-2001', 'Mathematics', 'REB', 2021, 'English', 6, 7000],
  ['Algebra and Trigonometry', 'L. Uwase', 'MAT-2002', 'Mathematics', 'Pearson', 2017, 'English', 3, 7500],
  ['English Grammar in Use', 'R. Murphy', 'LAN-3001', 'Languages', 'Cambridge', 2019, 'English', 5, 6000],
  ['Le Francais Retrouve', 'M. Lebrun', 'LAN-3002', 'Languages', 'Hachette', 2016, 'French', 3, 6500],
  ['Ikinyarwanda: Ururimi Rwacu', 'A. Habimana', 'LAN-3003', 'Languages', 'Bakame', 2020, 'Kinyarwanda', 4, 5000],
  ['Things Fall Apart', 'Chinua Achebe', 'LIT-4001', 'Literature & Novels', 'Heinemann', 1958, 'English', 4, 6000],
  ['The River Between', 'Ngugi wa Thiong\'o', 'LIT-4002', 'Literature & Novels', 'Heinemann', 1965, 'English', 3, 6000],
  ['A Grain of Wheat', 'Ngugi wa Thiong\'o', 'LIT-4003', 'Literature & Novels', 'Heinemann', 1967, 'English', 2, 6000],
  ['History of Rwanda', 'J. P. Chrétien', 'HIS-5001', 'History & Geography', 'Karthala', 2015, 'English', 3, 9000],
  ['Geography of East Africa', 'S. Mugisha', 'GEO-5002', 'History & Geography', 'EAEP', 2018, 'English', 4, 7000],
  ['The Holy Bible (KJV)', 'Various', 'REL-6001', 'Religion', 'Bible Society', 2012, 'English', 6, 12000],
  ['Foundations of Faith', 'B. Rukundo', 'REL-6002', 'Religion', 'Paulines', 2019, 'English', 3, 5000],
  ['Oxford Advanced Learner\'s Dictionary', 'Oxford', 'REF-7001', 'Reference', 'Oxford', 2020, 'English', 2, 15000],
  ['World Atlas', 'National Geographic', 'REF-7002', 'Reference', 'NatGeo', 2021, 'English', 2, 14000],
  ['Our Lady of the Nile', 'Scholastique Mukasonga', 'RWA-8001', 'Rwandan Authors', 'Gallimard', 2012, 'English', 4, 8000],
  ['The Barefoot Woman', 'Scholastique Mukasonga', 'RWA-8002', 'Rwandan Authors', 'Archipelago', 2020, 'English', 3, 8000],
  ['Rwanda: Crisis and Renewal', 'A. M. Nsanzimana', 'RWA-8003', 'Rwandan Authors', 'Bakame', 2017, 'Kinyarwanda', 3, 7000]
];

// [admissionNo, fullName, gender, classLevel, stream, dormitory, guardianName, guardianPhone, memberType]
const MEMBERS = [
  ['GHS/2024/001', 'Aline Ingabire', 'Female', 'S1', 'A', 'Nyagatare', 'Jean Ingabire', '+250788100001', 'student'],
  ['GHS/2024/002', 'Eric Nshimiyimana', 'Male', 'S1', 'B', 'Kigali', 'Paul Nshimiyimana', '+250788100002', 'student'],
  ['GHS/2024/003', 'Claudine Mukamana', 'Female', 'S2', 'A', 'Butare', 'Alice Mukamana', '+250788100003', 'student'],
  ['GHS/2024/004', 'Kevin Habiyaremye', 'Male', 'S2', 'Science', 'Gisenyi', 'Samuel Habiyaremye', '+250788100004', 'student'],
  ['GHS/2024/005', 'Diane Umutoni', 'Female', 'S3', 'Arts', 'Musanze', 'Grace Umutoni', '+250788100005', 'student'],
  ['GHS/2024/006', 'Patrick Bizimana', 'Male', 'S3', 'Science', 'Kigali', 'Emmanuel Bizimana', '+250788100006', 'student'],
  ['GHS/2024/007', 'Sandrine Uwase', 'Female', 'S4', 'A', 'Nyagatare', 'Joseph Uwase', '+250788100007', 'student'],
  ['GHS/2024/008', 'Olivier Rukundo', 'Male', 'S4', 'B', 'Butare', 'Marie Rukundo', '+250788100008', 'student'],
  ['GHS/2024/009', 'Nadine Kayitesi', 'Female', 'S5', 'Science', 'Gisenyi', 'Peter Kayitesi', '+250788100009', 'student'],
  ['GHS/2024/010', 'Didier Ndayisaba', 'Male', 'S5', 'Arts', 'Musanze', 'Vestine Ndayisaba', '+250788100010', 'student'],
  ['GHS/2024/011', 'Josiane Mutoni', 'Female', 'S6', 'Science', 'Nyagatare', 'Andre Mutoni', '+250788100011', 'student'],
  ['GHS/2024/012', 'Fabrice Niyonzima', 'Male', 'S6', 'A', 'Kigali', 'Chantal Niyonzima', '+250788100012', 'student'],
  ['GHS/2024/013', 'Immaculee Nyirahabimana', 'Female', 'S2', 'B', 'Butare', 'Dieudonne Nyirahabimana', '+250788100013', 'student'],
  ['GHS/2024/014', 'Emery Gasana', 'Male', 'S3', 'A', 'Gisenyi', 'Rose Gasana', '+250788100014', 'student'],
  ['GHS/2024/015', 'Solange Mukandayisenga', 'Female', 'S1', 'Science', 'Musanze', 'Tharcisse Mukandayisenga', '+250788100015', 'student']
];

async function clear() {
  await Promise.all([
    Book.deleteMany({}),
    Category.deleteMany({}),
    Member.deleteMany({}),
    Transaction.deleteMany({}),
    Fine.deleteMany({}),
    Reservation.deleteMany({}),
    ActivityLog.deleteMany({})
  ]);
  console.log('[sample] Cleared books, categories, members, transactions, fines, reservations, activity.');
}

async function load() {
  await clear();

  const cats = await Category.insertMany(CATEGORIES);
  const catByName = new Map(cats.map((c) => [c.name, c]));

  const bookDocs = BOOKS.map(([title, author, isbn, catName, publisher, year, language, totalCopies, replacementValue]) => ({
    title, author, isbn,
    category: catByName.get(catName)._id,
    publisher, year, language,
    totalCopies, availableCopies: totalCopies,
    replacementValue,
    shelfLocation: `${catName.slice(0, 3).toUpperCase()}-${isbn.slice(-4)}`
  }));
  const books = await Book.insertMany(bookDocs);

  const memberDocs = MEMBERS.map(([admissionNo, fullName, gender, classLevel, stream, dormitory, guardianName, guardianPhone, memberType]) => ({
    admissionNo, fullName, gender, classLevel, stream, dormitory, guardianName, guardianPhone, memberType, status: 'active'
  }));
  const members = await Member.insertMany(memberDocs);

  // A few returned loans (history) for report data.
  const historyLoans = [];
  for (let i = 0; i < 6; i++) {
    historyLoans.push({
      book: books[i % books.length]._id,
      member: members[i % members.length]._id,
      status: 'returned',
      issueDate: daysAgo(40 - i * 3),
      dueDate: daysAgo(26 - i * 3),
      returnDate: daysAgo(25 - i * 3),
      bookTitle: books[i % books.length].title,
      bookIsbn: books[i % books.length].isbn,
      memberName: members[i % members.length].fullName,
      memberAdmissionNo: members[i % members.length].admissionNo
    });
  }
  await Transaction.insertMany(historyLoans);

  // One active (not-yet-due) loan.
  const activeBook = books[8]; // Things Fall Apart
  const activeMember = members[4];
  await Transaction.create({
    book: activeBook._id, member: activeMember._id, status: 'borrowed',
    issueDate: daysAgo(3), dueDate: daysAhead(11),
    bookTitle: activeBook.title, bookIsbn: activeBook.isbn,
    memberName: activeMember.fullName, memberAdmissionNo: activeMember.admissionNo
  });
  await Book.findByIdAndUpdate(activeBook._id, { $inc: { availableCopies: -1 } });

  // One OVERDUE loan with an unpaid fine (so dashboard/overdue/fines have data).
  const overdueBook = books[9]; // The River Between
  const overdueMember = members[10];
  const settings = await Setting.get();
  const overdueTxn = await Transaction.create({
    book: overdueBook._id, member: overdueMember._id, status: 'overdue',
    issueDate: daysAgo(25), dueDate: daysAgo(5),
    bookTitle: overdueBook.title, bookIsbn: overdueBook.isbn,
    memberName: overdueMember.fullName, memberAdmissionNo: overdueMember.admissionNo
  });
  await Book.findByIdAndUpdate(overdueBook._id, { $inc: { availableCopies: -1 } });
  const fineAmount = 5 * settings.finePerDay;
  await Fine.create({
    receiptNo: await nextReceiptNo(),
    member: overdueMember._id, transaction: overdueTxn._id, book: overdueBook._id,
    reason: 'overdue', amount: fineAmount, daysOverdue: 5, status: 'unpaid',
    bookTitle: overdueBook.title, memberName: overdueMember.fullName
  });

  // One waiting reservation on a book with no free copies.
  const reservedBook = books[15]; // Dictionary (2 copies)
  await Book.updateOne({ _id: reservedBook._id }, { availableCopies: 0 });
  await Reservation.create({
    book: reservedBook._id, member: members[6]._id, status: 'waiting',
    bookTitle: reservedBook.title, memberName: members[6].fullName, memberAdmissionNo: members[6].admissionNo
  });

  console.log(`[sample] Loaded ${cats.length} categories, ${books.length} books, ${members.length} members,`);
  console.log('         plus sample loans, 1 overdue book + unpaid fine, and 1 reservation.');
}

async function main() {
  const arg = process.argv[2] || '--load';
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI is not set.'); process.exit(1); }
  await mongoose.connect(uri);
  await Setting.get();
  if (arg === '--clear') await clear();
  else await load();
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => { console.error('[sample] Failed:', e); process.exit(1); });
