// middleware/errorHandler.js
// Global error handler. Hides stack traces in production.
// Also translates common Mongoose errors into clean 400s.
const isProd = () => process.env.NODE_ENV === 'production';

function errorHandler(err, req, res, next) {
  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Something went wrong';
  let errors = err.fieldErrors || undefined;

  // Mongoose duplicate key -> friendly unique-field message.
  if (err.code === 11000) {
    status = 409;
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    message = `That ${field} is already in use`;
    errors = { [field]: message };
  }

  // Mongoose validation error -> field errors.
  if (err.name === 'ValidationError') {
    status = 400;
    errors = {};
    for (const [k, v] of Object.entries(err.errors || {})) errors[k] = v.message;
    message = 'Please correct the highlighted fields';
  }

  // Payload too large (oversized base64 image).
  if (err.type === 'entity.too.large') {
    status = 413;
    message = 'Upload is too large. Images are compressed to under 100 KB.';
  }

  if (!isProd()) {
    console.error('[error]', err);
  }

  res.status(status).json({
    success: false,
    message,
    errors,
    stack: isProd() ? undefined : err.stack
  });
};

module.exports = errorHandler;
