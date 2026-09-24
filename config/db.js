// config/db.js
// Single place to connect to MongoDB via Mongoose.
const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('[db] MONGODB_URI is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }

  mongoose.set('strictQuery', true);

  try {
    const conn = await mongoose.connect(uri, {
      // Mongoose 8 auto-retries; keep sockets alive on flaky school internet.
      serverSelectionTimeoutMS: 15000,
      maxPoolSize: 10
    });
    console.log(`[db] MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
    return conn;
  } catch (err) {
    console.error('[db] MongoDB connection failed:', err.message);
    // Exit so the host (Render/Railway) can restart the process.
    process.exit(1);
  }
}

module.exports = connectDB;
