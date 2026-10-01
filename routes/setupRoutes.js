// routes/setupRoutes.js
// Setup status and configuration endpoints (no auth required)
const express = require('express');
const router = express.Router();
const Setting = require('../models/Setting');
const User = require('../models/User');
const mongoose = require('mongoose');
const offlineStorage = require('../utils/offlineStorage');
const { getSyncEngine } = require('../utils/syncEngine');

// GET /api/setup/status - Public health check
router.get('/status', async (req, res) => {
  try {
    const dbState = mongoose.connection.readyState; // 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
    const dbStates = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    
    const settings = await Setting.findById(Setting.SETTING_ID).lean().catch(() => null);
    const librarian = await User.findOne({ role: 'librarian' }).select('username fullName email').lean();
    const userCount = await User.countDocuments().catch(() => 0);
    const memberCount = await require('../models/Member').countDocuments().catch(() => 0);
    const bookCount = await require('../models/Book').countDocuments().catch(() => 0);
    
    const syncEngine = getSyncEngine();
    const syncStatus = syncEngine.getStatus();
    const offlineStats = offlineStorage.getStorageStats();
    
    const missingEnvVars = getMissingRequiredEnvVars();
    
    res.json({
      success: true,
      data: {
        configured: !!librarian && missingEnvVars.length === 0,
        database: {
          state: dbStates[dbState] || 'unknown',
          host: mongoose.connection.host || 'unknown',
          name: mongoose.connection.name || 'unknown'
        },
        settingsInitialized: !!settings,
        librarianExists: !!librarian,
        librarian: librarian ? { username: librarian.username, fullName: librarian.fullName, email: librarian.email } : null,
        counts: {
          users: userCount,
          members: memberCount,
          books: bookCount
        },
        sync: {
          online: syncStatus.online,
          processing: syncStatus.processing,
          lastSync: offlineStats.config.lastSync,
          pendingDrafts: offlineStats.drafts.unsynced,
          pendingQueue: offlineStats.queue.pending,
          failedQueue: offlineStats.queue.failed
        },
        offline: {
          mode: offlineStats.config.mode,
          storagePath: offlineStats.storagePath,
          installId: offlineStats.meta.installId,
          installedAt: offlineStats.meta.installedAt,
          version: offlineStats.meta.version
        },
        missingEnvVars,
        renderConfigured: offlineStats.meta.renderedConfigured,
        timestamp: new Date().toISOString()
      }
    });
  } catch (e) {
    console.error('[setup] Status error:', e);
    res.status(500).json({ 
      success: false, 
      data: { configured: false, error: e.message },
      message: 'Setup status check failed'
    });
  }
});

// GET /api/setup/missing-env - Check required environment variables
router.get('/missing-env', (req, res) => {
  const missing = getMissingRequiredEnvVars();
  res.json({ success: true, data: { missing, allSet: missing.length === 0 } });
});

// POST /api/setup/initialize - Initialize database (librarian, settings)
router.post('/initialize', async (req, res) => {
  try {
    const { librarianPassword, schoolName, ...settingsData } = req.body;
    
    // Validate required password
    if (!librarianPassword || librarianPassword.length < 12) {
      return res.status(400).json({ 
        success: false, 
        message: 'Librarian password must be at least 12 characters' 
      });
    }
    
    // 1. Ensure settings exist
    const settings = await Setting.get();
    if (settingsData) {
      Object.assign(settings, settingsData);
      await settings.save();
    } else if (schoolName) {
      settings.schoolName = schoolName;
      await settings.save();
    }
    
    // 2. Create librarian if not exists
    let librarian = await User.findOne({ username: 'umutoni.jeannette' });
    if (!librarian) {
      const passwordHash = await User.hashPassword(librarianPassword);
      librarian = await User.create({
        username: 'umutoni.jeannette',
        fullName: 'Umutoni Jeannette',
        role: 'librarian',
        email: 'umutoni.jeannette@kageyo.rw',
        phone: '+250 788 000 000',
        passwordHash,
        mustChangePassword: true
      });
    }
    
    // 3. Mark as initialized
    offlineStorage.markInstalled(require('../../package.json').version);
    
    res.json({
      success: true,
      data: { 
        librarian: { username: librarian.username, mustChangePassword: true },
        settings: { schoolName: settings.schoolName }
      },
      message: 'System initialized successfully'
    });
  } catch (e) {
    console.error('[setup] Initialize error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/setup/sync - Force sync now
router.post('/sync', async (req, res) => {
  try {
    const syncEngine = getSyncEngine();
    
    if (!syncEngine.isOnline) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot sync while offline. Check connectivity.' 
      });
    }
    
    await syncEngine.forceSync();
    
    const status = syncEngine.getStatus();
    res.json({ success: true, data: status, message: 'Sync completed' });
  } catch (e) {
    console.error('[setup] Sync error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/setup/mode - Set offline/online mode
router.post('/mode', (req, res) => {
  const { mode } = req.body; // 'online', 'offline', 'auto'
  if (!['online', 'offline', 'auto'].includes(mode)) {
    return res.status(400).json({ success: false, message: 'Invalid mode' });
  }
  
  offlineStorage.setMode(mode);
  
  // Update sync engine
  const syncEngine = getSyncEngine();
  if (mode === 'offline') {
    syncEngine.setOnline(false);
    syncEngine.stopAutoSync();
  } else if (mode === 'online') {
    syncEngine.checkConnectivity().then(online => {
      if (online) syncEngine.startAutoSync();
    });
  }
  
  res.json({ success: true, data: { mode }, message: `Mode set to ${mode}` });
});

// POST /api/setup/reset - Reset offline storage (for testing)
router.post('/reset', (req, res) => {
  const { confirm } = req.body;
  if (confirm !== 'yes-reset-offline-storage') {
    return res.status(400).json({ success: false, message: 'Confirmation required' });
  }
  
  offlineStorage.resetOfflineStorage();
  res.json({ success: true, message: 'Offline storage reset' });
});

// POST /api/setup/conflicts/resolve - Resolve manual conflict
router.post('/conflicts/resolve', async (req, res) => {
  try {
    const { conflictId, resolution, mergedData } = req.body;
    if (!conflictId || !resolution) {
      return res.status(400).json({ success: false, message: 'conflictId and resolution required' });
    }
    
    const syncEngine = getSyncEngine();
    const result = await syncEngine.resolveConflict(conflictId, resolution, mergedData);
    
    res.json({ success: true, data: result, message: 'Conflict resolved' });
  } catch (e) {
    console.error('[setup] Conflict resolve error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

function getMissingRequiredEnvVars() {
  const required = ['MONGODB_URI', 'JWT_SECRET'];
  // DEFAULT_LIBRARIAN_PASSWORD only required for initial setup
  return required.filter(k => !process.env[k]);
}

module.exports = router;