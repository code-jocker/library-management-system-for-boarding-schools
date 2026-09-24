// controllers/importController.js
// Bulk import for books and members. Two phases: preview (validate only) and
// commit (actually write). The client sends parsed rows as JSON.
const Book = require('../models/Book');
const Member = require('../models/Member');
const Category = require('../models/Category');
const asyncHandler = require('../utils/asyncHandler');
const { logActivity } = require('../utils/activityLogger');
const { nextAdmissionNo } = require('../utils/admissionNo');

// POST /api/import/books/preview  { rows: [...] }  -> row-level validation
// POST /api/import/books/commit   { rows: [...] }  -> create valid rows
async function handleBooks(req, res, commit) {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ success: false, message: 'No rows to import' });

  // Cache categories by lowercased name.
  const cats = await Category.find().lean();
  const catMap = new Map(cats.map((c) => [c.name.toLowerCase(), c._id]));

  // Preload existing ISBNs to detect duplicates within the file and DB.
  const existingIsbns = new Set((await Book.find({}, { isbn: 1 }).lean()).map((b) => b.isbn.toLowerCase()));

  const results = { created: 0, skipped: 0, failed: 0, details: [] };
  const seenInFile = new Set();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const lineNo = i + 1;
    const errors = {};

    const title = (r.title || r.Title || '').toString().trim();
    const author = (r.author || r.Author || '').toString().trim();
    const isbn = (r.isbn || r.ISBN || r.code || '').toString().trim();
    const categoryName = (r.category || r.Category || '').toString().trim();
    const totalCopies = parseInt(r.totalCopies || r.copies || r.Copies || '1', 10);

    if (!title) errors.title = 'Required';
    if (!author) errors.author = 'Required';
    if (!isbn) errors.isbn = 'Required';
    else if (existingIsbns.has(isbn.toLowerCase())) errors.isbn = 'Already exists in library';
    else if (seenInFile.has(isbn.toLowerCase())) errors.isbn = 'Duplicate within this file';
    if (Number.isNaN(totalCopies) || totalCopies < 1) errors.totalCopies = 'Must be 1 or more';

    const hasErrors = Object.keys(errors).length > 0;
    if (!hasErrors) seenInFile.add(isbn.toLowerCase());

    if (commit && !hasErrors) {
      try {
        await Book.create({
          title, author, isbn,
          category: categoryName ? (catMap.get(categoryName.toLowerCase()) || null) : null,
          publisher: (r.publisher || '').toString().trim(),
          year: r.year ? parseInt(r.year, 10) || null : null,
          edition: (r.edition || '').toString().trim(),
          shelfLocation: (r.shelfLocation || r.shelf || '').toString().trim(),
          language: (r.language || 'English').toString().trim(),
          totalCopies,
          availableCopies: totalCopies,
          description: (r.description || '').toString().trim(),
          replacementValue: r.replacementValue ? Number(r.replacementValue) || 0 : 0
        });
        results.created += 1;
        results.details.push({ line: lineNo, status: 'created', isbn });
      } catch (e) {
        results.failed += 1;
        results.details.push({ line: lineNo, status: 'failed', isbn, reason: e.message });
      }
    } else if (hasErrors) {
      results.failed += 1;
      results.details.push({ line: lineNo, status: 'invalid', isbn, errors });
    } else {
      // Preview mode, valid row.
      results.skipped += 0;
      results.details.push({ line: lineNo, status: 'valid', isbn });
    }
  }

  if (commit) {
    await logActivity({ req, action: 'import', entity: 'book', message: `Imported ${results.created} book(s) from file` });
  }

  const preview = !commit;
  const valid = results.details.filter((d) => d.status === 'valid' || d.status === 'created').length;
  const invalid = results.details.filter((d) => d.status === 'invalid' || d.status === 'failed').length;

  res.json({
    success: true,
    data: { preview, summary: { total: rows.length, valid, invalid, created: commit ? results.created : 0 }, details: results.details },
    message: preview ? `Preview: ${valid} valid, ${invalid} with errors` : `Imported ${results.created} book(s)`
  });
}

async function handleMembers(req, res, commit) {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ success: false, message: 'No rows to import' });

  const existing = new Set((await Member.find({}, { admissionNo: 1 }).lean()).map((m) => m.admissionNo.toUpperCase()));

  // Normalize a gender cell to the schema enum, tolerating case + common
  // abbreviations. Anything unrecognized (or missing) falls back to 'Other'
  // so a row is never rejected just because the file lacked a clean value.
  const normalizeGender = (val) => {
    const v = (val || '').toString().trim().toLowerCase();
    if (v === 'male' || v === 'm') return 'Male';
    if (v === 'female' || v === 'f') return 'Female';
    return 'Other';
  };

  const results = { created: 0, details: [] };
  const seen = new Set();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const lineNo = i + 1;
    const errors = {};

    const fullName = (r.fullName || r.name || r.Name || '').toString().trim();
    // Admission number is optional; when omitted the system generates one.
    const admissionNo = (r.admissionNo || r.admission || r.AdmissionNo || '').toString().trim().toUpperCase();

    if (!fullName) errors.fullName = 'Required';
    if (admissionNo) {
      if (existing.has(admissionNo)) errors.admissionNo = 'Already exists';
      else if (seen.has(admissionNo)) errors.admissionNo = 'Duplicate within this file';
    }

    const hasErrors = Object.keys(errors).length > 0;
    if (!hasErrors && admissionNo) seen.add(admissionNo);

    if (commit && !hasErrors) {
      try {
        // Generate a fresh number only when the row did not supply one. Each
        // create is committed before the next generate, so the sequence climbs.
        const finalAdmissionNo = admissionNo || await nextAdmissionNo();
        await Member.create({
          fullName, admissionNo: finalAdmissionNo,
          gender: normalizeGender(r.gender),
          memberType: (r.memberType || '').toString().toLowerCase() === 'teacher' ? 'teacher' : 'student',
          classLevel: (r.classLevel || r.class || '').toString().trim(),
          stream: (r.stream || '').toString().trim(),
          dormitory: (r.dormitory || '').toString().trim(),
          phone: (r.phone || '').toString().trim(),
          guardianName: (r.guardianName || '').toString().trim(),
          guardianPhone: (r.guardianPhone || '').toString().trim(),
          // Imported members are always active, whether or not the file has a
          // status column — the library desk re-activates them in person later.
          status: 'active'
        });
        results.created += 1;
        results.details.push({ line: lineNo, status: 'created', admissionNo: finalAdmissionNo });
      } catch (e) {
        results.details.push({ line: lineNo, status: 'failed', admissionNo, reason: e.message });
      }
    } else if (hasErrors) {
      results.details.push({ line: lineNo, status: 'invalid', admissionNo, errors });
    } else {
      results.details.push({ line: lineNo, status: 'valid', admissionNo });
    }
  }

  if (commit) {
    await logActivity({ req, action: 'import', entity: 'member', message: `Imported ${results.created} member(s) from file` });
  }

  const preview = !commit;
  const valid = results.details.filter((d) => d.status === 'valid' || d.status === 'created').length;
  const invalid = results.details.filter((d) => d.status === 'invalid' || d.status === 'failed').length;

  res.json({
    success: true,
    data: { preview, summary: { total: rows.length, valid, invalid, created: commit ? results.created : 0 }, details: results.details },
    message: preview ? `Preview: ${valid} valid, ${invalid} with errors` : `Imported ${results.created} member(s)`
  });
}

module.exports = {
  previewBooks: (req, res) => handleBooks(req, res, false),
  commitBooks: (req, res) => handleBooks(req, res, true),
  previewMembers: (req, res) => handleMembers(req, res, false),
  commitMembers: (req, res) => handleMembers(req, res, true)
};
