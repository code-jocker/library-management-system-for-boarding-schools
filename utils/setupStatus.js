// setup-status.js
// Health check endpoint module for the setup system.
// Provides a comprehensive health check that can be used by:
// - Render health checks
// - Monitoring tools
// - The web setup interface
// - CLI setup script

const mongoose = require('mongoose');
const offlineStorage = require('./offlineStorage');
const { getSyncEngine } = require('./syncEngine');

class SetupStatus {
  constructor() {
    this.checks = new Map();
  }

  // Register a custom health check
  registerCheck(name, checkFn) {
    this.checks.set(name, checkFn);
  }

  // Run all health checks
  async runAll() {
    const results = {};
    const errors = [];

    // Built-in checks
    results.database = await this.checkDatabase();
    results.offline = this.checkOffline();
    results.sync = this.checkSync();
    results.environment = this.checkEnvironment();
    results.storage = this.checkStorage();

    // Custom checks
    for (const [name, fn] of this.checks) {
      try {
        results[name] = await fn();
      } catch (e) {
        errors.push({ check: name, error: e.message });
        results[name] = { status: 'fail', error: e.message };
      }
    }

    const allHealthy = Object.values(results).every(
      r => r.status !== 'fail'
    );

    return {
      healthy: allHealthy,
      timestamp: new Date().toISOString(),
      checks: results,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  async checkDatabase() {
    const state = mongoose.connection.readyState;
    const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    
    if (state !== 1) {
      return { status: 'fail', detail: `Database ${states[state]}` };
    }

    try {
      // Ping the database
      await mongoose.connection.db.admin().ping();
      return {
        status: 'ok',
        detail: 'Connected',
        host: mongoose.connection.host,
        name: mongoose.connection.name
      };
    } catch (e) {
      return { status: 'fail', detail: e.message };
    }
  }

  checkOffline() {
    const config = offlineStorage.getOfflineConfig();
    const meta = offlineStorage.getMeta();
    
    return {
      status: 'ok',
      mode: config.mode,
      lastSync: config.lastSync,
      installed: !!meta.installedAt,
      version: meta.version,
      renderConfigured: meta.renderedConfigured
    };
  }

  checkSync() {
    const syncEngine = getSyncEngine();
    const status = syncEngine.getStatus();
    
    return {
      status: status.online ? 'ok' : 'warn',
      online: status.online,
      processing: status.processing,
      pendingDrafts: status.drafts?.unsynced || 0,
      pendingQueue: status.queue?.pending || 0,
      failedQueue: status.queue?.failed || 0
    };
  }

  checkEnvironment() {
    const required = ['MONGODB_URI', 'JWT_SECRET'];
    const missing = required.filter(k => !process.env[k]);
    
    return {
      status: missing.length === 0 ? 'ok' : 'fail',
      missing: missing.length > 0 ? missing : undefined,
      nodeVersion: process.version,
      platform: process.platform
    };
  }

  checkStorage() {
    const stats = offlineStorage.getStorageStats();
    
    return {
      status: 'ok',
      path: stats.storagePath,
      drafts: stats.drafts.total,
      queue: stats.queue.total
    };
  }

  // Express middleware for /api/setup/health
  middleware() {
    return async (req, res) => {
      try {
        const result = await this.runAll();
        const statusCode = result.healthy ? 200 : 503;
        res.status(statusCode).json({
          success: result.healthy,
          data: result
        });
      } catch (e) {
        res.status(500).json({
          success: false,
          data: { healthy: false, error: e.message }
        });
      }
    };
  }
}

// Singleton
let instance = null;
function getSetupStatus() {
  if (!instance) instance = new SetupStatus();
  return instance;
}

module.exports = { SetupStatus, getSetupStatus };