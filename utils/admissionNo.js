// utils/admissionNo.js
// Generates the next unique admission number, e.g. GHS/2026/016. The sequence is
// per calendar year and derived from the highest existing number so deletions do
// not cause reuse. Callers wrap creation in a retry loop for the rare race where
// two requests pick the same number (guarded by the unique index).
const Member = require('../models/Member');

const PREFIX = 'GHS';

// Find the greatest numeric sequence already used for this year's prefix.
async function nextSequence(year) {
  const prefix = `${PREFIX}/${year}/`;
  const last = await Member.findOne({ admissionNo: { $regex: `^${prefix}` } })
    .sort({ admissionNo: -1 })
    .select('admissionNo')
    .lean();
  if (!last) return 1;
  const tail = last.admissionNo.slice(prefix.length);
  const n = parseInt(tail, 10);
  return Number.isNaN(n) ? 1 : n + 1;
}

// Returns a fresh admission number for the given (or current) year.
async function nextAdmissionNo(year = new Date().getFullYear()) {
  const seq = await nextSequence(year);
  return `${PREFIX}/${year}/${String(seq).padStart(3, '0')}`;
}

// Returns `count` sequential, non-colliding admission numbers for a bulk import.
async function nextAdmissionNos(count, year = new Date().getFullYear()) {
  let seq = await nextSequence(year);
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(`${PREFIX}/${year}/${String(seq).padStart(3, '0')}`);
    seq += 1;
  }
  return out;
}

module.exports = { nextAdmissionNo, nextAdmissionNos, ADMISSION_PREFIX: PREFIX };
