// utils/libraryAssistant.js
// Answers library questions from the live database.
//
// Two layers:
//   1. Intent handlers. Deterministic, free, works with no network and no API key.
//   2. Optional LLM rephrase. Only used to phrase a fallback answer in natural
//      language when ASSISTANT_LLM_URL is set; it never sees the whole database.
const Book = require('../models/Book');
const Category = require('../models/Category');
const Member = require('../models/Member');
const Transaction = require('../models/Transaction');
const Fine = require('../models/Fine');
const Setting = require('../models/Setting');

const GREETINGS = ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening', 'muri', 'bisaite', 'salut'];
const THANKS = ['thanks', 'thank you', 'murakoze', 'merci'];

function norm(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function has(text, ...words) {
  return words.some((w) => text.includes(w));
}

// Quoted or trailing text after a command word, e.g. "find harry potter" -> "harry potter"
function subjectAfter(text, ...commands) {
  for (const c of commands) {
    const idx = text.indexOf(c);
    if (idx !== -1) {
      const rest = text.slice(idx + c.length).trim();
      if (rest) return rest;
    }
  }
  return '';
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Mongo text search first, then a loose regex so partial words still match.
async function findBooks(query, { availableOnly = false, limit = 5 } = {}) {
  if (!query) return { books: [], total: 0 };
  let results = [];
  try {
    results = await Book.find({ $text: { $search: query } }, { score: { $meta: 'textScore' } })
      .sort({ score: { $meta: 'textScore' } })
      .limit(limit)
      .populate('category', 'name')
      .lean();
  } catch (err) {
    results = [];
  }
  if (!results.length) {
    const rx = new RegExp(escapeRegex(query), 'i');
    const filter = { $or: [{ title: rx }, { author: rx }, { isbn: rx }] };
    if (availableOnly) filter.availableCopies = { $gt: 0 };
    results = await Book.find(filter).limit(limit).populate('category', 'name').lean();
  }
  const total = await Book.countDocuments({
    $or: [{ title: new RegExp(escapeRegex(query), 'i') }, { author: new RegExp(escapeRegex(query), 'i') }]
  });
  return { books: results, total };
}

function describeBook(b) {
  const state = b.availableCopies > 0 ? `${b.availableCopies} of ${b.totalCopies} available` : 'all copies out';
  const where = b.shelfLocation ? ` on shelf ${b.shelfLocation}` : '';
  return `"${b.title}" by ${b.author} - ${state}${where}`;
}

async function memberLoansAndFines(admissionNo) {
  const member = await Member.findOne({ admissionNo: String(admissionNo).trim().toUpperCase() }).lean();
  if (!member) return null;
  const [loans, fines] = await Promise.all([
    Transaction.find({ member: member._id, returnDate: null, status: { $in: ['borrowed', 'overdue'] } })
      .sort({ dueDate: 1 })
      .lean(),
    Fine.find({ member: member._id, status: { $in: ['unpaid', 'partial'] } }).sort({ createdAt: -1 }).lean()
  ]);
  return { member, loans, fines };
}

async function handleIntent(rawMessage, context = {}) {
  const text = norm(rawMessage);
  const settings = await Setting.get();
  const currency = settings.currencySymbol || '';

  if (!text) {
    return fallback(settings, 'I did not catch that.');
  }

  // Greeting
  if (GREETINGS.some((g) => text === g || text.startsWith(g + ' ')) && text.length < 40) {
    return {
      intent: 'greeting',
      answer: `Hello, and welcome to the ${settings.schoolName} Library assistant. I can search the catalogue, check availability, explain borrowing and fine rules, or look up a member's books and fines if you give me an admission number.`,
      suggestions: ['Find a book', 'How many books can I borrow?', 'What is the fine per day?']
    };
  }

  if (has(text, ...THANKS) && text.length < 30) {
    return { intent: 'thanks', answer: 'You are welcome. Anything else I can look up?', suggestions: ['Help'] };
  }

  // Catalogue search / availability
  if (has(text, 'find', 'search', 'look for', 'do you have', 'show me', 'locate', 'book called', 'who wrote')) {
    const query = subjectAfter(text, 'do you have', 'book called', 'find', 'search for', 'search', 'look for', 'locate', 'show me');
    const { books, total } = await findBooks(query || text, { availableOnly: false });
    if (!books.length) {
      return {
        intent: 'book_search',
        answer: `I could not find anything matching "${query || text}". Try the exact title, the author's last name, or the ISBN.`,
        suggestions: ['List categories', 'Help']
      };
    }
    const lines = books.map(describeBook);
    return {
      intent: 'book_search',
      answer:
        (total > books.length ? `Found ${total} match(es). Showing the first ${books.length}:` : `I found ${books.length} book(s):`) +
        '\n' +
        lines.map((l, i) => `${i + 1}. ${l}`).join('\n'),
      data: { books },
      suggestions: books.map((b) => `Availability of ${b.title}`)
    };
  }

  if (has(text, 'available', 'availability', 'in stock', 'copies left', 'on loan')) {
    const query = subjectAfter(text, 'availability of', 'is', 'availability', 'available');
    const { books } = await findBooks(query || text, { availableOnly: false, limit: 3 });
    if (!books.length) {
      return { intent: 'availability', answer: `No catalogue match for "${query || text}".`, suggestions: ['Search the catalogue'] };
    }
    const wanted = query && books[0] && !norm(books[0].title).includes(norm(query)) ? null : books[0];
    const book = wanted || books[0];
    if (book.availableCopies > 0) {
      return {
        intent: 'availability',
        answer: `Yes - ${describeBook(book)}. It is on shelf ${book.shelfLocation || 'the main shelves'}.`,
        data: { books: [book] },
        suggestions: [`Reserve ${book.title}`]
      };
    }
    return {
      intent: 'availability',
      answer: `"${book.title}" is currently fully on loan. You can place a hold at the desk and we will keep it for you for ${settings.reservationHoldDays} day(s) once it returns.`,
      data: { books: [book] },
      suggestions: ['How do I reserve a book?']
    };
  }

  // Borrowing policy
  if (has(text, 'how many books', 'borrow limit', 'borrowing limit', 'how long can i', 'loan period', 'how many days')) {
    return {
      intent: 'policy',
      answer: `A student may borrow ${settings.borrowingLimit} book(s) at a time for ${settings.loanDays} day(s) each. Teachers may borrow ${settings.teacherBorrowingLimit}. If a member has a per-person override on file, that limit applies instead. A book can be renewed at the desk if nobody has reserved it.`,
      suggestions: ['What is the fine per day?', 'How do I renew a book?']
    };
  }

  if (has(text, 'fine', 'charge', 'penalt', 'how much') && has(text, 'day', 'cost', 'rate', 'much', 'pay')) {
    return {
      intent: 'policy',
      answer: `Overdue books are charged ${currency}${settings.finePerDay} per book per day. A lost book is charged its replacement value. Fines can be paid in cash at the desk, and a librarian can waive a fine when there is a good reason.`,
      suggestions: ['My fines', 'How do I renew a book?']
    };
  }

  if (has(text, 'renew', 'extend')) {
    return {
      intent: 'policy',
      answer: `Bring the book to the desk to renew it. A book can be renewed when no one else has reserved it. Each loan can be renewed up to 2 times.`,
      suggestions: ['My books']
    };
  }

  if (has(text, 'reserve', 'reservation', 'hold the book')) {
    return {
      intent: 'policy',
      answer: `You can place a hold at the desk with the book title. Once it comes back we keep it for you for ${settings.reservationHoldDays} day(s) before it goes to the next person in line.`,
      suggestions: ['Availability of a book']
    };
  }

  // Hours and contact
  if (has(text, 'open', 'hours', 'close', 'working days', 'where is', 'address', 'contact', 'phone')) {
    return {
      intent: 'library_info',
      answer: `${settings.schoolName} Library is open on school days during study and break periods. For exact hours call ${settings.phone} or email ${settings.email}. Address: ${settings.address}.`,
      suggestions: ['Borrowing rules', 'Find a book']
    };
  }

  // Categories
  if (has(text, 'categor', 'section', 'genre', 'subjects')) {
    const categories = await Category.find().sort({ name: 1 }).lean();
    const counts = await Book.aggregate([{ $group: { _id: '$category', total: { $sum: 1 } } }]);
    const countMap = new Map(counts.map((c) => [String(c._id), c.total]));
    if (!categories.length) {
      return { intent: 'categories', answer: 'No categories have been set up yet.', suggestions: ['Find a book'] };
    }
    const lines = categories.map((c) => `${c.name} (${countMap.get(String(c._id)) || 0} books)`);
    return {
      intent: 'categories',
      answer: `We have ${categories.length} categor(y/ies):\n${lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}`,
      data: { categories },
      suggestions: ['Find a book in science']
    };
  }

  // Member lookup: "my books" / "fines for STU001"
  const admissionMatch = text.match(/\b([a-z]{2,4}\s?\/?\s?\d{2,6})\b/);
  const wantsMemberData = has(text, 'my books', 'my fine', 'borrowed', 'my borrow', 'my account', 'my record');
  if (wantsMemberData || (admissionMatch && has(text, 'fine', 'book', 'borrow', 'account', 'record'))) {
    const admissionNo = context.admissionNo || (admissionMatch ? admissionMatch[1].replace(/\s/g, '') : '');
    if (!admissionNo) {
      return {
        intent: 'member_lookup',
        answer: 'Tell me the admission number (for example STU001) and I will pull up that member\'s books and fines.',
        suggestions: ['STU001']
      };
    }
    const data = await memberLoansAndFines(admissionNo);
    if (!data) {
      return { intent: 'member_lookup', answer: `I could not find a member with admission number ${admissionNo}.`, suggestions: ['Help'] };
    }
    const { member, loans, fines } = data;
    const parts = [`${member.fullName} (${member.admissionNo}, ${member.classLevel || 'no class'}) has ${loans.length} book(s) out.`];
    if (loans.length) {
      const today = new Date();
      parts.push(...loans.map((l) => {
        const late = Math.floor((today - new Date(l.dueDate)) / 86400000);
        return `- ${l.bookTitle} (due ${new Date(l.dueDate).toLocaleDateString('en-GB')}${late > 0 ? `, ${late} day(s) late` : ''})`;
      }));
    }
    const balance = fines.reduce((s, f) => s + Math.max(0, f.amount - f.paidAmount), 0);
    if (fines.length) {
      parts.push(`Outstanding fines: ${currency}${balance} across ${fines.length} receipt(s).`);
    } else {
      parts.push('No outstanding fines.');
    }
    return {
      intent: 'member_lookup',
      answer: parts.join('\n'),
      data: { member: { fullName: member.fullName, admissionNo: member.admissionNo, classLevel: member.classLevel }, loans, fines },
      suggestions: ['Borrowing rules', 'What is the fine per day?']
    };
  }

  return fallback(settings, 'I am not sure how to answer that yet.');
}

function fallback(settings, prefix) {
  return {
    intent: 'fallback',
    answer: `${prefix} I can help with:\n- searching the catalogue and checking availability\n- borrowing limits, loan periods, renewals and reservations\n- the fine rules (${settings.currencySymbol}${settings.finePerDay} per day per overdue book)\n- a member's current books and fines, if you give an admission number\n- library contact details`,
    suggestions: ['Find a book', 'How many books can I borrow?', 'What is the fine per day?', 'Library contact']
  };
}

// ---- Optional LLM rephrasing -------------------------------------------------
function llmConfigured() {
  return Boolean(process.env.ASSISTANT_LLM_URL && process.env.ASSISTANT_LLM_KEY);
}

// Turns a raw answer into friendlier prose. Any failure returns the original text.
async function rephrase(question, answer) {
  if (!llmConfigured()) return answer;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(process.env.ASSISTANT_LLM_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.ASSISTANT_LLM_KEY}`
      },
      body: JSON.stringify({
        model: process.env.ASSISTANT_LLM_MODEL || undefined,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              'You are a school library assistant. Rewrite the given answer so it reads naturally for a student. Keep every number, book title and rule exactly as written. Do not add facts.'
          },
          { role: 'user', content: `Question: ${question}\n\nAnswer to rewrite:\n${answer}` }
        ]
      })
    });
    clearTimeout(timer);
    if (!res.ok) return answer;
    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content;
    return text && text.trim() ? text.trim() : answer;
  } catch (err) {
    return answer;
  }
}

module.exports = { handleIntent, rephrase, llmConfigured, findBooks, describeBook };
