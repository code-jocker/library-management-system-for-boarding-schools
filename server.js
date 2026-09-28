// server.js
// Express app: security, compression, REST API.
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');

const connectDB = require('./config/db');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimiter');
const User = require('./models/User');
const Setting = require('./models/Setting');

const app = express();

// Trust the first proxy hop (Render/Railway put the app behind a proxy).
app.set('trust proxy', 1);

// ---- Security headers for API ----
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'object-src': ["'none'"]
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  })
);

// ---- CORS limited to the configured client origin ----
const allowedOrigins = (process.env.CLIENT_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(
  cors({
    origin(origin, cb) {
      // Allow same-origin / server-rendered requests (no Origin header).
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
    credentials: true
  })
);

app.use(compression());
app.use(express.json({ limit: '5mb' })); // room for base64 images
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// General API rate limit.
app.use('/api', apiLimiter);

// ---- Mount API routes ----
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/books', require('./routes/bookRoutes'));
app.use('/api/categories', require('./routes/categoryRoutes'));
app.use('/api/members', require('./routes/memberRoutes'));
app.use('/api/transactions', require('./routes/transactionRoutes'));
app.use('/api/fines', require('./routes/fineRoutes'));
app.use('/api/reservations', require('./routes/reservationRoutes'));
app.use('/api/reports', require('./routes/reportRoutes'));
app.use('/api/settings', require('./routes/settingRoutes'));
app.use('/api/dashboard', require('./routes/dashboardRoutes'));
app.use('/api/import', require('./routes/importRoutes'));
app.use('/api/activity', require('./routes/activityRoutes'));
app.use('/api/clearance', require('./routes/clearanceRoutes'));

// Health check.
app.get('/api/health', (req, res) => res.json({ success: true, data: { status: 'ok', time: new Date().toISOString() } }));

// Seed endpoint (GET and POST) - always (re)creates/resets the librarian account.
app.all('/api/_seed', async (req, res) => {
  try {
    console.log('[seed] Seed endpoint called');
    await Setting.get();
    const defaultPassword = process.env.DEFAULT_LIBRARIAN_PASSWORD || 'Librarian@2024';
    console.log('[seed] Setting password for librarian to:', defaultPassword);
    const passwordHash = await User.hashPassword(defaultPassword);
    const filter = { username: 'umutoni.jeannette' };
    const update = {
      username: 'umutoni.jeannette',
      fullName: 'Umutoni Jeannette',
      role: 'librarian',
      email: 'umutoni.jeannette@greenhills.rw',
      phone: '+250 788 000 000',
      passwordHash,
      mustChangePassword: false
    };
    const options = { upsert: true, new: true, runValidators: true };
    const user = await User.findOneAndUpdate(filter, update, options);
    console.log('[seed] Librarian upserted:', user ? user.username : 'FAILED');
    res.json({ success: true, data: { username: 'umutoni.jeannette', password: defaultPassword, id: user._id } });
  } catch (e) {
    console.error('[seed] Error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// API 404 (JSON).
app.use('/api', notFound);

// Global error handler last.
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

// Auto-seed the librarian account if no users exist in the database.
async function autoSeed() {
  try {
    console.log('[server] Auto-seed: checking database...');
    await Setting.get();
    const existing = await User.findOne({ username: 'umutoni.jeannette' }).lean();
    const defaultPassword = process.env.DEFAULT_LIBRARIAN_PASSWORD || 'Librarian@2024';
    console.log('[server] Auto-seed: existing librarian found:', !!existing);
    const passwordHash = await User.hashPassword(defaultPassword);
    const filter = { username: 'umutoni.jeannette' };
    const update = {
      username: 'umutoni.jeannette',
      fullName: 'Umutoni Jeannette',
      role: 'librarian',
      email: 'umutoni.jeannette@greenhills.rw',
      phone: '+250 788 000 000',
      passwordHash,
      mustChangePassword: false
    };
    await User.findOneAndUpdate(filter, update, { upsert: true, runValidators: true });
    console.log('[server] Auto-seed complete: umutoni.jeannette / ' + defaultPassword);
  } catch (e) {
    console.error('[server] Auto-seed failed:', e);
  }
}

async function start() {
  await connectDB();
  await autoSeed();
  app.listen(PORT, () => {
    console.log(`[server] Library System API running at http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});

module.exports = app;
