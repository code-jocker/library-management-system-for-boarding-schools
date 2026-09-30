// utils/offlineStorage.js
// Offline-first storage with IndexedDB (browser) / SQLite (Node) fallback
const fs = require('fs');
const path = require('path');
const os = require('os');

const STORAGE_DIR = path.join(os.homedir(), '.library-system', 'offline');
const DRAFTS_FILE = path.join(STORAGE_DIR, 'drafts.json');
const QUEUE_FILE = path.join(STORAGE_DIR, 'sync-queue.json');
const CONFIG_FILE = path.join(STORAGE_DIR, 'config.json');
const META_FILE = path.join(STORAGE_DIR, 'meta.json');

function ensureStorageDir() {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

function readJSON(file, fallback = {}) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) {
    console.error(`[offlineStorage] Failed to read ${file}:`, e.message);
  }
  return fallback;
}

function writeJSON(file, data) {
  ensureStorageDir();
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error(`[offlineStorage] Failed to write ${file}:`, e.message);
    return false;
  }
}

// ==================== DRAFTS (Local mutations) ====================

function getDrafts() {
  return readJSON(DRAFTS_FILE, []);
}

function saveDraft(collection, operation, data, originalId = null) {
  const drafts = getDrafts();
  const draft = {
    id: `draft_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    collection,
    operation, // 'create', 'update', 'delete'
    data,
    originalId,
    timestamp: new Date().toISOString(),
    synced: false,
    retryCount: 0
  };
  drafts.push(draft);
  writeJSON(DRAFTS_FILE, drafts);
  return draft;
}

function markDraftSynced(draftId) {
  const drafts = getDrafts();
  const idx = drafts.findIndex(d => d.id === draftId);
  if (idx !== -1) {
    drafts[idx].synced = true;
    drafts[idx].syncedAt = new Date().toISOString();
    writeJSON(DRAFTS_FILE, drafts);
  }
}

function removeDraft(draftId) {
  const drafts = getDrafts().filter(d => d.id !== draftId);
  writeJSON(DRAFTS_FILE, drafts);
}

function getUnsyncedDrafts() {
  return getDrafts().filter(d => !d.synced);
}

function clearSyncedDrafts() {
  const drafts = getDrafts().filter(d => !d.synced);
  writeJSON(DRAFTS_FILE, drafts);
}

// ==================== SYNC QUEUE (Ordered operations) ====================

function getSyncQueue() {
  return readJSON(QUEUE_FILE, []);
}

function enqueueSync(collection, operation, payload, options = {}) {
  const queue = getSyncQueue();
  const item = {
    id: `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    collection,
    operation, // 'create', 'update', 'delete', 'bulk'
    payload,
    options, // { upsert: true, conflictStrategy: 'server-wins' | 'client-wins' | 'merge' }
    timestamp: new Date().toISOString(),
    status: 'pending', // pending, processing, completed, failed
    attempts: 0,
    lastError: null
  };
  queue.push(item);
  writeJSON(QUEUE_FILE, queue);
  return item;
}

function dequeueSync() {
  const queue = getSyncQueue();
  const pending = queue.find(q => q.status === 'pending');
  if (pending) {
    pending.status = 'processing';
    pending.attempts++;
    writeJSON(QUEUE_FILE, queue);
    return pending;
  }
  return null;
}

function markSyncCompleted(syncId) {
  const queue = getSyncQueue();
  const idx = queue.findIndex(q => q.id === syncId);
  if (idx !== -1) {
    queue[idx].status = 'completed';
    queue[idx].completedAt = new Date().toISOString();
    writeJSON(QUEUE_FILE, queue);
  }
}

function markSyncFailed(syncId, error) {
  const queue = getSyncQueue();
  const idx = queue.findIndex(q => q.id === syncId);
  if (idx !== -1) {
    queue[idx].status = 'failed';
    queue[idx].lastError = error;
    if (queue[idx].attempts >= 5) {
      queue[idx].status = 'dead-letter';
    }
    writeJSON(QUEUE_FILE, queue);
  }
}

function getPendingSyncItems() {
  return getSyncQueue().filter(q => q.status === 'pending' || q.status === 'processing');
}

function getFailedSyncItems() {
  return getSyncQueue().filter(q => q.status === 'failed' || q.status === 'dead-letter');
}

function retryFailedSync(syncId) {
  const queue = getSyncQueue();
  const idx = queue.findIndex(q => q.id === syncId);
  if (idx !== -1) {
    queue[idx].status = 'pending';
    queue[idx].attempts = 0;
    queue[idx].lastError = null;
    writeJSON(QUEUE_FILE, queue);
  }
}

function clearCompletedSync() {
  const queue = getSyncQueue().filter(q => q.status !== 'completed');
  writeJSON(QUEUE_FILE, queue);
}

// ==================== CONFIG (App settings) ====================

function getOfflineConfig() {
  return readJSON(CONFIG_FILE, {
    mode: 'online', // online, offline, auto
    lastSync: null,
    syncInterval: 30000, // 30 seconds
    autoSync: true,
    serverUrl: null
  });
}

function saveOfflineConfig(config) {
  return writeJSON(CONFIG_FILE, { ...getOfflineConfig(), ...config });
}

function setMode(mode) {
  return saveOfflineConfig({ mode, lastModeChange: new Date().toISOString() });
}

function setServerUrl(url) {
  return saveOfflineConfig({ serverUrl: url });
}

function updateLastSync() {
  return saveOfflineConfig({ lastSync: new Date().toISOString() });
}

// ==================== META (Installation info) ====================

function getMeta() {
  return readJSON(META_FILE, {
    installedAt: null,
    version: null,
    installId: null,
    renderedConfigured: false
  });
}

function saveMeta(meta) {
  return writeJSON(META_FILE, { ...getMeta(), ...meta });
}

function markInstalled(version) {
  return saveMeta({
    installedAt: new Date().toISOString(),
    version,
    installId: `install_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  });
}

function markRenderConfigured() {
  return saveMeta({ renderedConfigured: true });
}

const CONFLICTS_FILE = path.join(STORAGE_DIR, 'conflicts.json');

function getConflicts() {
  return readJSON(CONFLICTS_FILE, []);
}

function saveConflicts(conflicts) {
  return writeJSON(CONFLICTS_FILE, conflicts);
}

function addConflict(conflict) {
  const conflicts = getConflicts();
  conflicts.push(conflict);
  writeJSON(CONFLICTS_FILE, conflicts);
  return conflict;
}

function updateConflict(conflictId, updates) {
  const conflicts = getConflicts();
  const idx = conflicts.findIndex(c => c.id === conflictId);
  if (idx !== -1) {
    conflicts[idx] = { ...conflicts[idx], ...updates };
    writeJSON(CONFLICTS_FILE, conflicts);
    return conflicts[idx];
  }
  return null;
}

function getPendingConflicts() {
  return getConflicts().filter(c => c.status === 'pending');
}

// ==================== UTILITY ====================

function getStorageStats() {
  const drafts = getDrafts();
  const queue = getSyncQueue();
  const config = getOfflineConfig();
  const meta = getMeta();
  
  return {
    drafts: {
      total: drafts.length,
      unsynced: drafts.filter(d => !d.synced).length,
      byCollection: drafts.reduce((acc, d) => {
        acc[d.collection] = (acc[d.collection] || 0) + 1;
        return acc;
      }, {})
    },
    queue: {
      total: queue.length,
      pending: queue.filter(q => q.status === 'pending').length,
      processing: queue.filter(q => q.status === 'processing').length,
      completed: queue.filter(q => q.status === 'completed').length,
      failed: queue.filter(q => q.status === 'failed').length,
      deadLetter: queue.filter(q => q.status === 'dead-letter').length
    },
    config,
    meta,
    storagePath: STORAGE_DIR
  };
}

function resetOfflineStorage() {
  [DRAFTS_FILE, QUEUE_FILE, CONFIG_FILE, META_FILE].forEach(f => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });
}

module.exports = {
  // Drafts
  getDrafts,
  saveDraft,
  markDraftSynced,
  removeDraft,
  getUnsyncedDrafts,
  clearSyncedDrafts,
  
  // Sync Queue
  getSyncQueue,
  enqueueSync,
  dequeueSync,
  markSyncCompleted,
  markSyncFailed,
  getPendingSyncItems,
  getFailedSyncItems,
  retryFailedSync,
  clearCompletedSync,
  
  // Config
  getOfflineConfig,
  saveOfflineConfig,
  setMode,
  setServerUrl,
  updateLastSync,
  
  // Meta
  getMeta,
  saveMeta,
  markInstalled,
  markRenderConfigured,
  
  // Conflicts
  getConflicts,
  saveConflicts,
  addConflict,
  updateConflict,
  getPendingConflicts,
  
  // Utils
  getStorageStats,
  resetOfflineStorage,
  STORAGE_DIR
};