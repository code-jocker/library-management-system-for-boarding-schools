// utils/fineCalculator.js
// Central place for overdue-day and fine maths so every screen agrees.

// Whole days late between due date and an end date (0 if not overdue).
function daysOverdue(dueDate, endDate = new Date()) {
  const due = startOfDay(dueDate);
  const end = startOfDay(endDate);
  const ms = end - due;
  if (ms <= 0) return 0;
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function startOfDay(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  return date;
}

// Overdue fine = whole days late * finePerDay.
function calculateFine(dueDate, finePerDay, endDate = new Date()) {
  const days = daysOverdue(dueDate, endDate);
  return { days, amount: days * (Number(finePerDay) || 0) };
}

// Format an amount with the configured currency symbol, e.g. "RF 1,200".
function formatMoney(amount, settings) {
  const symbol = (settings && settings.currencySymbol) || '';
  const num = Number(amount || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return symbol ? `${symbol} ${num}` : num;
}

module.exports = { daysOverdue, calculateFine, formatMoney, startOfDay };
