// utils/eventBus.js
// Thin wrapper around the Socket.IO instance so controllers can emit
// real-time events without importing the io object directly.
let io = null;

function init(ioInstance) {
  io = ioInstance;
}

// Broadcast an event to all connected clients.
function emit(event, payload) {
  if (!io) {
    console.warn('[eventBus] io not initialised; dropping event', event);
    return;
  }
  io.emit(event, payload);
}

// Broadcast to a specific room (e.g. user id).
function emitTo(room, event, payload) {
  if (!io) return;
  io.to(room).emit(event, payload);
}

module.exports = { init, emit, emitTo };
