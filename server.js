// server.js
// Express app: security, compression, REST API.
require('dotenv').config();
const fs = require('fs');
const express = require('express');
const http = require('http');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');

const connectDB = require('./config/db');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimiter');
const User = require('./models/User');
const Setting = require('./models/Setting');
const push = require('./utils/pushNotifications');
const scheduler = require('./utils/scheduler');
const eventBus = require('./utils/eventBus');
const offlineStorage = require('./utils/offlineStorage');
const { getSyncEngine } = require('./utils/syncEngine');
const { getSetupStatus } = require('./utils/setupStatus');

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
app.use(express.json({ limit: '5mb' }));
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

// Import routes with extended timeout for file uploads
const importRoutes = require('./routes/importRoutes');
app.use('/api/import', (req, res, next) => {
  // Extend timeout for import operations (5 minutes)
  req.setTimeout(300000);
  res.setTimeout(300000);
  next();
}, importRoutes);

app.use('/api/activity', require('./routes/activityRoutes'));
app.use('/api/clearance', require('./routes/clearanceRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/assistant', require('./routes/assistantRoutes'));

// Setup routes (no auth required - for initialization and status)
app.use('/api/setup', require('./routes/setupRoutes'));

// Health check endpoint (comprehensive)
app.get('/api/health', async (req, res) => {
  try {
    const setupStatus = getSetupStatus();
    const result = await setupStatus.runAll();
    const statusCode = result.healthy ? 200 : 503;
    res.status(statusCode).json({ success: result.healthy, data: result });
  } catch (e) {
    res.status(500).json({ success: false, data: { status: 'ok', time: new Date().toISOString(), error: e.message } });
  }
});

// NOTE: there used to be an unauthenticated `app.all('/api/_seed')` endpoint
// here. It deleted every non-librarian user and returned the librarian password
// in plaintext, and being reachable by a plain GET meant a link or a crawler
// could trigger it. Accounts are now created with `npm run seed:librarian`,
// which is a local script rather than an HTTP route.

// API 404 (JSON).
app.use('/api', notFound);

// Serve web setup page (no auth required)
app.get('/setup', (req, res) => {
  res.sendFile(require('path').join(__dirname, 'public', 'setup', 'index.html'));
});

// Redirect root to setup if not configured
app.get('/', async (req, res) => {
  try {
    const settings = await Setting.findById(Setting.SETTING_ID).lean().catch(() => null);
    const librarian = await User.findOne({ role: 'librarian' }).lean();
    if (!librarian || !settings) {
      return res.redirect('/setup');
    }
    // If configured, serve the main app (placeholder for now)
    res.sendFile(require('path').join(__dirname, 'public', 'setup', 'index.html'));
  } catch {
    res.redirect('/setup');
  }
});

// Global error handler last.
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

// The librarian account is NOT auto-created here.
//
// This function used to run on every boot and upsert the account with a
// freshly hashed DEFAULT_LIBRARIAN_PASSWORD. Because `passwordHash` was part of
// the update payload, every deploy, spin-down or crash recovery silently reset
// the librarian's password back to the default, discarding any password she had
// set in the admin panel.
//
// Accounts are now created once, explicitly, with `npm run seed:librarian`,
// which skips the account if it already exists. To promote a real initial
// password, set DEFAULT_LIBRARIAN_PASSWORD before the first run and delete the
// variable afterwards; the account forces a change on first login regardless.
async function assertNoSeedEndpointLeak() {
  // Cheap guard so a future edit cannot silently reintroduce a public route that
  // writes users. Runs only at boot and costs one regex over the source.
  try {
    const src = fs.readFileSync(__filename, 'utf8');
    if (/app\.(all|get|post|put|patch|delete)\s*\(\s*['"`][^'"`]*seed/i.test(src)) {
      console.warn('[server] A route matching /seed is registered. Seeding must use scripts/, not HTTP.');
    }
  } catch { /* best effort only */ }
}

// Seeding is no longer automatic, so an empty user collection means nobody can
// log in. Warn loudly rather than letting it be discovered on a support call.
async function warnIfNoUsers() {
  try {
    const count = await User.countDocuments();
    if (count === 0) {
      console.warn(
        '\n  *** No user accounts exist in this database. ***\n' +
        '  *** Run: npm run seed:librarian  to create the first librarian. ***\n'
      );
    }
  } catch (e) {
    console.error('[server] Could not count users:', e.message);
  }
}

function start() {
  const server = http.createServer(app);
  const { Server } = require('socket.io');
  const io = new Server(server, {
    cors: {
      origin: allowedOrigins.length ? allowedOrigins : true,
      methods: ['GET', 'POST', 'PUT', 'DELETE']
    }
  });

  // JWT auth for WebSocket connections.
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers.authorization?.split(' ')[1];
    if (!token) return next(new Error('Missing auth token'));
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(payload.sub).select('-passwordHash').lean();
      if (!user) return next(new Error('User not found'));
      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`[socket] User connected: ${socket.user.username}`);
    socket.join(socket.user._id.toString());
    socket.on('disconnect', () => {
      console.log(`[socket] User disconnected: ${socket.user.username}`);
    });
  });

  eventBus.init(io);
  push.init();
  scheduler.start();

  server.listen(PORT, () => {
    console.log(`[server] Library System API running at http://localhost:${PORT}`);
  });
}

async function boot() {
  await connectDB();
  assertNoSeedEndpointLeak();
  await warnIfNoUsers();
  start();
}

boot().catch((err) => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});

module.exports = app;
