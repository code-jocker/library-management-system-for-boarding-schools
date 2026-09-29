// controllers/importController.js
// Bulk import for books and members. Two phases: preview (validate only) and
// commit (actually write). Supports both JSON and Excel file uploads.
const Book = require('../models/Book');
const Member = require('../models/Member');
const Category = require('../models/Category');
const Setting = require('../models/Setting');
const asyncHandler = require('../utils/asyncHandler');
const { logActivity } = require('../utils/activityLogger');
const { nextAdmissionNo } = require('../utils/admissionNo');
const XLSX = require('xlsx');
const multer = require('multer');

// Wrapper to handle aborted requests gracefully
function handleAborted(fn) {
  return async (req, res, next) => {
    try {
      // Check if request was aborted before processing
      if (req.aborted) {
        return res.status(499).json({ success: false, message: 'Request aborted by client' });
      }
      
      // Set up abort handler
      const onAborted = () => {
        console.log('[Import] Request aborted by client');
      };
      req.on('aborted', onAborted);
      
      await fn(req, res, next);
      
      req.off('aborted', onAborted);
    } catch (e) {
      if (e.name === 'AbortError' || e.code === 'ECONNABORTED') {
        console.log('[Import] Request aborted:', e.message);
        return res.status(499).json({ success: false, message: 'Request aborted' });
      }
      next(e);
    }
  };
}

// Configure multer for file uploads (in memory)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'text/csv',
      'application/csv'
    ];
    if (allowedTypes.includes(file.mimetype) || /\.(xlsx|xls|csv)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only Excel (.xlsx, .xls) and CSV files are allowed.'), false);
    }
  }
});

// Parse Excel/CSV file buffer to JSON rows
function parseExcelFile(buffer, originalName) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, { 
    header: 1, 
    defval: '',
    raw: false 
  });
  
  if (rows.length < 2) return [];
  
  const headers = rows[0].map(h => String(h).trim().toLowerCase());
  const dataRows = rows.slice(1).map((row, idx) => {
    const obj = { _rowNum: idx + 2 };
    headers.forEach((header, colIdx) => {
      if (header) obj[header] = row[colIdx] ?? '';
    });
    return obj;
  });
  
  return dataRows;
}

// Normalize header aliases for books
const BOOK_HEADER_MAP = {
  'title': 'title',
  'book title': 'title',
  'author': 'author',
  'authors': 'author',
  'isbn': 'isbn',
  'isbn13': 'isbn',
  'isbn-13': 'isbn',
  'code': 'isbn',
  'category': 'category',
  'categories': 'category',
  'totalcopies': 'totalCopies',
  'copies': 'totalCopies',
  'total copies': 'totalCopies',
  'publisher': 'publisher',
  'year': 'year',
  'publication year': 'year',
  'edition': 'edition',
  'shelflocation': 'shelfLocation',
  'shelf location': 'shelfLocation',
  'shelf': 'shelfLocation',
  'language': 'language',
  'description': 'description',
  'replacementvalue': 'replacementValue',
  'replacement value': 'replacementValue',
  'price': 'replacementValue'
};

// Normalize header aliases for members
const MEMBER_HEADER_MAP = {
  'fullname': 'fullName',
  'name': 'fullName',
  'student name': 'fullName',
  'admissionno': 'admissionNo',
  'admission no': 'admissionNo',
  'admission number': 'admissionNo',
  'id': 'admissionNo',
  'gender': 'gender',
  'sex': 'gender',
  'membertype': 'memberType',
  'member type': 'memberType',
  'type': 'memberType',
  'classlevel': 'classLevel',
  'class level': 'classLevel',
  'class': 'classLevel',
  'grade': 'classLevel',
  'stream': 'stream',
  'section': 'stream',
  'dormitory': 'dormitory',
  'dorm': 'dormitory',
  'hostel': 'dormitory',
  'phone': 'phone',
  'telephone': 'phone',
  'mobile': 'phone',
  'guardianname': 'guardianName',
  'guardian name': 'guardianName',
  'parent name': 'guardianName',
  'guardianphone': 'guardianPhone',
  'guardian phone': 'guardianPhone',
  'parent phone': 'guardianPhone'
};

function normalizeHeaders(rows, headerMap) {
  return rows.map(row => {
    const normalized = { _rowNum: row._rowNum };
    Object.entries(row).forEach(([key, value]) => {
      const normalizedKey = headerMap[key.toLowerCase().replace(/\s+/g, '')] || key;
      normalized[normalizedKey] = value;
    });
    return normalized;
  });
}

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

  // Load settings to validate against configured class levels, streams, and dormitories.
  const settings = await Setting.get();
  const validClassLevels = new Set((settings.classLevels || []).map((c) => c.toLowerCase()));
  const validStreams = new Set((settings.streams || []).map((s) => s.toLowerCase()));
  const validDormitories = new Set((settings.dormitories || []).map((d) => d.toLowerCase()));

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

    const classLevel = (r.classLevel || r.class || '').toString().trim();
    const stream = (r.stream || '').toString().trim();
    const dormitory = (r.dormitory || '').toString().trim();

    if (classLevel && validClassLevels.size > 0 && !validClassLevels.has(classLevel.toLowerCase())) {
      errors.classLevel = `Not a valid class (${settings.classLevels.join(', ')})`;
    }
    if (stream && validStreams.size > 0 && !validStreams.has(stream.toLowerCase())) {
      errors.stream = `Not a valid stream (${settings.streams.join(', ')})`;
    }
    if (dormitory && validDormitories.size > 0 && !validDormitories.has(dormitory.toLowerCase())) {
      errors.dormitory = `Not a valid dormitory (${settings.dormitories.join(', ')})`;
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
          classLevel,
          stream,
          dormitory,
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

// Handle file upload for books
async function handleBooksFile(req, res, commit) {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }
  
  try {
    let rows = parseExcelFile(req.file.buffer, req.file.originalname);
    rows = normalizeHeaders(rows, BOOK_HEADER_MAP);
    
    if (!rows.length) {
      return res.status(400).json({ success: false, message: 'No data rows found in file. Please ensure the file has headers and at least one data row.' });
    }
    
    // Attach rows to body for reuse of existing logic
    req.body.rows = rows;
    return handleBooks(req, res, commit);
  } catch (e) {
    console.error('Excel parse error:', e);
    return res.status(400).json({ success: false, message: `Failed to parse file: ${e.message}` });
  }
}

// Handle file upload for members
async function handleMembersFile(req, res, commit) {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }
  
  try {
    let rows = parseExcelFile(req.file.buffer, req.file.originalname);
    rows = normalizeHeaders(rows, MEMBER_HEADER_MAP);
    
    if (!rows.length) {
      return res.status(400).json({ success: false, message: 'No data rows found in file. Please ensure the file has headers and at least one data row.' });
    }
    
    // Attach rows to body for reuse of existing logic
    req.body.rows = rows;
    return handleMembers(req, res, commit);
  } catch (e) {
    console.error('Excel parse error:', e);
    return res.status(400).json({ success: false, message: `Failed to parse file: ${e.message}` });
  }
}

// Update a specific row in import preview (Excel-like cell editing)
async function updateImportRow(req, res) {
  const { entity, rowIndex, field, value } = req.body;
  
  if (!entity || !['books', 'members'].includes(entity)) {
    return res.status(400).json({ success: false, message: 'Invalid entity. Must be "books" or "members"' });
  }
  
  if (typeof rowIndex !== 'number' || rowIndex < 0) {
    return res.status(400).json({ success: false, message: 'Invalid rowIndex' });
  }
  
  if (!field) {
    return res.status(400).json({ success: false, message: 'Field is required' });
  }
  
  // Get the preview data from session or request
  // For simplicity, we'll accept the full rows array and update the specific row
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  
  if (rowIndex >= rows.length) {
    return res.status(400).json({ success: false, message: 'Row index out of bounds' });
  }
  
  // Update the field
  rows[rowIndex][field] = value;
  
  // Return the updated row with validation
  const updatedRow = rows[rowIndex];
  
  // Re-validate just this row
  const validation = await validateSingleRow(entity, updatedRow, rows, rowIndex);
  
  res.json({
    success: true,
    data: {
      rowIndex,
      row: updatedRow,
      validation
    }
  });
}

// Validate a single row (for real-time validation during editing)
async function validateImportRow(req, res) {
  const { entity, row } = req.body;
  
  if (!entity || !['books', 'members'].includes(entity)) {
    return res.status(400).json({ success: false, message: 'Invalid entity. Must be "books" or "members"' });
  }
  
  if (!row) {
    return res.status(400).json({ success: false, message: 'Row data is required' });
  }
  
  // Get all rows for duplicate checking
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [row];
  const rowIndex = rows.findIndex(r => r === row);
  
  const validation = await validateSingleRow(entity, row, rows, rowIndex);
  
  res.json({
    success: true,
    data: { validation }
  });
}

// Validate a single row for books or members
async function validateSingleRow(entity, row, allRows, rowIndex) {
  const errors = {};
  
  if (entity === 'books') {
    const title = (row.title || '').toString().trim();
    const author = (row.author || '').toString().trim();
    const isbn = (row.isbn || '').toString().trim();
    const totalCopies = parseInt(row.totalCopies || '1', 10);
    
    if (!title) errors.title = 'Required';
    if (!author) errors.author = 'Required';
    if (!isbn) {
      errors.isbn = 'Required';
    } else {
      // Check duplicates in database
      const existing = await Book.findOne({ isbn: isbn.toLowerCase() }).lean();
      if (existing) errors.isbn = 'Already exists in library';
      
      // Check duplicates in file
      const seenInFile = allRows
        .filter((r, i) => i !== rowIndex && (r.isbn || '').toString().trim().toLowerCase() === isbn.toLowerCase())
        .length;
      if (seenInFile > 0) errors.isbn = 'Duplicate within this file';
    }
    
    if (Number.isNaN(totalCopies) || totalCopies < 1) errors.totalCopies = 'Must be 1 or more';
  } else if (entity === 'members') {
    const fullName = (row.fullName || '').toString().trim();
    const admissionNo = (row.admissionNo || '').toString().trim().toUpperCase();
    
    if (!fullName) errors.fullName = 'Required';
    
    if (admissionNo) {
      const existing = await Member.findOne({ admissionNo }).lean();
      if (existing) errors.admissionNo = 'Already exists';
      
      const seenInFile = allRows
        .filter((r, i) => i !== rowIndex && (r.admissionNo || '').toString().trim().toUpperCase() === admissionNo)
        .length;
      if (seenInFile > 0) errors.admissionNo = 'Duplicate within this file';
    }
    
    // Validate classLevel, stream, dormitory against settings
    const settings = await Setting.get();
    const validClassLevels = new Set((settings.classLevels || []).map(c => c.toLowerCase()));
    const validStreams = new Set((settings.streams || []).map(s => s.toLowerCase()));
    const validDormitories = new Set((settings.dormitories || []).map(d => d.toLowerCase()));
    
    const classLevel = (row.classLevel || '').toString().trim();
    const stream = (row.stream || '').toString().trim();
    const dormitory = (row.dormitory || '').toString().trim();
    
    if (classLevel && validClassLevels.size > 0 && !validClassLevels.has(classLevel.toLowerCase())) {
      errors.classLevel = `Not a valid class (${settings.classLevels.join(', ')})`;
    }
    if (stream && validStreams.size > 0 && !validStreams.has(stream.toLowerCase())) {
      errors.stream = `Not a valid stream (${settings.streams.join(', ')})`;
    }
    if (dormitory && validDormitories.size > 0 && !validDormitories.has(dormitory.toLowerCase())) {
      errors.dormitory = `Not a valid dormitory (${settings.dormitories.join(', ')})`;
    }
  }
  
  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}

module.exports = {
  previewBooks: handleAborted((req, res) => handleBooks(req, res, false)),
  commitBooks: handleAborted((req, res) => handleBooks(req, res, true)),
  previewMembers: handleAborted((req, res) => handleMembers(req, res, false)),
  commitMembers: handleAborted((req, res) => handleMembers(req, res, true)),
  previewBooksFile: handleAborted((req, res) => handleBooksFile(req, res, false)),
  commitBooksFile: handleAborted((req, res) => handleBooksFile(req, res, true)),
  previewMembersFile: handleAborted((req, res) => handleMembersFile(req, res, false)),
  commitMembersFile: handleAborted((req, res) => handleMembersFile(req, res, true)),
  updateImportRow: handleAborted(updateImportRow),
  validateImportRow: handleAborted(validateImportRow),
  upload: upload.single('file')
};
