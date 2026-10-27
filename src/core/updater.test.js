'use strict';
// Core test: run with `npm run test:core` — no Electron, no window needed.
// Exercises the same download/extract/replace path the app uses, against
// live GitHub and a mock AddOns folder holding an old version.
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const core = require('./updater');

(async () => {
  const latest = await core.getLatestVersion();
  console.log('latest from GitHub:', latest);
  assert.ok(latest, 'latest version should parse');

  const mock = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-addons-'));
  const oldDir = path.join(mock, 'GearAudit');
  fs.mkdirSync(oldDir, { recursive: true });
  fs.writeFileSync(path.join(oldDir, 'GearAudit.toc'), '## Version: 1.4.0\nAudit.lua\n');
  assert.strictEqual(core.getInstalledVersion(mock), '1.4.0');

  const logs = [];
  const installed = await core.updateAddon(mock, (m) => logs.push(m));
  console.log(logs.join('\n'));
  assert.strictEqual(installed, latest);
  assert.strictEqual(core.getInstalledVersion(mock), latest);
  const backup = fs.readdirSync(mock).find((n) => n.startsWith('GearAudit_backup_'));
  assert.ok(backup, 'old version should be backed up');
  assert.ok(fs.existsSync(path.join(mock, 'GearAudit', 'Audit.lua')));
  assert.ok(fs.existsSync(path.join(mock, 'GearAudit', 'Core.lua')));
  assert.ok(fs.existsSync(path.join(mock, 'GearAudit', 'UI.lua')));
  fs.rmSync(mock, { recursive: true, force: true });
  console.log('CORE TEST PASS');
})().catch((err) => { console.error('CORE TEST FAIL:', err); process.exit(1); });
