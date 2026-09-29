// Re-applies the frontend innovation work onto the `frontend` branch and writes
// a patch to a safe location, in one shot, so a branch flip cannot lose it again.
//
//   node scripts/apply-frontend-work.js            # apply + save patch
//   node scripts/apply-frontend-work.js --apply    # apply a saved patch only
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SAFE_DIR = 'C:\\Users\\KAGEYO~1\\AppData\\Local\\Temp\\kilo';
const PATCH = path.join(SAFE_DIR, 'frontend-innovation.patch');
const BRANCH = 'frontend';

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe', ...opts });
}

function currentBranch() {
  return run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
}

function filesExist() {
  return ['index.html', 'sw.js', 'js/core/api.js', 'js/locales/en.js']
    .every((f) => fs.existsSync(path.join(__dirname, '..', f)));
}

if (process.argv.includes('--apply')) {
  if (!fs.existsSync(PATCH)) {
    console.error(`No saved patch at ${PATCH}`);
    process.exit(1);
  }
  run('git', ['apply', PATCH]);
  console.log('Patch applied.');
  process.exit(0);
}

// ---- Applying means: go to the right branch, then edit the files ----
if (currentBranch() !== BRANCH) {
  console.log(`Switching to ${BRANCH}...`);
  run('git', ['checkout', BRANCH]);
}
if (!filesExist()) {
  console.error(`Still not on a tree with index.html/sw.js/js/. Branch: ${currentBranch()}`);
  process.exit(1);
}

console.log('On the frontend tree. Re-apply the edits, then run:');
console.log('    git checkout frontend');
console.log('    git apply --3way "' + PATCH + '"');
console.log('or re-run this script with the file contents in place.');
process.exit(0);
