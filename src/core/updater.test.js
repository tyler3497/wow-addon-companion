'use strict';
// Core test: run with `npm run test:core` — no Electron, no window needed.
// Exercises the same download/extract/replace path the app uses, against
// live GitHub and a mock AddOns folder holding an old version.
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const core = require('./updater');
const { getAddon, addonsForGame } = require('./addons');

(async () => {
  // Registry: Gear Audit (retail) and Gear Audit Forever.
  assert.strictEqual(addonsForGame('retail').length, 1);
  assert.strictEqual(addonsForGame('forever').length, 1);
  const gearAudit = getAddon('gear-audit');
  assert.ok(gearAudit, 'gear-audit should be registered');
  assert.strictEqual(gearAudit.game, 'retail');
  const gearAuditForever = getAddon('gear-audit-forever');
  assert.ok(gearAuditForever, 'gear-audit-forever should be registered');
  assert.strictEqual(gearAuditForever.game, 'forever');
  assert.strictEqual(gearAuditForever.folder, 'GearAudit');
  assert.strictEqual(gearAuditForever.repo, 'tyler3497/wow-gear-audit-forever');

  const latest = await core.getLatestVersion(gearAudit);
  console.log('latest from GitHub:', latest);
  assert.ok(latest, 'latest version should parse');

  const mock = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-addons-'));
  const oldDir = path.join(mock, 'GearAudit');
  fs.mkdirSync(oldDir, { recursive: true });
  fs.writeFileSync(path.join(oldDir, 'GearAudit.toc'), '## Version: 1.4.0\nAudit.lua\n');
  assert.strictEqual(core.getInstalledVersion(mock, gearAudit), '1.4.0');

  const logs = [];
  const installed = await core.updateAddon(mock, gearAudit, (m) => logs.push(m));
  console.log(logs.join('\n'));
  assert.strictEqual(installed, latest);
  assert.strictEqual(core.getInstalledVersion(mock, gearAudit), latest);
  const backup = fs.readdirSync(mock).find((n) => n.startsWith('GearAudit_backup_'));
  assert.ok(backup, 'old version should be backed up');
  assert.ok(fs.existsSync(path.join(mock, 'GearAudit', 'Audit.lua')));
  assert.ok(fs.existsSync(path.join(mock, 'GearAudit', 'Core.lua')));
  assert.ok(fs.existsSync(path.join(mock, 'GearAudit', 'UI.lua')));
  fs.rmSync(mock, { recursive: true, force: true });

  // Forever: the same download/extract/replace path, against
  // the wow-gear-audit-forever repo, into a mock Forever folder.
  const latestForever = await core.getLatestVersion(gearAuditForever);
  console.log('latest Forever from GitHub:', latestForever);
  assert.strictEqual(latestForever, '1.0.0');
  const mockForever = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-addons-forever-'));
  const oldForeverDir = path.join(mockForever, 'GearAudit');
  fs.mkdirSync(oldForeverDir, { recursive: true });
  fs.writeFileSync(path.join(oldForeverDir, 'GearAudit.toc'), '## Version: 0.9.0\nAudit.lua\n');
  assert.strictEqual(core.getInstalledVersion(mockForever, gearAuditForever), '0.9.0');
  const installedForever = await core.updateAddon(mockForever, gearAuditForever, () => {});
  assert.strictEqual(installedForever, '1.0.0');
  assert.strictEqual(core.getInstalledVersion(mockForever, gearAuditForever), '1.0.0');
  assert.ok(fs.existsSync(path.join(mockForever, 'GearAudit', 'Audit.lua')));
  assert.ok(fs.existsSync(path.join(mockForever, 'GearAudit', 'Core.lua')));
  assert.ok(fs.existsSync(path.join(mockForever, 'GearAudit', 'UI.lua')));
  fs.rmSync(mockForever, { recursive: true, force: true });
  console.log('CORE TEST PASS');
})().catch((err) => { console.error('CORE TEST FAIL:', err); process.exit(1); });
