// utils/syncEngine.js
// Online/offline synchronization engine with conflict resolution
const offlineStorage = require('./offlineStorage');
const mongoose = require('mongoose');

const MODELS = {
  Member: require('../models/Member'),
  Book: require('../models/Book'),
  Transaction: require('../models/Transaction'),
  Fine: require('../models/Fine'),
  Reservation: require('../models/Reservation'),
  Category: require('../models/Category'),
  Setting: require('../models/Setting'),
  ActivityLog: require('../models/ActivityLog'),
  Notification: require('../models/Notification')
};

class SyncEngine {
  constructor(options = {}) {
    this.serverUrl = options.serverUrl || process.env.CLIENT_ORIGIN || 'http://localhost:5000';
    this.isOnline = false;
    this.syncInterval = null;
    this.processing = false;
    this.listeners = new Map();
    this.conflictStrategies = {
      'server-wins': this.resolveServerWins.bind(this),
      'client-wins': this.resolveClientWins.bind(this),
      'merge': this.resolveMerge.bind(this),
      'manual': this.resolveManual.bind(this)
    };
  }

  // ==================== CONNECTION MANAGEMENT ====================

  async checkConnectivity() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      // For Node.js environment, check MongoDB connection
      if (typeof window === 'undefined') {
        this.isOnline = mongoose.connection.readyState === 1;
        if (this.isOnline) {
          await mongoose.connection.db.admin().ping();
        }
      } else {
        // Browser environment - fetch to server
        const response = await fetch(`${this.serverUrl}/api/health`, {
          method: 'GET',
          signal: controller.signal,
          cache: 'no-cache'
        });
        this.isOnline = response.ok;
      }
      
      clearTimeout(timeout);
      this.emit('connectivity', { online: this.isOnline });
      return this.isOnline;
    } catch (e) {
      const wasOnline = this.isOnline;
      this.isOnline = false;
      if (wasOnline !== false) {
        this.emit('connectivity', { online: false, error: e.message });
      }
      return false;
    }
  }

  setOnline(online) {
    const wasOnline = this.isOnline;
    this.isOnline = online;
    if (wasOnline !== online) {
      this.emit('connectivity', { online: this.isOnline });
      if (online) this.processQueue();
    }
  }

  // ==================== SYNC PROCESSING ====================

  startAutoSync(intervalMs = 30000) {
    if (this.syncInterval) clearInterval(this.syncInterval);
    this.syncInterval = setInterval(() => {
      if (this.isOnline && !this.processing) {
        this.processQueue();
      }
    }, intervalMs);
    // Initial sync
    this.processQueue();
  }

  stopAutoSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  async processQueue() {
    if (this.processing || !this.isOnline) return;
    
    this.processing = true;
    this.emit('sync:start');
    
    try {
      const pending = offlineStorage.getPendingSyncItems();
      
      for (const item of pending) {
        if (!this.isOnline) break;
        
        try {
          await this.processSyncItem(item);
          offlineStorage.markSyncCompleted(item.id);
          this.emit('sync:item:success', { item });
        } catch (error) {
          offlineStorage.markSyncFailed(item.id, error.message);
          this.emit('sync:item:error', { item, error });
        }
      }
      
      // Also process unsynced drafts
      const drafts = offlineStorage.getUnsyncedDrafts();
      for (const draft of drafts) {
        if (!this.isOnline) break;
        
        try {
          await this.processDraft(draft);
          offlineStorage.markDraftSynced(draft.id);
          this.emit('sync:draft:success', { draft });
        } catch (error) {
          this.emit('sync:draft:error', { draft, error });
        }
      }
      
      offlineStorage.updateLastSync();
    } finally {
      this.processing = false;
      this.emit('sync:complete');
    }
  }

  async processSyncItem(item) {
    const Model = MODELS[item.collection];
    if (!Model) throw new Error(`Unknown collection: ${item.collection}`);

    const strategy = this.conflictStrategies[item.options?.conflictStrategy || 'server-wins'];
    
    switch (item.operation) {
      case 'create':
        return await this.syncCreate(Model, item.payload, strategy);
      case 'update':
        return await this.syncUpdate(Model, item.payload, strategy);
      case 'delete':
        return await this.syncDelete(Model, item.payload, strategy);
      case 'bulk':
        return await this.syncBulk(Model, item.payload, strategy);
      default:
        throw new Error(`Unknown operation: ${item.operation}`);
    }
  }

  async processDraft(draft) {
    const Model = MODELS[draft.collection];
    if (!Model) throw new Error(`Unknown collection: ${draft.collection}`);

    const strategy = this.conflictStrategies['server-wins']; // Default for drafts
    
    switch (draft.operation) {
      case 'create':
        return await this.syncCreate(Model, draft.data, strategy, draft.originalId);
      case 'update':
        return await this.syncUpdate(Model, { ...draft.data, _id: draft.originalId }, strategy);
      case 'delete':
        return await this.syncDelete(Model, { _id: draft.originalId }, strategy);
      default:
        throw new Error(`Unknown draft operation: ${draft.operation}`);
    }
  }

  // ==================== CRUD SYNC OPERATIONS ====================

  async syncCreate(Model, data, strategy, localId = null) {
    const existing = localId ? await Model.findById(localId).lean() : null;
    
    if (existing) {
      // Already exists on server, treat as update
      return this.syncUpdate(Model, { ...data, _id: localId }, strategy);
    }
    
    // Check for duplicates by unique fields
    const duplicate = await this.findDuplicate(Model, data);
    if (duplicate) {
      return await strategy(Model, data, duplicate, 'create');
    }
    
    const created = await Model.create(data);
    return created;
  }

  async syncUpdate(Model, data, strategy) {
    const { _id, ...updateData } = data;
    if (!_id) throw new Error('Update requires _id');
    
    const existing = await Model.findById(_id).lean();
    if (!existing) {
      // Doesn't exist on server, create instead
      return this.syncCreate(Model, data, strategy);
    }
    
    return await strategy(Model, updateData, existing, 'update');
  }

  async syncDelete(Model, data, strategy) {
    const { _id } = data;
    if (!_id) throw new Error('Delete requires _id');
    
    const existing = await Model.findById(_id).lean();
    if (!existing) {
      // Already deleted
      return { deleted: true, alreadyGone: true };
    }
    
    return await strategy(Model, null, existing, 'delete');
  }

  async syncBulk(Model, items, strategy) {
    const results = [];
    for (const item of items) {
      try {
        let result;
        switch (item.operation) {
          case 'create':
            result = await this.syncCreate(Model, item.data, strategy);
            break;
          case 'update':
            result = await this.syncUpdate(Model, item.data, strategy);
            break;
          case 'delete':
            result = await this.syncDelete(Model, item.data, strategy);
            break;
        }
        results.push({ success: true, result, originalId: item.localId });
      } catch (e) {
        results.push({ success: false, error: e.message, originalId: item.localId });
      }
    }
    return results;
  }

  // ==================== CONFLICT RESOLUTION ====================

  async resolveServerWins(Model, clientData, serverDoc, operation) {
    // Server always wins - return server version
    if (operation === 'delete') {
      return { deleted: true, conflict: true, resolution: 'server-wins' };
    }
    return { ...serverDoc.toObject(), _conflict: true, _resolution: 'server-wins' };
  }

  async resolveClientWins(Model, clientData, serverDoc, operation) {
    // Client wins - overwrite server
    if (operation === 'delete') {
      await Model.findByIdAndDelete(serverDoc._id);
      return { deleted: true, conflict: true, resolution: 'client-wins' };
    }
    if (operation === 'create') {
      const created = await Model.create(clientData);
      return { ...created.toObject(), _conflict: true, _resolution: 'client-wins' };
    }
    const updated = await Model.findByIdAndUpdate(
      serverDoc._id,
      { $set: clientData },
      { new: true, runValidators: true }
    );
    return { ...updated.toObject(), _conflict: true, _resolution: 'client-wins' };
  }

  async resolveMerge(Model, clientData, serverDoc, operation) {
    if (operation === 'delete') {
      // Can't merge a delete - server wins
      return this.resolveServerWins(Model, clientData, serverDoc, operation);
    }
    
    // Merge: client fields override server, but keep server-only fields
    const merged = { ...serverDoc.toObject() };
    Object.keys(clientData).forEach(key => {
      if (key !== '_id' && key !== '__v' && key !== 'createdAt' && key !== 'updatedAt') {
        merged[key] = clientData[key];
      }
    });
    
    const updated = await Model.findByIdAndUpdate(
      serverDoc._id,
      { $set: merged },
      { new: true, runValidators: true }
    );
    return { ...updated.toObject(), _conflict: true, _resolution: 'merge' };
  }

  async resolveManual(Model, clientData, serverDoc, operation) {
    // Queue for manual resolution - store both versions
    const conflict = {
      id: `conflict_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      collection: Model.modelName,
      operation,
      clientData,
      serverData: serverDoc.toObject(),
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    
    // Store in offline storage for later manual resolution
    const conflicts = offlineStorage.getConflicts ? offlineStorage.getConflicts() : [];
    conflicts.push(conflict);
    if (offlineStorage.saveConflicts) offlineStorage.saveConflicts(conflicts);
    
    this.emit('conflict:manual', conflict);
    throw new Error(`Manual conflict resolution required for ${Model.modelName}:${serverDoc._id}`);
  }

  // ==================== HELPER METHODS ====================

  async findDuplicate(Model, data) {
    // Check common unique fields
    const uniqueFields = ['isbn', 'admissionNo', 'email', 'username'];
    
    for (const field of uniqueFields) {
      if (data[field]) {
        const query = { [field]: data[field] };
        const existing = await Model.findOne(query).lean();
        if (existing) return existing;
      }
    }
    return null;
  }

  // ==================== EVENT SYSTEM ====================

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (!this.listeners.has(event)) return;
    const callbacks = this.listeners.get(event);
    const idx = callbacks.indexOf(callback);
    if (idx !== -1) callbacks.splice(idx, 1);
  }

  emit(event, data) {
    if (!this.listeners.has(event)) return;
    this.listeners.get(event).forEach(cb => {
      try { cb(data); } catch (e) { console.error(`[syncEngine] Event error:`, e); }
    });
  }

  // ==================== PUBLIC API ====================

  async forceSync() {
    if (!this.isOnline) {
      throw new Error('Cannot sync while offline');
    }
    return this.processQueue();
  }

  getStatus() {
    const stats = offlineStorage.getStorageStats();
    return {
      online: this.isOnline,
      processing: this.processing,
      ...stats
    };
  }

  async resolveConflict(conflictId, resolution, mergedData = null) {
    const conflicts = offlineStorage.getConflicts ? offlineStorage.getConflicts() : [];
    const conflict = conflicts.find(c => c.id === conflictId);
    if (!conflict) throw new Error('Conflict not found');
    
    const Model = MODELS[conflict.collection];
    let result;
    
    switch (resolution) {
      case 'server-wins':
        result = await this.resolveServerWins(Model, conflict.clientData, conflict.serverData, conflict.operation);
        break;
      case 'client-wins':
        result = await this.resolveClientWins(Model, conflict.clientData, conflict.serverData, conflict.operation);
        break;
      case 'merge':
        result = await this.resolveMerge(Model, mergedData || conflict.clientData, conflict.serverData, conflict.operation);
        break;
    }
    
    conflict.status = 'resolved';
    conflict.resolution = resolution;
    conflict.resolvedAt = new Date().toISOString();
    if (offlineStorage.saveConflicts) offlineStorage.saveConflicts(conflicts);
    
    this.emit('conflict:resolved', conflict);
    return result;
  }
}

// Singleton instance
let syncEngineInstance = null;

function getSyncEngine(options) {
  if (!syncEngineInstance) {
    syncEngineInstance = new SyncEngine(options);
  }
  return syncEngineInstance;
}

module.exports = { SyncEngine, getSyncEngine };