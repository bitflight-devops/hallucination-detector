#!/usr/bin/env node
'use strict';

/**
 * Install or update the GitHub CLI (gh) from GitHub Releases.
 *
 * Downloads the latest gh binary for the current platform, verifies its
 * SHA256 checksum, and installs it to an existing system PATH directory.
 * Uses GITHUB_TOKEN for authenticated API requests when available,
 * falling back to anonymous requests on authentication failure.
 *
 * Usage:
 *   node setup-gh.cjs
 *   node setup-gh.cjs --force
 *   node setup-gh.cjs --dry-run
 *   node setup-gh.cjs --bin-dir /usr/local/bin
 */

const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execSync, spawnSync } = require('node:child_process');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GITHUB_API_URL = 'https://api.github.com/repos/cli/cli/releases/latest';
const DOWNLOAD_CHUNK_SIZE = 8192;
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

/** @type {Record<string, string>} */
const ARCH_MAP = {
  x64: 'amd64',
  amd64: 'amd64',
  arm64: 'arm64',
  arm: 'armv6',
  ia32: '386',
  x32: '386',
};

// ---------------------------------------------------------------------------
// Types (JSDoc)
// ---------------------------------------------------------------------------

/**
 * @typedef {{ os: string, arch: string, archiveFormat: string }} PlatformInfo
 * @typedef {{ name: string, url: string, size: number }} ReleaseAsset
 * @typedef {{ tag: string, assets: ReleaseAsset[] }} ReleaseInfo
 */

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

/**
 * Detect the current OS and architecture, normalized to gh asset naming.
 *
 * @returns {PlatformInfo} Platform info with os, arch, and archiveFormat fields.
 * @throws {Error} If the platform or architecture is unsupported.
 */
function detectPlatform() {
  const rawArch = process.arch;
  const arch = ARCH_MAP[rawArch];
  if (!arch) {
    throw new Error(`Unsupported architecture: ${rawArch}`);
  }

  let osKey;
  let archiveFormat;

  switch (process.platform) {
    case 'linux':
      osKey = 'linux';
      archiveFormat = 'tar.gz';
      break;
    case 'darwin':
      // gh uses "macOS" (capital S) in asset names
      osKey = 'macOS';
      archiveFormat = 'zip';
      break;
    case 'win32':
      osKey = 'windows';
      archiveFormat = 'zip';
      break;
    default:
      throw new Error(`Unsupported operating system: ${process.platform}`);
  }

  return { os: osKey, arch, archiveFormat };
}

// ---------------------------------------------------------------------------
// Version detection
// ---------------------------------------------------------------------------

/**
 * Get the version of the currently installed gh binary by searching PATH.
 *
 * @returns {string|null} Version string without leading 'v', or null if not installed.
 */
function getInstalledVersion() {
  const pathDirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const binaryName = process.platform === 'win32' ? 'gh.exe' : 'gh';

  let ghPath = null;
  for (const dir of pathDirs) {
    const candidate = path.join(dir, binaryName);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      ghPath = candidate;
      break;
    } catch {
      // not found or not executable — continue
    }
  }

  if (!ghPath) {
    return null;
  }

  try {
    const result = spawnSync(ghPath, ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    const output = (result.stdout ?? '').trim();
    // Expected: "gh version 2.87.0 (2025-02-18)"
    for (const part of output.split(/\s+/)) {
      const stripped = part.replace(/^v/, '');
      if (/^\d+\.\d+\.\d+$/.test(stripped)) {
        return stripped;
      }
    }
  } catch {
    // spawn failed — binary exists but cannot run
  }

  return null;
}

// ---------------------------------------------------------------------------
// Version comparison
// ---------------------------------------------------------------------------

/**
 * Parse a version string into an array of integers for comparison.
 *
 * @param {string} versionStr - Version string such as 'v2.87.0' or '2.87.0'.
 * @returns {number[]} Array of integers.
 */
function parseVersion(versionStr) {
  return versionStr
    .replace(/^v/, '')
    .split('.')
    .filter((p) => /^\d+$/.test(p))
    .map(Number);
}

/**
 * Compare two version arrays lexicographically.
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} Negative if a < b, 0 if equal, positive if a > b.
 */
function compareVersions(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Install directory resolution
// ---------------------------------------------------------------------------

/**
 * Find a writable directory on PATH for installation.
 *
 * Checks preferred user-space directories first, then all PATH entries.
 * Creates ~/.local/bin as a last resort.
 *
 * @param {string|null} binDirOverride - Explicit override path, or null to auto-detect.
 * @returns {string} Absolute path to a writable install directory.
 */
function findInstallDir(binDirOverride) {
  if (binDirOverride) {
    return path.resolve(binDirOverride);
  }

  const home = os.homedir();
  const preferred = [path.join(home, '.local', 'bin'), '/usr/local/bin', '/usr/bin'];
  const pathDirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);

  for (const candidate of [...preferred, ...pathDirs]) {
    try {
      fs.accessSync(candidate, fs.constants.W_OK);
      return candidate;
    } catch {
      // not writable — try next
    }
  }

  // Last resort: create ~/.local/bin
  const fallback = path.join(home, '.local', 'bin');
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/**
 * Build HTTP request headers for GitHub API or asset requests.
 *
 * @param {boolean} authenticated - Whether to include GITHUB_TOKEN.
 * @returns {Record<string, string>} Headers object.
 */
function buildHeaders(authenticated) {
  /** @type {Record<string, string>} */
  const headers = {
    'User-Agent': 'setup-gh-cjs/1.0',
    Accept: 'application/vnd.github+json',
  };

  if (authenticated) {
    const token = process.env.GITHUB_TOKEN ?? '';
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  return headers;
}

/**
 * Perform an HTTPS GET request, following up to MAX_REDIRECTS redirects.
 * Returns a Promise that resolves with { statusCode, headers, body } where
 * body is a Buffer.
 *
 * @param {string} url - URL to fetch.
 * @param {Record<string, string>} headers - Request headers.
 * @param {number} timeoutMs - Request timeout in milliseconds.
 * @param {number} [redirectCount] - Internal redirect counter.
 * @returns {Promise<{ statusCode: number, headers: Record<string, string|string[]>, body: Buffer }>}
 */
function httpsGet(url, headers, timeoutMs, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > MAX_REDIRECTS) {
      reject(new Error(`Too many redirects (max ${MAX_REDIRECTS})`));
      return;
    }

    const req = https.get(url, { headers, timeout: timeoutMs }, (res) => {
      const status = res.statusCode ?? 0;

      if (status === 301 || status === 302 || status === 307 || status === 308) {
        const location = res.headers.location;
        if (!location) {
          reject(new Error(`Redirect without Location header from ${url}`));
          return;
        }
        // Consume response body to free socket
        res.resume();
        resolve(httpsGet(location, headers, timeoutMs, redirectCount + 1));
        return;
      }

      /** @type {Buffer[]} */
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: status,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
      res.on('error', reject);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timed out after ${timeoutMs}ms: ${url}`));
    });
    req.on('error', reject);
  });
}

/**
 * Stream an HTTPS GET response directly to a file, following redirects.
 *
 * @param {string} url - URL to download.
 * @param {Record<string, string>} headers - Request headers.
 * @param {string} destPath - Local file path to write to.
 * @param {number} timeoutMs - Request timeout in milliseconds.
 * @param {number} [redirectCount] - Internal redirect counter.
 * @returns {Promise<number>} Resolves with the HTTP status code.
 */
function httpsStream(url, headers, destPath, timeoutMs, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > MAX_REDIRECTS) {
      reject(new Error(`Too many redirects (max ${MAX_REDIRECTS})`));
      return;
    }

    const req = https.get(url, { headers, timeout: timeoutMs }, (res) => {
      const status = res.statusCode ?? 0;

      if (status === 301 || status === 302 || status === 307 || status === 308) {
        const location = res.headers.location;
        if (!location) {
          reject(new Error(`Redirect without Location header from ${url}`));
          return;
        }
        res.resume();
        resolve(httpsStream(location, headers, destPath, timeoutMs, redirectCount + 1));
        return;
      }

      if (status < 200 || status >= 300) {
        res.resume();
        resolve(status);
        return;
      }

      const fileStream = fs.createWriteStream(destPath);
      res.pipe(fileStream);
      fileStream.on('finish', () => resolve(status));
      fileStream.on('error', reject);
      res.on('error', (err) => {
        fileStream.destroy();
        reject(err);
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Download timed out after ${timeoutMs}ms: ${url}`));
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// GitHub API
// ---------------------------------------------------------------------------

/**
 * Fetch the latest gh release metadata from GitHub.
 *
 * Uses GITHUB_TOKEN if available. Falls back to anonymous on 401/403.
 *
 * @returns {Promise<ReleaseInfo>} Release tag and asset list.
 * @throws {Error} On non-200 responses or missing fields.
 */
async function fetchLatestRelease() {
  const token = process.env.GITHUB_TOKEN ?? '';
  const useAuth = Boolean(token);

  let response;

  if (useAuth) {
    console.log('Using GITHUB_TOKEN for authenticated request');
    response = await httpsGet(GITHUB_API_URL, buildHeaders(true), REQUEST_TIMEOUT_MS);
    if (response.statusCode === 401 || response.statusCode === 403) {
      console.log(
        `Authenticated request failed (HTTP ${response.statusCode}), retrying anonymously`,
      );
      response = await httpsGet(GITHUB_API_URL, buildHeaders(false), REQUEST_TIMEOUT_MS);
    }
  } else {
    response = await httpsGet(GITHUB_API_URL, buildHeaders(false), REQUEST_TIMEOUT_MS);
  }

  if (response.statusCode !== 200) {
    throw new Error(
      `GitHub API returned status ${response.statusCode}: ${response.body.toString('utf8').slice(0, 200)}`,
    );
  }

  /** @type {Record<string, unknown>} */
  const data = JSON.parse(response.body.toString('utf8'));

  const tag = typeof data.tag_name === 'string' ? data.tag_name : '';
  if (!tag) {
    throw new Error("GitHub API response missing 'tag_name'");
  }

  const rawAssets = Array.isArray(data.assets) ? data.assets : [];
  /** @type {ReleaseAsset[]} */
  const assets = rawAssets.map((raw) => ({
    name: typeof raw.name === 'string' ? raw.name : '',
    url: typeof raw.browser_download_url === 'string' ? raw.browser_download_url : '',
    size: typeof raw.size === 'number' ? raw.size : 0,
  }));

  return { tag, assets };
}

// ---------------------------------------------------------------------------
// Asset selection
// ---------------------------------------------------------------------------

/**
 * Find the matching archive asset for the given platform.
 *
 * @param {ReleaseAsset[]} assets - List of release assets from the GitHub API.
 * @param {string} osKey - Operating system key (e.g. 'linux', 'macOS', 'windows').
 * @param {string} arch - Architecture key (e.g. 'amd64', 'arm64').
 * @param {string} archiveFormat - Archive extension (e.g. 'tar.gz', 'zip').
 * @returns {ReleaseAsset|null} Matching asset, or null if none found.
 */
function findAsset(assets, osKey, arch, archiveFormat) {
  for (const asset of assets) {
    // Match pattern: gh_{version}_{os}_{arch}.{format}
    if (asset.name.startsWith('gh_') && asset.name.endsWith(`_${osKey}_${arch}.${archiveFormat}`)) {
      return asset;
    }
  }
  return null;
}

/**
 * Find the checksums.txt asset in the release.
 *
 * @param {ReleaseAsset[]} assets - List of release assets.
 * @returns {ReleaseAsset|null} The checksums asset, or null if not found.
 */
function findChecksumsAsset(assets) {
  for (const asset of assets) {
    if (asset.name.endsWith('_checksums.txt')) {
      return asset;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Checksum handling
// ---------------------------------------------------------------------------

/**
 * Download and parse the checksums file into a Map from filename to SHA256 hex.
 *
 * Uses GITHUB_TOKEN if available, falls back to anonymous on auth failure.
 *
 * @param {ReleaseAsset} checksumAsset - The checksums.txt release asset.
 * @returns {Promise<Map<string, string>>} Map from filename to SHA256 hex digest.
 */
async function fetchChecksums(checksumAsset) {
  const token = process.env.GITHUB_TOKEN ?? '';
  let useAuth = Boolean(token);

  let response;

  if (useAuth) {
    response = await httpsGet(checksumAsset.url, buildHeaders(true), REQUEST_TIMEOUT_MS);
    if (response.statusCode === 401 || response.statusCode === 403) {
      useAuth = false;
    }
  }

  if (!useAuth) {
    response = await httpsGet(checksumAsset.url, buildHeaders(false), REQUEST_TIMEOUT_MS);
  }

  if (response.statusCode !== 200) {
    throw new Error(`Failed to fetch checksums: HTTP ${response.statusCode}`);
  }

  /** @type {Map<string, string>} */
  const checksums = new Map();
  const text = response.body.toString('utf8');
  for (const line of text.trim().split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length === 2) {
      const [sha256Hex, filename] = parts;
      checksums.set(filename, sha256Hex);
    }
  }

  return checksums;
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/**
 * Stream-download a file from the given URL, with auth fallback.
 *
 * Uses GITHUB_TOKEN if available, falls back to anonymous on 401/403.
 *
 * @param {string} url - Download URL.
 * @param {string} destPath - Local file path to write to.
 * @returns {Promise<void>}
 * @throws {Error} On non-2xx responses or network failure.
 */
async function downloadFile(url, destPath) {
  const token = process.env.GITHUB_TOKEN ?? '';
  let useAuth = Boolean(token);

  let status;

  if (useAuth) {
    status = await httpsStream(url, buildHeaders(true), destPath, DOWNLOAD_TIMEOUT_MS);
    if (status === 401 || status === 403) {
      useAuth = false;
      // Remove partial file before retry
      try {
        fs.unlinkSync(destPath);
      } catch {
        // ignore
      }
    }
  }

  if (!useAuth) {
    status = await httpsStream(url, buildHeaders(false), destPath, DOWNLOAD_TIMEOUT_MS);
  }

  if (status < 200 || status >= 300) {
    throw new Error(`Download failed: HTTP ${status} from ${url}`);
  }
}

// ---------------------------------------------------------------------------
// SHA256 verification
// ---------------------------------------------------------------------------

/**
 * Compute the SHA256 hash of a file and assert it matches the expected digest.
 *
 * @param {string} filePath - Path to the file to verify.
 * @param {string} expected - Expected SHA256 hex digest.
 * @returns {Promise<void>}
 * @throws {Error} If the digest does not match.
 */
function verifySha256(filePath, expected) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath, { highWaterMark: DOWNLOAD_CHUNK_SIZE });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => {
      const actual = hash.digest('hex');
      if (actual !== expected) {
        reject(new Error(`SHA256 mismatch: expected ${expected}, got ${actual}`));
      } else {
        resolve();
      }
    });
    stream.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Archive extraction
// ---------------------------------------------------------------------------

/**
 * Extract the gh binary from a downloaded archive into a temporary directory.
 *
 * For tar.gz: uses `tar xzf`. For zip: uses `unzip`.
 * Searches the extracted tree for the gh binary.
 *
 * @param {string} archivePath - Path to the downloaded archive.
 * @param {string} osKey - Operating system key for format detection.
 * @returns {string} Path to the extracted gh binary.
 * @throws {Error} If extraction fails or the binary is not found.
 */
function extractBinary(archivePath, osKey) {
  const extractDir = path.join(path.dirname(archivePath), '_gh_extract');
  fs.mkdirSync(extractDir, { recursive: true });

  try {
    if (osKey === 'linux') {
      execSync(`tar xzf "${archivePath}" -C "${extractDir}"`, { stdio: 'pipe' });
    } else if (osKey === 'macOS' || osKey === 'windows') {
      execSync(`unzip -q "${archivePath}" -d "${extractDir}"`, { stdio: 'pipe' });
    } else {
      throw new Error(`Cannot extract archive for unsupported OS: ${osKey}`);
    }
  } catch (err) {
    throw new Error(`Failed to extract archive: ${err.message}`);
  }

  // Walk extracted directory tree to find the gh binary
  // Expected structure: gh_{version}_{os}_{arch}/bin/gh
  const binaryName = osKey === 'windows' ? 'gh.exe' : 'gh';
  const found = walkDir(extractDir, binaryName);
  if (!found) {
    throw new Error(`Binary '${binaryName}' not found in archive`);
  }

  return found;
}

/**
 * Recursively walk a directory tree, returning the first file matching targetName.
 *
 * @param {string} dir - Directory to search.
 * @param {string} targetName - Filename to find.
 * @returns {string|null} Absolute path to the found file, or null.
 */
function walkDir(dir, targetName) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const result = walkDir(fullPath, targetName);
      if (result) return result;
    } else if (entry.isFile() && entry.name === targetName) {
      return fullPath;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Binary installation
// ---------------------------------------------------------------------------

/**
 * Copy the extracted binary to the install directory and set executable permissions.
 *
 * @param {string} binaryPath - Path to the extracted gh binary.
 * @param {string} installDir - Target installation directory.
 * @returns {string} Path to the installed binary.
 */
function installBinary(binaryPath, installDir) {
  fs.mkdirSync(installDir, { recursive: true });

  const binaryName = process.platform === 'win32' ? 'gh.exe' : 'gh';
  const destPath = path.join(installDir, binaryName);

  fs.copyFileSync(binaryPath, destPath);

  if (process.platform !== 'win32') {
    fs.chmodSync(destPath, 0o755);
  }

  return destPath;
}

// ---------------------------------------------------------------------------
// PATH check
// ---------------------------------------------------------------------------

/**
 * Check whether a directory is on the current PATH.
 *
 * @param {string} dir - Directory path to check.
 * @returns {boolean} True if dir is in PATH.
 */
function isInPath(dir) {
  const resolved = path.resolve(dir);
  return (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .map((p) => path.resolve(p))
    .includes(resolved);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Main entry point: detect platform, fetch latest release, download, verify,
 * extract, and install the gh binary.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const dryRun = args.includes('--dry-run');

  const binDirFlagIndex = args.indexOf('--bin-dir');
  const binDirOverride = binDirFlagIndex !== -1 ? (args[binDirFlagIndex + 1] ?? null) : null;

  // 1. Detect platform
  let platform;
  try {
    platform = detectPlatform();
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }
  console.log(`Detected platform: ${platform.os}/${platform.arch}`);

  // 2. Check existing installation
  const installedVersion = getInstalledVersion();
  if (installedVersion) {
    console.log(`Found installed gh: v${installedVersion}`);
  } else {
    console.log('gh is not currently installed');
  }

  // 3. Resolve install directory
  const installDir = findInstallDir(binDirOverride);
  console.log(`Install directory: ${installDir}`);

  // 4. Fetch latest release
  console.log('Fetching latest gh release...');
  let release;
  try {
    release = await fetchLatestRelease();
  } catch (err) {
    console.error(`ERROR: Failed to fetch release info: ${err.message}`);
    process.exit(1);
  }

  const latestVersion = release.tag.replace(/^v/, '');
  console.log(`Latest version: v${latestVersion}`);

  // 5. Find matching asset
  const asset = findAsset(release.assets, platform.os, platform.arch, platform.archiveFormat);
  if (!asset) {
    console.error(
      `ERROR: No binary found for ${platform.os}_${platform.arch} in release ${release.tag}`,
    );
    process.exit(1);
  }

  // 6. Fetch checksums
  let expectedSha256 = null;
  const checksumsAsset = findChecksumsAsset(release.assets);
  if (checksumsAsset) {
    try {
      const checksums = await fetchChecksums(checksumsAsset);
      expectedSha256 = checksums.get(asset.name) ?? null;
      if (expectedSha256) {
        console.log('SHA256 checksum available for verification');
      } else {
        console.log(`WARNING: No checksum found for ${asset.name}`);
      }
    } catch (err) {
      console.log(`WARNING: Could not fetch checksums: ${err.message}`);
    }
  }

  // 7. Check if update is needed
  const needsUpdate =
    installedVersion === null ||
    compareVersions(parseVersion(installedVersion), parseVersion(latestVersion)) < 0;

  if (!needsUpdate && !force) {
    console.log('gh is already up to date');
    return;
  }

  if (!needsUpdate && force) {
    console.log('Force-reinstalling latest version');
  }

  // 8. Dry-run summary
  if (dryRun) {
    const binaryName = platform.os === 'windows' ? 'gh.exe' : 'gh';
    console.log('\nDry-run summary:');
    console.log(`  Asset:       ${asset.name}`);
    console.log(`  URL:         ${asset.url}`);
    console.log(`  SHA256:      ${expectedSha256 ?? 'not available'}`);
    console.log(`  Size:        ${asset.size.toLocaleString()} bytes`);
    console.log(`  Install dir: ${installDir}`);
    console.log(`  Binary path: ${path.join(installDir, binaryName)}`);
    console.log(`  In PATH:     ${isInPath(installDir) ? 'yes' : 'no'}`);
    return;
  }

  // 9. Download, verify, extract, install
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh_setup_'));

  try {
    const archivePath = path.join(tmpDir, asset.name);

    console.log(`Downloading ${asset.name} (${asset.size.toLocaleString()} bytes)...`);
    try {
      await downloadFile(asset.url, archivePath);
    } catch (err) {
      console.error(`ERROR: Download failed: ${err.message}`);
      process.exit(1);
    }

    if (expectedSha256) {
      console.log('Verifying SHA256 checksum...');
      try {
        await verifySha256(archivePath, expectedSha256);
        console.log('SHA256 verified');
      } catch (err) {
        console.error(`ERROR: ${err.message}`);
        process.exit(1);
      }
    } else {
      console.log('Skipping SHA256 verification (no checksum available)');
    }

    console.log('Extracting binary...');
    let extractedBinary;
    try {
      extractedBinary = extractBinary(archivePath, platform.os);
    } catch (err) {
      console.error(`ERROR: ${err.message}`);
      process.exit(1);
    }

    const installedPath = installBinary(extractedBinary, installDir);
    console.log(`gh v${latestVersion} installed to ${installedPath}`);
  } finally {
    // Clean up temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failure
    }
  }

  // 10. PATH advisory
  if (!isInPath(installDir)) {
    console.log(`\nWARNING: ${installDir} is not in your PATH.`);
    console.log(`  Add it to your shell profile:`);
    console.log(`  export PATH="${installDir}:$PATH"  (add to ~/.bashrc or ~/.zshrc)`);
  }

  // 11. Verify installation
  console.log('\nVerifying installation...');
  const binaryName = platform.os === 'windows' ? 'gh.exe' : 'gh';
  const installedBinaryPath = path.join(installDir, binaryName);
  try {
    const result = spawnSync(installedBinaryPath, ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    console.log(`  ${(result.stdout ?? '').trim()}`);
  } catch (err) {
    console.log(`WARNING: Could not verify installation: ${err.message}`);
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
