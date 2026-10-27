'use strict';
/**
 * Multi-addon updater core — pure Node, no Electron dependency.
 * This is what main.js calls, and what updater.test.js exercises.
 *
 * Every function takes an addon definition (see src/core/addons.js)
 * instead of assuming Gear Audit, so adding an addon is a registry
 * entry, not a code change. The game ('retail' / 'forever') is
 * only used by callers to pick the right AddOns folder; the
 * download/install logic itself is identical for both.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');
const AdmZip = require('adm-zip');
const { getAddon } = require('./addons');

function tocUrl(addon) {
  return `https://raw.githubusercontent.com/${addon.repo}/${addon.branch}/${addon.folder}/${addon.toc}`;
}
function zipUrl(addon) {
  return `https://codeload.github.com/${addon.repo}/zip/refs/heads/${addon.branch}`;
}

function downloadToFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const req = https.get(url, { headers: { 'User-Agent': 'TylersWoWTools-Updater' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlink(dest, () => {});
        downloadToFile(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(dest, () => {});
        reject(new Error(`Download failed (HTTP ${res.statusCode}) from ${url}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    });
    req.on('error', (err) => { file.close(); fs.unlink(dest, () => {}); reject(err); });
    req.setTimeout(120000, () => req.destroy(new Error('Download timed out')));
  });
}

function downloadText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'TylersWoWTools-Updater' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadText(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode} from ${url}`)); return; }
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseTocVersion(tocText) {
  const m = tocText.match(/^\s*##\s*Version:\s*(.+?)\s*$/m);
  return m ? m[1].trim() : null;
}

function getTocVersion(tocPath) {
  if (!fs.existsSync(tocPath)) return null;
  return parseTocVersion(fs.readFileSync(tocPath, 'utf8'));
}

function getInstalledVersion(addOnsPath, addon) {
  if (!addOnsPath || !addon) return 'not installed';
  const v = getTocVersion(path.join(addOnsPath, addon.folder, addon.toc));
  return v || 'not installed';
}

// game: 'retail' -> _retail_, 'forever' -> _forever_.
// Candidates mirror the old retail list, with the game folder
// swapped in, plus the shared base folders.
function detectAddOnsPath(game = 'retail') {
  const clientFolder = game === 'forever' ? '_forever_' : '_retail_';
  const candidates = [];
  const pf = process.env.ProgramFiles;
  const pf86 = process.env['ProgramFiles(x86)'];
  if (pf) candidates.push(path.join(pf, 'World of Warcraft', clientFolder, 'Interface', 'AddOns'));
  if (pf86) candidates.push(path.join(pf86, 'World of Warcraft', clientFolder, 'Interface', 'AddOns'));
  for (const drive of ['C:', 'D:', 'E:']) {
    candidates.push(path.join(drive, 'World of Warcraft', clientFolder, 'Interface', 'AddOns'));
    candidates.push(path.join(drive, 'Games', 'World of Warcraft', clientFolder, 'Interface', 'AddOns'));
    candidates.push(path.join(drive, 'Program Files', 'World of Warcraft', clientFolder, 'Interface', 'AddOns'));
    candidates.push(path.join(drive, 'Program Files (x86)', 'World of Warcraft', clientFolder, 'Interface', 'AddOns'));
  }
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0] || '';
}

async function getLatestVersion(addon) {
  const text = await downloadText(tocUrl(addon));
  return parseTocVersion(text);
}

function findFolderWithToc(dir, toc) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const full = path.join(dir, e.name);
    if (fs.existsSync(path.join(full, toc))) return full;
    const nested = findFolderWithToc(full, toc);
    if (nested) return nested;
  }
  return null;
}

/**
 * Download the latest version of `addon` and install it into
 * addOnsPath. Old version is moved to <folder>_backup_<timestamp>
 * first. onLog(msg) receives progress messages. Returns the new
 * version.
 */
async function updateAddon(addOnsPath, addon, onLog = () => {}) {
  if (!addon) throw new Error('Unknown addon.');
  if (!addOnsPath || !fs.existsSync(addOnsPath)) {
    throw new Error('AddOns folder does not exist. Pick your WoW AddOns folder in Settings first.');
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `${addon.id}-update-`));
  try {
    const zipPath = path.join(tmp, 'repo.zip');
    const extractDir = path.join(tmp, 'extract');
    fs.mkdirSync(extractDir);
    onLog(`[${addon.name}] Downloading the latest version from GitHub...`);
    await downloadToFile(zipUrl(addon), zipPath);
    onLog(`[${addon.name}] Download complete. Extracting...`);
    new AdmZip(zipPath).extractAllTo(extractDir, true);
    const newFolder = findFolderWithToc(extractDir, addon.toc);
    if (!newFolder) throw new Error(`Downloaded archive did not contain ${addon.toc}.`);
    const newVersion = getTocVersion(path.join(newFolder, addon.toc));
    onLog(`[${addon.name}] Downloaded version: ${newVersion}`);
    const target = path.join(addOnsPath, addon.folder);
    if (fs.existsSync(target)) {
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      const backup = path.join(addOnsPath, `${addon.folder}_backup_${stamp}`);
      onLog(`[${addon.name}] Backing up your old version to ${path.basename(backup)} ...`);
      fs.renameSync(target, backup);
    }
    onLog(`[${addon.name}] Installing ${addon.name} ${newVersion} ...`);
    fs.cpSync(newFolder, target, { recursive: true });
    const installed = getInstalledVersion(addOnsPath, addon);
    if (installed !== newVersion) {
      throw new Error(`Install finished but installed version (${installed}) does not match downloaded version (${newVersion}).`);
    }
    onLog(`[${addon.name}] Done — ${addon.name} ${newVersion} is installed.`);
    return newVersion;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }
}

module.exports = {
  tocUrl, zipUrl,
  downloadText, downloadToFile, parseTocVersion, getTocVersion,
  getInstalledVersion, detectAddOnsPath, getLatestVersion,
  findFolderWithToc, updateAddon, getAddon,
};
