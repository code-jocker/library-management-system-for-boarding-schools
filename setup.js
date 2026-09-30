// setup.js
// Cross-platform setup orchestrator for the Library Management System.
// Works online (Render database) and offline (local draft storage).
// Usage:
//   node setup.js status          - Print setup status
//   node setup.js online          - Configure online mode (Render DB)
//   node setup.js offline         - Configure offline mode (local storage)
//   node setup.js init            - Initialize system (librarian + settings)
//   node setup.js sync            - Force sync now
//   node setup.js conflicts       - List pending conflicts
//   node setup.js resolve <id>    - Resolve a conflict
//   node setup.js reset           - Reset offline storage (dangerous)

const offlineStorage = require('./utils/offlineStorage');
const { getSyncEngine } = require('./utils/syncEngine');

// ---------- Helpers ----------

function print(title, data) {
  console.log(`\n=== ${title} ===`);
  console.log(JSON.stringify(data, null, 2));
}

function fail(msg) {
  console.error(`[setup] ERROR: ${msg}`);
  process.exit(1);
}

async function checkServer() {
  const syncEngine = getSyncEngine();
  const online = await syncEngine.checkConnectivity();
  return { online, status: syncEngine.getStatus() };
}

// ---------- Commands ----------

async function cmdStatus() {
  const syncEngine = getSyncEngine();
  const online = await syncEngine.checkConnectivity();
  const status = syncEngine.getStatus();
  const stats = offlineStorage.getStorageStats();

  print('Setup Status', {
    online,
    mode: stats.config.mode,
    lastSync: stats.config.lastSync,
    install: {
      installedAt: stats.meta.installedAt,
      version: stats.meta.version,
      installId: stats.meta.installId,
      renderConfigured: stats.meta.renderedConfigured
    },
    drafts: stats.drafts,
    queue: stats.queue,
    conflicts: offlineStorage.getPendingConflicts().length,
    storagePath: stats.storagePath
  });
}

async function cmdOnline() {
  console.log('[setup] Configuring online mode...');
  offlineStorage.setMode('online');

  const syncEngine = getSyncEngine();
  const online = await syncEngine.checkConnectivity();

  if (!online) {
    console.log('[setup] Server not reachable. Check MONGODB_URI and network.');
    console.log('[setup] Offline storage will queue changes until connection restored.');
    offlineStorage.setMode('auto');
    return;
  }

  syncEngine.startAutoSync(30000);
  console.log('[setup] Online mode active. Auto-sync every 30s.');
}

async function cmdOffline() {
  console.log('[setup] Configuring offline mode...');
  offlineStorage.setMode('offline');

  const syncEngine = getSyncEngine();
  syncEngine.setOnline(false);
  syncEngine.stopAutoSync();

  console.log('[setup] Offline mode active.');
  console.log('[setup] Changes will be stored locally and synced when online.');
}

async function cmdInit() {
  const pkg = require('./package.json');
  const mongoose = require('mongoose');

  if (mongoose.connection.readyState !== 1) {
    fail('Database not connected. Set MONGODB_URI and restart.');
  }

  // Check if already initialized
  const Setting = require('./models/Setting');
  const User = require('./models/User');
  const settings = await Setting.get();
  const existingLibrarian = await User.findOne({ username: 'umutoni.jeannette' });

  if (existingLibrarian && settings.schoolName) {
    console.log('[setup] System already initialized.');
    console.log(`  School: ${settings.schoolName}`);
    console.log(`  Librarian: ${existingLibrarian.username}`);
    return;
  }

  console.log('[setup] Initializing system...');
  offlineStorage.markInstalled(pkg.version);

  if (process.env.RENDER || process.env.MONGODB_URI?.includes('mongodb.net')) {
    offlineStorage.markRenderConfigured();
  }

  console.log('[setup] Initialization marked complete.');
  console.log('[setup] Set DEFAULT_LIBRARIAN_PASSWORD and run: npm run seed:librarian');
}

async function cmdSync() {
  const syncEngine = getSyncEngine();
  const online = await syncEngine.checkConnectivity();

  if (!online) {
    fail('Cannot sync while offline. Check connectivity.');
  }

  console.log('[setup] Running force sync...');
  await syncEngine.forceSync();
  const status = syncEngine.getStatus();
  print('Sync Complete', status);
}

async function cmdConflicts() {
  const conflicts = offlineStorage.getPendingConflicts();
  if (conflicts.length === 0) {
    console.log('[setup] No pending conflicts.');
    return;
  }

  print('Pending Conflicts', conflicts.map(c => ({
    id: c.id,
    collection: c.collection,
    operation: c.operation,
    status: c.status,
    createdAt: c.createdAt
  })));
}

async function cmdResolve(conflictId, resolution, mergedData) {
  const syncEngine = getSyncEngine();
  const result = await syncEngine.resolveConflict(
    conflictId,
    resolution,
    mergedData ? JSON.parse(mergedData) : null
  );
  print('Conflict Resolved', result);
}

async function cmdReset() {
  console.log('[setup] WARNING: This will delete all offline data!');
  console.log('[setup] Pass --confirm=yes to proceed.');
  if (process.argv.includes('--confirm=yes')) {
    offlineStorage.resetOfflineStorage();
    console.log('[setup] Offline storage reset.');
  } else {
    console.log('[setup] Aborted. Use --confirm=yes to proceed.');
  }
}

// ---------- Main ----------

const args = process.argv.slice(2);
const command = args[0];

(async () => {
  switch (command) {
    case 'status': await cmdStatus(); break;
    case 'online': await cmdOnline(); break;
    case 'offline': await cmdOffline(); break;
    case 'init': await cmdInit(); break;
    case 'sync': await cmdSync(); break;
    case 'conflicts': await cmdConflicts(); break;
    case 'resolve':
      await cmdResolve(args[1], args[2], args[3]);
      break;
    case 'reset': await cmdReset(); break;
    default:
      console.log('Usage: node setup.js <command>');
      console.log('  status          - Print setup status');
      console.log('  online          - Configure online mode (Render DB)');
      console.log('  offline         - Configure offline mode (local storage)');
      console.log('  init            - Initialize system');
      console.log('  sync            - Force sync now');
      console.log('  conflicts       - List pending conflicts');
      console.log('  resolve <id> <resolution> [mergedData]  - Resolve conflict');
      console.log('  reset --confirm=yes  - Reset offline storage');
      process.exit(1);
  }
})().catch(err => {
  console.error('[setup] Fatal error:', err);
  process.exit(1);
});