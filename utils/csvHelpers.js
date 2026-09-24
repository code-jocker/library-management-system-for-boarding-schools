// utils/csvHelpers.js
// Small helpers to build CSV text for exports and download templates.

function toCSV(rows, columns) {
  // columns: [{ key, label }]
  const escapeCell = (val) => {
    if (val === null || val === undefined) return '';
    const s = String(val).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const header = columns.map((c) => escapeCell(c.label)).join(',');
  const body = rows
    .map((row) => columns.map((c) => escapeCell(c.key.includes('.') ? getPath(row, c.key) : row[c.key])).join(','))
    .join('\n');
  return `${header}\n${body}`;
}

function getPath(obj, path) {
  return path.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

module.exports = { toCSV };
