// middleware/validate.js
// Runs express-validator chains and returns a normalized error payload.
const { validationResult } = require('express-validator');

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const fieldErrors = {};
    for (const e of errors.array()) {
      // Keep the first message per field.
      if (!fieldErrors[e.path]) fieldErrors[e.path] = e.msg;
    }
    return res.status(400).json({
      success: false,
      message: 'Please correct the highlighted fields',
      errors: fieldErrors
    });
  }
  return next();
}

module.exports = validate;
