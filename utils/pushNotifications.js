// utils/pushNotifications.js
// Sends web push notifications to subscribed browsers.
// VAPID keys are set via env vars PUSH_PUBLIC_KEY and PUSH_PRIVATE_KEY (base64 URL-safe).
let webpush = null;
let configured = false;

function init() {
  if (!process.env.PUSH_PUBLIC_KEY || !process.env.PUSH_PRIVATE_KEY) {
    console.warn('[push] PUSH_PUBLIC_KEY / PUSH_PRIVATE_KEY not set — push notifications disabled');
    return;
  }
  try {
    webpush = require('web-push');
    webpush.setVapidDetails(
      'mailto:library@greenthills.rw',
      process.env.PUSH_PUBLIC_KEY,
      process.env.PUSH_PRIVATE_KEY
    );
    configured = true;
    console.log('[push] web-push initialised');
  } catch (err) {
    console.warn('[push] web-push failed to initialise:', err.message);
  }
}

function isConfigured() {
  return configured;
}

function publicKey() {
  return process.env.PUSH_PUBLIC_KEY || null;
}

// Send a notification to a single subscription object.
// Never throws — callers handle the returned status.
async function send(subscription, title, body, url = '/') {
  if (!configured || !webpush) return { ok: false, skipped: true, error: 'Push not configured' };
  try {
    await webpush.sendNotification(subscription, JSON.stringify({ title, body, url }));
    return { ok: true };
  } catch (err) {
    // 410 Gone = subscription is stale, caller may want to delete it.
    return { ok: false, error: err.message, status: err.statusCode, gone: err.statusCode === 410 };
  }
}

// Convenience: send to all subscriptions for a given user id.
async function sendToUser(subscriptions, title, body, url = '/') {
  const results = [];
  for (const sub of subscriptions) {
    const r = await send(sub, title, body, url);
    results.push({ endpoint: sub.endpoint, ...r });
  }
  return results;
}

module.exports = { init, isConfigured, send, sendToUser };
