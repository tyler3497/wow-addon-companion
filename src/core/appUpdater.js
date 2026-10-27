'use strict';
/**
 * Self-update for the companion app itself — NOT the addon updater.
 *
 * Best-practice shape, and why it is shaped this way:
 *
 * - Source of truth is GitHub Releases, not the `main` branch.
 *   A release is a versioned, immutable build (tag v1.2.0 + an
 *   installer + a latest.yml manifest). `main` moves constantly
 *   and has no version, so it cannot answer "am I newer than
 *   what's installed?" reliably, and it cannot roll back.
 * - electron-updater does the hard parts: it reads latest.yml
 *   from the repo's Releases, downloads the new installer in
 *   the background, verifies it, and installs it on quit —
 *   which matters on Windows, because a running .exe cannot
 *   overwrite itself. A hand-rolled "download a zip and copy
 *   over the app folder" would fail on the locked .exe and
 *   would need a separate helper process to swap files after
 *   exit. electron-updater already is that helper.
 * - electron-builder is what produces the installer + latest.yml
 *   in the first place (see "build" in package.json and
 *   .github/workflows/release.yml). A plain electron-packager
 *   folder build has no update feed, so it cannot self-update;
 *   that build is for quick dev / first-run distribution only.
 *
 * Flow in the UI (App Updates view), seamless by design:
 *   Launch (or manual Check) -> available? -> auto-download in
 *   the background -> downloaded -> auto-install (silent NSIS,
 *   no installer wizard) -> app relaunches on the new version.
 * The Download / Install & Restart buttons remain as a manual
 * fallback, but no click is needed for the normal path.
 *
 * Why the check here does not trust electron-updater alone:
 * electron-updater's GitHub provider finds the latest release
 * through github.com/.../releases/latest (a redirect) and the
 * releases Atom feed, both of which can lag a just-published
 * release by minutes. A check run right after publishing could
 * therefore falsely report "up to date" until the app was
 * restarted later — exactly the symptom seen with 0.1.1. So
 * check() first asks api.github.com (the authoritative, no-cache
 * source) what the latest release actually is, and if that is
 * newer than the updater's answer, it retries the updater check
 * instead of reporting up-to-date. If the feed still hasn't
 * caught up, it says so plainly (feedLag) instead of lying, and
 * Download retries the check in the same session — no restart
 * needed to pick the release up.
 */
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');
const https = require('https');

const REPO = 'tyler3497/wow-addon-companion';

let send = () => {};
let downloadedVersion = null;
let initialized = false;
let autoInstallTimer = null;
let addonUpdateRunning = false;
let pendingAutoInstall = false;

function isNewer(latest, current) {
  const parse = (v) => String(v).replace(/^v/, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const a = parse(latest), b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return false;
}

function freshLatestVersion() {
  return new Promise((resolve) => {
    const req = https.get(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: {
        'User-Agent': 'TylersWoWTools-Updater',
        'Accept': 'application/vnd.github+json',
        'Cache-Control': 'no-cache',
      },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          const tag = JSON.parse(body).tag_name;
          resolve(tag ? String(tag).replace(/^v/, '') : null);
        } catch (_) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
  });
}

// Called by main when an addon update starts/finishes, so an
// auto-install never restarts the app mid-addon-update. If one
// was pending, it runs as soon as the addon update finishes.
function setAddonUpdateRunning(running) {
  addonUpdateRunning = running;
  if (!running && pendingAutoInstall) {
    pendingAutoInstall = false;
    scheduleAutoInstall();
  }
}

function scheduleAutoInstall() {
  if (!downloadedVersion) return;
  if (addonUpdateRunning) { pendingAutoInstall = true; return; }
  if (autoInstallTimer) return;
  send({ type: 'auto-installing', version: downloadedVersion });
  autoInstallTimer = setTimeout(() => { install(); }, 1500);
}

function init(onEvent) {
  send = onEvent;
  if (initialized) return;
  initialized = true;
  // Seamless: download as soon as an update is found, and do
  // NOT install on a later quit — install (silently) as soon as
  // the download finishes, so the app restarts on its own.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = {
    info: (...a) => console.log('[app-update]', ...a),
    warn: (...a) => console.warn('[app-update]', ...a),
    error: (...a) => console.error('[app-update]', ...a),
    debug: (...a) => console.debug('[app-update]', ...a),
  };
  autoUpdater.on('update-available', (info) => {
    send({ type: 'available', version: info.version, notes: info.releaseNotes || null });
  });
  autoUpdater.on('update-not-available', (info) => {
    send({ type: 'none', version: info.version });
  });
  autoUpdater.on('download-progress', (p) => {
    send({ type: 'progress', percent: Math.round(p.percent || 0) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    downloadedVersion = info.version;
    send({ type: 'downloaded', version: info.version });
    // Seamless path: no click needed — install silently and
    // relaunch. The 1.5s delay lets the status render first.
    scheduleAutoInstall();
  });
  autoUpdater.on('error', (err) => {
    send({ type: 'error', message: err && err.message ? err.message : String(err) });
  });
}

async function check() {
  if (!app.isPackaged) {
    return { available: false, reason: 'dev', message: 'App updates are only available in a packaged release build, not when running from source.' };
  }
  const current = app.getVersion();
  // Authoritative answer first — if GitHub says a newer release
  // exists, never report "up to date" on the updater's say-so.
  const fresh = await freshLatestVersion();
  const freshIsNewer = fresh && isNewer(fresh, current);
  try {
    let result = await autoUpdater.checkForUpdates();
    let info = result && result.updateInfo;
    if (info && info.version && info.version !== current) {
      return { available: true, version: info.version };
    }
    if (freshIsNewer) {
      // The update feed is lagging behind the published release.
      // Retry a few times — the feed usually catches up quickly —
      // and if it still hasn't, say so instead of lying.
      for (let attempt = 0; attempt < 2; attempt++) {
        await new Promise((r) => setTimeout(r, 3000));
        result = await autoUpdater.checkForUpdates();
        info = result && result.updateInfo;
        if (info && info.version && info.version !== current) {
          return { available: true, version: info.version };
        }
      }
      return {
        available: true,
        version: fresh,
        feedLag: true,
        message: `Version ${fresh} is published, but the update feed hasn't caught up yet. Press Download and it will retry in this same session — no restart needed.`,
      };
    }
    return { available: false, version: current };
  } catch (err) {
    const detail = err && err.message ? err.message : String(err);
    // NEVER relabel an unknown failure as "no feed" — that was
    // the 0.1.1 bug: every updater error (404 for latest.yml,
    // feed parse failure, network failure, ...) was reported
    // as "this build has no update feed", which is only true
    // when the packaged build genuinely has no update config
    // (e.g. an electron-packager folder build). Anything else
    // must surface its real message, so the next failure can
    // actually be diagnosed instead of guessed at.
    const genuinelyNoFeed = /app-update\.yml|no update feed|ERR_UPDATER_NO_PUBLISHED_VERSIONS|provider.*not.*found/i.test(detail)
      && !/latest\.yml|channel file|404/i.test(detail);
    if (freshIsNewer) {
      return {
        available: true,
        version: fresh,
        feedLag: true,
        message: `Version ${fresh} is published, but the update check failed with: ${detail}. Press Download and it will retry in this same session — no restart needed.`,
        detail,
      };
    }
    if (genuinelyNoFeed) {
      return {
        available: false,
        reason: 'no-feed',
        message: 'This build has no update feed (it was not installed from a GitHub Release). Download the latest release from github.com/tyler3497/wow-addon-companion/releases instead.',
        detail,
      };
    }
    return {
      available: false,
      reason: 'check-failed',
      message: `App update check failed: ${detail}`,
      detail,
    };
  }
}

async function download() {
  // In the feed-lag case there is no updateInfo for the updater
  // to download yet — re-check first (same session, no restart),
  // and only fail if the feed still hasn't caught up.
  if (!downloadedVersion) {
    const res = await check();
    if (res.feedLag) {
      throw new Error(res.message);
    }
    if (!res.available) return { started: false, message: 'No update available.' };
    // check() found it via the updater, so autoDownload (true)
    // is already downloading it; downloadUpdate() here is a
    // no-op safeguard for the manual button path.
    try { await autoUpdater.downloadUpdate(); } catch (_) {}
    return { started: true };
  }
  await autoUpdater.downloadUpdate();
  return { started: true };
}

function install() {
  if (!downloadedVersion) return { installed: false, message: 'Nothing has been downloaded yet.' };
  // Silent install + relaunch: isSilent=true runs the NSIS
  // installer with /S (no wizard, no clicks), isForceRunAfter
  // =true relaunches the app on the new version. The old
  // (false, true) call ran the installer UI — that's what
  // made updates feel like "running the installer".
  autoUpdater.quitAndInstall(true, true);
  return { installed: true };
}

module.exports = { init, check, download, install, setAddonUpdateRunning, currentVersion: () => app.getVersion() };
