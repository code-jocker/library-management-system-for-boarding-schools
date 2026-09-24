// seed/seedLibrarian.js
// Creates the single system user: UMUTONI JEANNETTE (librarian).
// Run: npm run seed:librarian
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Setting = require('../models/Setting');

const LIBRARIAN = {
  username: 'umutoni.jeannette',
  fullName: 'Umutoni Jeannette',
  role: 'librarian',
  email: 'umutoni.jeannette@greenhills.rw',
  phone: '+250 788 000 000'
};

async function seed() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set. Copy .env.example to .env first.');
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log('[seed] Connected to MongoDB');

  // Ensure settings document exists.
  await Setting.get();

  const defaultPassword = process.env.DEFAULT_LIBRARIAN_PASSWORD || 'Librarian@2024';
  const existing = await User.findOne({ username: LIBRARIAN.username });

  if (existing) {
    console.log(`[seed] Librarian "${existing.username}" already exists. Skipping.`);
    console.log('[seed] To reset her password, delete the user and re-run this script.');
  } else {
    const passwordHash = await User.hashPassword(defaultPassword);
    await User.create({ ...LIBRARIAN, passwordHash, mustChangePassword: true });
    console.log('[seed] Created librarian account:');
    console.log(`        username: ${LIBRARIAN.username}`);
    console.log(`        password: ${defaultPassword}   (she must change it on first login)`);
  }

  await mongoose.disconnect();
  console.log('[seed] Done.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('[seed] Failed:', err);
  process.exit(1);
});
