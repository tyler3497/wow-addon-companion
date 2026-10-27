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
 * Flow in the UI (App Updates view):
 *   Check -> available? -> Download -> downloaded? -> Install & Restart
 * Nothing installs silently and nothing restarts without the user
 * pressing Install & Restart.
 */
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

let send = () => {};
let downloadedVersion = null;
let initialized = false;

function init(onEvent) {
  send = onEvent;
  if (initialized) return;
  initialized = true;
  autoUpdater.autoDownload = false;
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
  });
  autoUpdater.on('error', (err) => {
    send({ type: 'error', message: err && err.message ? err.message : String(err) });
  });
}

async function check() {
  if (!app.isPackaged) {
    return { available: false, reason: 'dev', message: 'App updates are only available in a packaged release build, not when running from source.' };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    const info = result && result.updateInfo;
    if (info && info.version && info.version !== app.getVersion()) {
      return { available: true, version: info.version };
    }
    return { available: false, version: app.getVersion() };
  } catch (err) {
    // Most common cause: this build has no update feed because it
    // was packaged with electron-packager instead of electron-builder.
    return {
      available: false,
      reason: 'no-feed',
      message: 'This build has no update feed (it was not installed from a GitHub Release). Download the latest release from github.com/tyler3497/wow-addon-companion/releases instead.',
      detail: err && err.message ? err.message : String(err),
    };
  }
}

async function download() {
  downloadedVersion = null;
  await autoUpdater.downloadUpdate();
  return { started: true };
}

function install() {
  if (!downloadedVersion) return { installed: false, message: 'Nothing has been downloaded yet.' };
  // Installs on quit, then restarts the app. This is the step
  // that must be user-initiated — never call it on a timer.
  autoUpdater.quitAndInstall(false, true);
  return { installed: true };
}

module.exports = { init, check, download, install, currentVersion: () => app.getVersion() };
