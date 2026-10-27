'use strict';
// Tail a growing log file (e.g. WoWCombatLog.txt while the
// game is running with /combatlog on) and deliver complete
// new lines as they appear.
//
// Uses fs.watchFile polling rather than fs.watch: polling
// reliably sees appends on Windows and network drives, where
// watch events are flaky. Polling also gives us the file
// size, which is how truncation is detected: if the file
// shrinks, WoW started a new log, so the offset resets to 0
// and onReset fires (the caller should drop its old state).
//
// Options: intervalMs (default 1000), startOffset (default
// 0 — read the whole file; pass the current size to start
// at the end, i.e. live-only), onLines(lines), onReset(),
// onMissing() (file does not exist yet; keeps polling).
// Returns { stop() }.
const fs = require('fs');

function watchLogFile(filePath, opts) {
  const intervalMs = (opts && opts.intervalMs) || 1000;
  let offset = (opts && typeof opts.startOffset === 'number') ? opts.startOffset : 0;
  let leftover = '';
  let missing = false;
  let stopped = false;

  const poll = () => {
    if (stopped) return;
    let stat;
    try { stat = fs.statSync(filePath); } catch (_) { stat = null; }
    if (!stat) {
      if (!missing) { missing = true; if (opts.onMissing) opts.onMissing(); }
      return;
    }
    missing = false;
    if (stat.size < offset) {
      offset = 0;
      leftover = '';
      if (opts.onReset) opts.onReset();
    }
    if (stat.size === offset) return;
    let chunk;
    try {
      const fd = fs.openSync(filePath, 'r');
      try {
        const buf = Buffer.alloc(stat.size - offset);
        fs.readSync(fd, buf, 0, buf.length, offset);
        chunk = buf.toString('utf8');
      } finally { fs.closeSync(fd); }
    } catch (e) {
      if (opts.onError) opts.onError(e);
      return;
    }
    offset = stat.size;
    const text = leftover + chunk;
    const lines = text.split(/\r?\n/);
    leftover = lines.pop();
    if (lines.length && opts.onLines) opts.onLines(lines);
  };

  fs.watchFile(filePath, { interval: intervalMs }, poll);
  poll();
  return { stop() { stopped = true; fs.unwatchFile(filePath, poll); } };
}

module.exports = { watchLogFile };
