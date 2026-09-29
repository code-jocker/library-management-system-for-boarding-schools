// js/core/socket.js
// Thin wrapper around the global Socket.IO client. Lazy-connects only after
// the librarian has a JWT token so we never talk to the server unauthenticated.
import { getToken } from './auth.js';
import { getState, subscribe } from './store.js';

let socket = null;
const listeners = new Map();

export function connectSocket() {
  if (socket) return socket;
  if (!window.io) {
    console.warn('[socket] io not loaded; real-time updates disabled');
    return null;
  }

  const token = getToken();
  if (!token) return null;

  const apiBase = (typeof window !== 'undefined' && window.LMS_API_BASE) || '/api';
  const serverUrl = apiBase.replace(/\/api$/, '');

  socket = window.io(serverUrl, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelayMax: 5000
  });

  socket.on('connect', () => console.log('[socket] connected'));
  socket.on('disconnect', (reason) => console.log('[socket] disconnected:', reason));
  socket.on('connect_error', (err) => console.warn('[socket] connection error:', err.message));

  // Re-emit to local subscribers.
  for (const [event, handler] of listeners) {
    socket.on(event, handler);
  }

  return socket;
}

// Subscribe to a named event. Returns an unsubscribe function.
export function onSocket(event, callback) {
  listeners.set(event, callback);
  if (socket) socket.on(event, callback);
  return () => {
    listeners.delete(event);
    if (socket) socket.off(event, callback);
  };
}

// Send an event to the server (if connected).
export function emitSocket(event, ...args) {
  if (socket && socket.connected) {
    socket.emit(event, ...args);
  }
}

// Connect when the user logs in; disconnect on logout.
subscribe('user', (user) => {
  if (user && getToken()) connectSocket();
  else if (!user && socket) {
    socket.disconnect();
    socket = null;
  }
});

export function getSocket() {
  return socket;
}
