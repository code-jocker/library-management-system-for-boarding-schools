// utils/receiptNumber.js
// Generates a human-friendly, roughly-sequential receipt number for fines.
const Fine = require('../models/Fine');

async function nextReceiptNo() {
  const count = await Fine.estimatedDocumentCount();
  const n = String(count + 1).padStart(6, '0');
  return `RCPT-${n}`;
}

module.exports = { nextReceiptNo };
