'use strict';
// Tests for the live log tailer. Run with:
//   npm run test:core
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { watchLogFile } = require('./logWatcher');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wow-watch-'));
  const file = path.join(dir, 'WoWCombatLog.txt');
  fs.writeFileSync(file, 'line one\nline two\n');
  const seen = [];
  let resets = 0;
  const w = watchLogFile(file, {
    intervalMs: 50,
    onLines: (lines) => seen.push(...lines),
    onReset: () => { resets++; },
  });
  await sleep(300);
  assert.deepStrictEqual(seen, ['line one', 'line two'], 'initial content is delivered');
  fs.appendFileSync(file, 'line three\n');
  await sleep(300);
  assert.deepStrictEqual(seen, ['line one', 'line two', 'line three'], 'appended lines are delivered');
  // A partial line is held until its newline arrives.
  fs.appendFileSync(file, 'partial');
  await sleep(300);
  assert.deepStrictEqual(seen, ['line one', 'line two', 'line three'], 'partial line is not delivered early');
  fs.appendFileSync(file, ' line\n');
  await sleep(300);
  assert.deepStrictEqual(seen, ['line one', 'line two', 'line three', 'partial line'], 'completed partial line is delivered');
  // Truncation (WoW started a new log) resets and re-reads.
  fs.writeFileSync(file, 'new log\n');
  await sleep(300);
  assert.strictEqual(resets, 1, 'truncation fires onReset once');
  assert.deepStrictEqual(seen.slice(-1), ['new log'], 'content after truncation is delivered');
  w.stop();
  fs.appendFileSync(file, 'after stop\n');
  await sleep(300);
  assert.deepStrictEqual(seen.slice(-1), ['new log'], 'nothing is delivered after stop');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('logWatcher: all tests passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
