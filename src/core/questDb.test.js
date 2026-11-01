'use strict';
// Core test: run with `npm run test:core` — no Electron, no window needed.
// Exercises the quest-database check/update path (src/core/questDb.js)
// against live GitHub and a mock Forever AddOns folder holding an old
// QuestDB.lua, plus a tamper test proving a bad hash writes nothing.
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const crypto = require('crypto');
const questDb = require('./questDb');

(async () => {
  // Installed-version parsing: the generated file carries
  // ["version"] = "x.y.z" (keys are sorted, so it is not on line 1).
  assert.strictEqual(questDb.parseDbVersion('ForeverQuestsDB = {\n  ["version"] = "1.3.0",\n}'), '1.3.0');
  assert.strictEqual(questDb.parseDbVersion('no version here'), null);

  // Live manifest: the version we just published.
  const manifest = await questDb.fetchManifest();
  console.log('live manifest dataVersion:', manifest.dataVersion);
  assert.ok(/^\d+\.\d+\.\d+$/.test(manifest.dataVersion), 'dataVersion should parse');
  const entry = questDb.manifestDataFile(manifest);
  console.log('manifest QuestDB.lua entry:', entry.bytes, 'bytes');
  assert.ok(entry.bytes > 1000000, 'QuestDB.lua should be multi-MB');
  assert.ok(/^[0-9a-f]{64}$/.test(entry.sha256), 'manifest sha256 should parse');

  // Mock Forever AddOns folder with an old QuestDB.lua installed.
  const mock = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-questdb-'));
  const addonDir = path.join(mock, 'ForeverQuestGuide');
  fs.mkdirSync(addonDir, { recursive: true });
  fs.writeFileSync(path.join(addonDir, 'QuestDB.lua'),
    'ForeverQuestsDB = {\n  ["version"] = "1.2.0",\n}\n');
  assert.strictEqual(questDb.getInstalledDbVersion(mock), '1.2.0');

  const check = await questDb.checkQuestDb(mock);
  console.log('check:', check);
  assert.strictEqual(check.installed, '1.2.0');
  assert.strictEqual(check.latest, manifest.dataVersion);
  assert.strictEqual(check.updateAvailable, check.latest !== '1.2.0');

  const logs = [];
  const installed = await questDb.updateQuestDb(mock, (m) => logs.push(m));
  console.log(logs.join('\n'));
  assert.strictEqual(installed, manifest.dataVersion);
  assert.strictEqual(questDb.getInstalledDbVersion(mock), manifest.dataVersion);
  assert.ok(fs.existsSync(path.join(addonDir, 'QuestDB.lua.bak')), 'old file should be backed up');
  assert.ok(!fs.existsSync(path.join(addonDir, 'QuestDB.lua.tmp')), 'no temp file should remain');
  const written = fs.readFileSync(path.join(addonDir, 'QuestDB.lua'));
  assert.strictEqual(crypto.createHash('sha256').update(written).digest('hex'), entry.sha256,
    'written file must match the manifest hash');
  assert.strictEqual(questDb.parseDbVersion(written.toString('utf8')), manifest.dataVersion);

  // Second run: already up to date, no update available.
  const check2 = await questDb.checkQuestDb(mock);
  assert.strictEqual(check2.updateAvailable, false);

  // Tamper test (no network): a stubbed download returning corrupted
  // bytes must throw BEFORE anything is written.
  const stubGet = async (url) => {
    if (url.endsWith('manifest.json')) return Buffer.from(JSON.stringify(manifest));
    return Buffer.from('corrupted quest data');
  };
  const before = fs.readFileSync(path.join(addonDir, 'QuestDB.lua'));
  await assert.rejects(questDb.updateQuestDb(mock, () => {}, stubGet), /mismatch/);
  assert.ok(fs.readFileSync(path.join(addonDir, 'QuestDB.lua')).equals(before),
    'tampered download must not touch the installed file');
  fs.rmSync(mock, { recursive: true, force: true });

  // Missing addon folder: refused, with a message that says why.
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-questdb-empty-'));
  await assert.rejects(questDb.updateQuestDb(empty, () => {}), /not installed/);
  assert.strictEqual(questDb.getInstalledDbVersion(empty), 'not installed');
  fs.rmSync(empty, { recursive: true, force: true });

  console.log('questDb tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
