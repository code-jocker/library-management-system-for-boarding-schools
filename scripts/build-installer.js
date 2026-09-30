// scripts/build-installer.js
// Builds a self-contained installation package for offline deployment
// Usage: node scripts/build-installer.js [--output=./dist]

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const packageJson = require('../package.json');

const PROJECT_ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'dist');
const INSTALLER_DIR = path.join(OUTPUT_DIR, 'library-system-installer');
const VERSION = packageJson.version;

function log(msg) {
  console.log(`[build-installer] ${msg}`);
}

function run(cmd, cwd = PROJECT_ROOT) {
  log(`Running: ${cmd}`);
  try {
    execSync(cmd, { cwd, stdio: 'inherit' });
    return true;
  } catch (e) {
    log(`ERROR: ${e.message}`);
    return false;
  }
}

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

function copyDir(src, dest, exclude = []) {
  if (!fs.existsSync(src)) return;
  
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (exclude.some(pattern => entry.name.match(pattern))) continue;
    
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDir(srcPath, destPath, exclude);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function buildInstaller() {
  log(`Building installer v${VERSION}...`);
  
  // 1. Clean output directory
  cleanDir(INSTALLER_DIR);
  
  // 2. Copy source files (exclude node_modules, .git, dist, etc.)
  const excludePatterns = [
    /^node_modules$/,
    /^\.git$/,
    /^dist$/,
    /^\.kilo$/,
    /^\.env/,
    /^firebase-debug\.log$/,
    /^.*\.log$/,
    /^\.DS_Store$/,
    /^test$/,
    /^scripts\/build-installer\.js$/
  ];
  
  log('Copying source files...');
  copyDir(PROJECT_ROOT, INSTALLER_DIR, excludePatterns);
  
  // 3. Install production dependencies in the installer
  log('Installing production dependencies...');
  if (!run('npm ci --omit=dev', INSTALLER_DIR)) {
    throw new Error('Failed to install dependencies');
  }
  
  // 4. Build CSS
  log('Building CSS...');
  if (!run('npm run build:css', INSTALLER_DIR)) {
    log('WARNING: CSS build failed, continuing...');
  }
  
  // 5. Create offline startup script
  log('Creating startup scripts...');
  createStartupScripts();
  
  // 6. Create installation README
  createInstallReadme();
  
  // 7. Create version info
  createVersionInfo();
  
  // 8. Create archive
  log('Creating archive...');
  createArchive();
  
  log(`Installer built successfully at: ${INSTALLER_DIR}`);
  log(`Archive created at: ${OUTPUT_DIR}/library-system-v${VERSION}.tar.gz`);
}

function createStartupScripts() {
  // Windows batch file
  const batContent = `@echo off
REM Library System Offline Installer
REM Run this to start the server in offline mode

set NODE_ENV=production
set PORT=5000
set CLIENT_ORIGIN=http://localhost:5000

echo ==========================================
echo  Library Management System - Offline Mode
echo  Version: ${VERSION}
echo ==========================================
echo.
echo Starting server on http://localhost:5000
echo Press Ctrl+C to stop
echo.

npm start
pause
`;
  fs.writeFileSync(path.join(INSTALLER_DIR, 'start-offline.bat'), batContent);
  
  // Linux/Mac shell script
  const shContent = `#!/bin/bash
# Library System Offline Installer
# Run this to start the server in offline mode

export NODE_ENV=production
export PORT=5000
export CLIENT_ORIGIN=http://localhost:5000

echo "=========================================="
echo "  Library Management System - Offline Mode"
echo "  Version: ${VERSION}"
echo "=========================================="
echo ""
echo "Starting server on http://localhost:5000"
echo "Press Ctrl+C to stop"
echo ""

npm start
`;
  const shPath = path.join(INSTALLER_DIR, 'start-offline.sh');
  fs.writeFileSync(shPath, shContent);
  fs.chmodSync(shPath, 0o755);
  
  // PowerShell script for Windows
  const ps1Content = `# Library System Offline Installer
# Run this to start the server in offline mode

\$env:NODE_ENV = "production"
\$env:PORT = "5000"
\$env:CLIENT_ORIGIN = "http://localhost:5000"

Write-Host "=========================================="
Write-Host "  Library Management System - Offline Mode"
Write-Host "  Version: ${VERSION}"
Write-Host "=========================================="
Write-Host ""
Write-Host "Starting server on http://localhost:5000"
Write-Host "Press Ctrl+C to stop"
Write-Host ""

npm start
`;
  fs.writeFileSync(path.join(INSTALLER_DIR, 'start-offline.ps1'), ps1Content);
}

function createInstallReadme() {
  const readme = `# Library Management System - Offline Installer v${VERSION}

## Quick Start

### Windows
\`\`\`cmd
start-offline.bat
\`\`\`

### Linux / macOS
\`\`\`bash
./start-offline.sh
\`\`\`

### PowerShell (Windows)
\`\`\`powershell
.\\start-offline.ps1
\`\`\`

The server will start at **http://localhost:5000**

## First-Time Setup

1. Open http://localhost:5000 in your browser
2. You'll be redirected to the setup page
3. Enter a strong password for the librarian account (min 12 characters)
4. Optionally customize school name and settings
5. Click "Initialize System"

## Offline Mode

This installer works **completely offline**:
- All dependencies are bundled
- Local database storage via IndexedDB (browser)
- Changes are queued locally when offline
- Automatic sync when internet is restored

## Online Mode (Render)

To connect to your Render database:

1. Create a \`.env\` file in the installer directory:
\`\`\`env
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/library-system
JWT_SECRET=your-generated-secret
DEFAULT_LIBRARIAN_PASSWORD=your-strong-password
CLIENT_ORIGIN=https://your-app.onrender.com
\`\`\`

2. Restart the server

## Sync Operations

When online, the system automatically:
- Syncs pending changes every 30 seconds
- Resolves conflicts (server-wins by default)
- Shows sync status in the UI

Manual sync: \`POST /api/setup/sync\`

## Data Storage

Offline data is stored in:
- **Windows**: \`%USERPROFILE%\\.library-system\\offline\\`
- **Linux/Mac**: \`~/.library-system/offline/\`

Contains:
- \`drafts.json\` - Local mutations waiting to sync
- \`sync-queue.json\` - Ordered sync operations
- \`config.json\` - Offline mode settings
- \`meta.json\` - Installation metadata

## Troubleshooting

### Port already in use
Change PORT in the startup script or set \`PORT=5001\`

### Database connection failed
Check MONGODB_URI in .env file

### Sync conflicts
Visit \`/api/setup/status\` to see pending conflicts
Resolve via \`POST /api/setup/conflicts/resolve\`

## License

MIT License - See LICENSE file for details
`;
  fs.writeFileSync(path.join(INSTALLER_DIR, 'README-INSTALLER.md'), readme);
}

function createVersionInfo() {
  const versionInfo = {
    version: VERSION,
    buildDate: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    dependencies: packageJson.dependencies,
    installId: `install_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  };
  
  fs.writeFileSync(
    path.join(INSTALLER_DIR, 'version.json'),
    JSON.stringify(versionInfo, null, 2)
  );
}

function createArchive() {
  const archiveName = `library-system-v${VERSION}.tar.gz`;
  const archivePath = path.join(OUTPUT_DIR, archiveName);
  
  // Use tar.gz for cross-platform compatibility
  const cmd = process.platform === 'win32' 
    ? `tar -czf "${archivePath}" -C "${OUTPUT_DIR}" "library-system-installer"`
    : `tar -czf "${archivePath}" -C "${OUTPUT_DIR}" "library-system-installer"`;
  
  run(cmd);
}

// Run if executed directly
if (require.main === module) {
  buildInstaller().catch(e => {
    console.error('[build-installer] Failed:', e.message);
    process.exit(1);
  });
}

module.exports = { buildInstaller };