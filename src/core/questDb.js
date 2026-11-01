'use strict';
/**
 * Quest-database updater core — pure Node, no Electron dependency.
 *
 * The Forever Quest Guide addon ships its quest data as one file,
 * data/QuestDB.lua, generated from the forever-quests repo. Between
 * addon releases the data itself moves (new quests, corrected
 * rewards), so this module updates just that file in place, using
 * the contract documented in the forever-quests README:
 *
 *   1. Fetch manifest.json, read dataVersion + the QuestDB.lua
 *      entry (bytes + SHA-256).
 *   2. Compare dataVersion with the version inside the installed
 *      QuestDB.lua (["version"] = "x.y.z").
 *   3. Download data/QuestDB.lua, verify its byte length AND its
 *      SHA-256 against the manifest, then install it atomically
 *      (temp file + rename) over the old one, keeping a .bak copy.
 *
 * If the hash or the length does not match, nothing is written —
 * a corrupt or truncated download can never replace good data.
 * If the addon folder itself is missing, updating is refused: the
 * database only makes sense inside an installed Quest Guide.
 *
 * Every function takes an optional `get` (url -> Promise<Buffer>)
 * so tests can inject a stub; the default is a real HTTPS GET that
 * follows redirects, like the addon updater's downloader.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const QUEST_DB_REPO = 'tyler3497/forever-quests';
const QUEST_DB_BRANCH = 'main';
const ADDON_FOLDER = 'ForeverQuestGuide';
const DATA_FILE = 'QuestDB.lua';

function manifestUrl() {
  return `https://raw.githubusercontent.com/${QUEST_DB_REPO}/${QUEST_DB_BRANCH}/manifest.json`;
}
function dataFileUrl() {
  return `https://raw.githubusercontent.com/${QUEST_DB_REPO}/${QUEST_DB_BRANCH}/data/${DATA_FILE}`;
}
function addonDbPath(addOnsPath) {
  return path.join(addOnsPath, ADDON_FOLDER, DATA_FILE);
}

function httpsGet(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'TylersWoWTools-QuestDb' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirects <= 0) return reject(new Error('Too many redirects'));
        return httpsGet(res.headers.location, redirects - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Download failed (HTTP ${res.statusCode}) from ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function parseDbVersion(text) {
  const m = /\["version"\]\s*=\s*"([^"]+)"/.exec(text);
  return m ? m[1] : null;
}

function getInstalledDbVersion(addOnsPath) {
  if (!addOnsPath) return 'not installed';
  const file = addonDbPath(addOnsPath);
  if (!fs.existsSync(file)) return 'not installed';
  try {
    return parseDbVersion(fs.readFileSync(file, 'utf8')) || 'unknown';
  } catch (_) {
    return 'unknown';
  }
}

async function fetchManifest(get = httpsGet) {
  const buf = await get(manifestUrl());
  const manifest = JSON.parse(buf.toString('utf8'));
  if (!manifest.dataVersion) throw new Error('Manifest has no dataVersion');
  return manifest;
}

function manifestDataFile(manifest) {
  const files = manifest.files || [];
  const entry = files.find((f) => f.path === `data/${DATA_FILE}`);
  if (!entry || !entry.sha256) throw new Error('Manifest has no QuestDB.lua entry');
  return entry;
}

async function checkQuestDb(addOnsPath, get = httpsGet) {
  const installed = getInstalledDbVersion(addOnsPath);
  try {
    const manifest = await fetchManifest(get);
    const latest = manifest.dataVersion;
    return {
      installed,
      latest,
      updateAvailable: installed !== 'not installed' && installed !== 'unknown' && installed !== latest,
      error: null,
    };
  } catch (e) {
    return { installed, latest: null, updateAvailable: false, error: e.message };
  }
}

async function updateQuestDb(addOnsPath, onLog = () => {}, get = httpsGet) {
  if (!addOnsPath || !fs.existsSync(addOnsPath)) {
    throw new Error('WoW Forever AddOns folder is not set (see Settings).');
  }
  const addonDir = path.join(addOnsPath, ADDON_FOLDER);
  if (!fs.existsSync(addonDir)) {
    throw new Error('Forever Quest Guide addon is not installed — install it from the Addon Updater first, then update its database.');
  }
  const manifest = await fetchManifest(get);
  const entry = manifestDataFile(manifest);
  onLog(`Quest database: latest is ${manifest.dataVersion}, downloading…`);
  const buf = await get(dataFileUrl());
  if (buf.length !== entry.bytes) {
    throw new Error(`QuestDB.lua size mismatch: got ${buf.length} bytes, manifest says ${entry.bytes}. Nothing was written.`);
  }
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  if (hash !== entry.sha256) {
    throw new Error('QuestDB.lua SHA-256 mismatch against the manifest. Nothing was written.');
  }
  const installedPath = addonDbPath(addOnsPath);
  const tmpPath = `${installedPath}.tmp`;
  const bakPath = `${installedPath}.bak`;
  fs.writeFileSync(tmpPath, buf);
  // Verify the bytes on disk hash the same before they go live.
  const onDisk = crypto.createHash('sha256').update(fs.readFileSync(tmpPath)).digest('hex');
  if (onDisk !== entry.sha256) {
    fs.unlinkSync(tmpPath);
    throw new Error('QuestDB.lua failed its on-disk hash check. Nothing was written.');
  }
  if (fs.existsSync(installedPath)) fs.copyFileSync(installedPath, bakPath);
  fs.renameSync(tmpPath, installedPath);
  const installed = getInstalledDbVersion(addOnsPath);
  if (installed !== manifest.dataVersion) {
    throw new Error(`Installed QuestDB.lua reports version ${installed}, expected ${manifest.dataVersion}.`);
  }
  onLog(`Quest database updated to ${installed}.`);
  return installed;
}

module.exports = {
  QUEST_DB_REPO,
  ADDON_FOLDER,
  DATA_FILE,
  manifestUrl,
  dataFileUrl,
  parseDbVersion,
  getInstalledDbVersion,
  fetchManifest,
  manifestDataFile,
  checkQuestDb,
  updateQuestDb,
};
