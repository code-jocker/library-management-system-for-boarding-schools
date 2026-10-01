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
  email: 'umutoni.jeannette@kageyo.rw',
  phone: '+250 788 000 000'
};

// The initial password. There is deliberately NO hardcoded fallback: a default
// baked into this file would be a publicly known password, since this repository
// is the only place the account is ever created from.
const PASSWORD_MIN_LENGTH = 12;

function resolveInitialPassword() {
  const fromEnv = process.env.DEFAULT_LIBRARIAN_PASSWORD;
  if (!fromEnv) {
    console.error(
      'DEFAULT_LIBRARIAN_PASSWORD is not set.\n' +
      'Choose a strong one-off password, for example:\n' +
      '  DEFAULT_LIBRARIAN_PASSWORD="$(openssl rand -base64 18)" npm run seed:librarian\n' +
      'She will be forced to change it on first login. Unset the variable afterwards.'
    );
    process.exit(1);
  }
  if (fromEnv.length < PASSWORD_MIN_LENGTH) {
    console.error(
      `DEFAULT_LIBRARIAN_PASSWORD must be at least ${PASSWORD_MIN_LENGTH} characters. ` +
      'A short or guessable initial password is a real risk on a public URL.'
    );
    process.exit(1);
  }
  return fromEnv;
}

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

  const existing = await User.findOne({ username: LIBRARIAN.username });

  if (existing) {
    // Never touch an existing account. This script runs on a production
    // database, and resetting a password here would undo a change the librarian
    // made in the admin panel.
    console.log(`[seed] Librarian "${existing.username}" already exists. Leaving it untouched.`);
    console.log('[seed] To reset her password, use the change-password flow after logging in.');
    await mongoose.disconnect();
    process.exit(0);
  }

  const defaultPassword = resolveInitialPassword();
  const passwordHash = await User.hashPassword(defaultPassword);
  await User.create({ ...LIBRARIAN, passwordHash, mustChangePassword: true });
  console.log('[seed] Created librarian account:');
  console.log(`        username: ${LIBRARIAN.username}`);
  console.log(`        password: ${defaultPassword}   (she must change it on first login)`);
  console.log('[seed] Unset DEFAULT_LIBRARIAN_PASSWORD now that the account exists.');

  await mongoose.disconnect();
  console.log('[seed] Done.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('[seed] Failed:', err);
  process.exit(1);
});
