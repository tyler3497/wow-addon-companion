'use strict';
/**
 * Gear Audit updater core — pure Node, no Electron dependency.
 * This is what main.js calls, and what updater.test.js exercises.
 * Kept separate so new features can live in their own core modules
 * under src/core/ without touching the window code.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');
const AdmZip = require('adm-zip');

const REPO_OWNER = 'tyler3497';
const REPO_NAME = 'wow-gear-audit';
const BRANCH = 'main';
const RAW_TOC_URL = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/GearAudit/GearAudit.toc`;
const ZIP_URL = `https://codeload.github.com/${REPO_OWNER}/${REPO_NAME}/zip/refs/heads/${BRANCH}`;

function downloadToFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const req = https.get(url, { headers: { 'User-Agent': 'GearAudit-Updater' } }, (res) => {
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
    https.get(url, { headers: { 'User-Agent': 'GearAudit-Updater' } }, (res) => {
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

function getInstalledVersion(addOnsPath) {
  if (!addOnsPath) return 'not installed';
  const v = getTocVersion(path.join(addOnsPath, 'GearAudit', 'GearAudit.toc'));
  return v || 'not installed';
}

function detectAddOnsPath() {
  const candidates = [];
  const pf = process.env.ProgramFiles;
  const pf86 = process.env['ProgramFiles(x86)'];
  if (pf) candidates.push(path.join(pf, 'World of Warcraft', '_retail_', 'Interface', 'AddOns'));
  if (pf86) candidates.push(path.join(pf86, 'World of Warcraft', '_retail_', 'Interface', 'AddOns'));
  for (const drive of ['C:', 'D:', 'E:']) {
    candidates.push(path.join(drive, 'World of Warcraft', '_retail_', 'Interface', 'AddOns'));
    candidates.push(path.join(drive, 'Games', 'World of Warcraft', '_retail_', 'Interface', 'AddOns'));
    candidates.push(path.join(drive, 'Program Files', 'World of Warcraft', '_retail_', 'Interface', 'AddOns'));
    candidates.push(path.join(drive, 'Program Files (x86)', 'World of Warcraft', '_retail_', 'Interface', 'AddOns'));
  }
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0] || '';
}

async function getLatestVersion() {
  const text = await downloadText(RAW_TOC_URL);
  return parseTocVersion(text);
}

function findFolderWithToc(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const full = path.join(dir, e.name);
    if (fs.existsSync(path.join(full, 'GearAudit.toc'))) return full;
    const nested = findFolderWithToc(full);
    if (nested) return nested;
  }
  return null;
}

/**
 * Download the latest addon and install it into addOnsPath.
 * Old version is moved to GearAudit_backup_<timestamp> first.
 * onLog(msg) receives progress messages. Returns the new version.
 */
async function updateAddon(addOnsPath, onLog = () => {}) {
  if (!addOnsPath || !fs.existsSync(addOnsPath)) {
    throw new Error('AddOns folder does not exist. Pick your WoW AddOns folder first.');
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gearaudit-update-'));
  try {
    const zipPath = path.join(tmp, 'repo.zip');
    const extractDir = path.join(tmp, 'extract');
    fs.mkdirSync(extractDir);
    onLog('Downloading the latest Gear Audit from GitHub...');
    await downloadToFile(ZIP_URL, zipPath);
    onLog('Download complete. Extracting...');
    new AdmZip(zipPath).extractAllTo(extractDir, true);
    const newFolder = findFolderWithToc(extractDir);
    if (!newFolder) throw new Error('Downloaded archive did not contain GearAudit.toc.');
    const newVersion = getTocVersion(path.join(newFolder, 'GearAudit.toc'));
    onLog(`Downloaded version: ${newVersion}`);
    const target = path.join(addOnsPath, 'GearAudit');
    if (fs.existsSync(target)) {
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      const backup = path.join(addOnsPath, `GearAudit_backup_${stamp}`);
      onLog(`Backing up your old version to ${path.basename(backup)} ...`);
      fs.renameSync(target, backup);
    }
    onLog(`Installing Gear Audit ${newVersion} ...`);
    fs.cpSync(newFolder, target, { recursive: true });
    const installed = getInstalledVersion(addOnsPath);
    if (installed !== newVersion) {
      throw new Error(`Install finished but installed version (${installed}) does not match downloaded version (${newVersion}).`);
    }
    onLog(`Done — Gear Audit ${newVersion} is installed.`);
    return newVersion;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }
}

module.exports = {
  RAW_TOC_URL, ZIP_URL,
  downloadText, downloadToFile, parseTocVersion, getTocVersion,
  getInstalledVersion, detectAddOnsPath, getLatestVersion,
  findFolderWithToc, updateAddon,
};
