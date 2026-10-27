'use strict';
// Renderer: view switching + the Updater feature UI.
// New features: add a nav button + section in index.html, then a
// small init function here that talks to window.gearAudit.
const $ = (id) => document.getElementById(id);
const api = window.gearAudit;

function log(msg) {
  const el = $('log');
  const stamp = new Date().toLocaleTimeString();
  el.value += `[${stamp}] ${msg}\n`;
  el.scrollTop = el.scrollHeight;
}
api.onLog(log);

function showView(name) {
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
}
document.querySelectorAll('.nav-btn').forEach((b) => {
  b.addEventListener('click', () => showView(b.dataset.view));
});

async function refreshInstalled() {
  try { $('installedVersion').textContent = await api.getInstalled(); }
  catch (e) { $('installedVersion').textContent = 'error'; }
}

async function checkForUpdate() {
  log('Checking GitHub for the latest version...');
  $('status').textContent = 'Checking…';
  try {
    const latest = await api.getLatest();
    $('latestVersion').textContent = latest || 'could not reach GitHub';
    const installed = await api.getInstalled();
    $('installedVersion').textContent = installed;
    if (!latest) {
      $('status').textContent = 'GitHub check failed — check your internet connection.';
    } else if (installed === 'not installed') {
      $('status').textContent = 'Gear Audit is not installed yet — press Update / Install.';
    } else if (installed === latest) {
      $('status').textContent = `You are up to date (${latest}).`;
    } else {
      $('status').textContent = `Update available: ${installed} → ${latest}.`;
    }
    log(latest ? `Latest on GitHub is ${latest}.` : 'Could not reach GitHub.');
  } catch (e) {
    $('status').textContent = `Check failed: ${e.message}`;
    log(`Check failed: ${e.message}`);
  }
}

$('btnBrowse').addEventListener('click', async () => {
  const p = await api.pickAddOns();
  if (p) { $('addonsPath').value = p; await refreshInstalled(); }
});
$('addonsPath').addEventListener('change', async () => {
  await api.setPath($('addonsPath').value.trim());
  await refreshInstalled();
});
$('btnCheck').addEventListener('click', checkForUpdate);
$('btnOpen').addEventListener('click', () => api.openFolder());
$('btnUpdate').addEventListener('click', async () => {
  const path = $('addonsPath').value.trim();
  if (!path) { $('status').textContent = 'Pick your WoW AddOns folder first.'; return; }
  await api.setPath(path);
  $('btnUpdate').disabled = true;
  $('btnCheck').disabled = true;
  $('status').textContent = 'Updating…';
  try {
    const version = await api.update();
    $('status').textContent = `Updated to ${version}.`;
    log(`Done — Gear Audit ${version} is installed.`);
  } catch (e) {
    $('status').textContent = `Update failed: ${e.message}`;
    log(`FAILED: ${e.message}`);
  } finally {
    $('btnUpdate').disabled = false;
    $('btnCheck').disabled = false;
    await refreshInstalled();
  }
});

// ---- App Updates (the app itself) ----
// The main process already auto-checks on launch and forwards
// events here. Manual Check just re-runs that same check.
function setAppStatus(text) { $('appUpdateStatus').textContent = text; }
api.onAppUpdate((event) => {
  if (event.type === 'available') {
    $('appLatestVersion').textContent = event.version;
    setAppStatus(`App update available: ${event.version}. Download it when you're ready — nothing installs yet.`);
    $('btnAppDownload').disabled = false;
  } else if (event.type === 'none') {
    setAppStatus(`You're up to date (app ${event.version}).`);
  } else if (event.type === 'progress') {
    setAppStatus(`Downloading app update… ${event.percent}%`);
  } else if (event.type === 'downloaded') {
    setAppStatus(`App update ${event.version} downloaded. Press Install & Restart when you're ready.`);
    $('btnAppDownload').disabled = true;
    $('btnAppInstall').disabled = false;
  } else if (event.type === 'error') {
    // No-feed builds (packager folder builds) land here on launch;
    // keep it as a quiet status in this view, not a popup.
    setAppStatus(`App update check unavailable: ${event.message}`);
  }
});
$('btnAppCheck').addEventListener('click', async () => {
  setAppStatus('Checking for app updates…');
  try {
    const res = await api.appCheck();
    if (res.available) {
      $('appLatestVersion').textContent = res.version;
      setAppStatus(`App update available: ${res.version}.`);
      $('btnAppDownload').disabled = false;
    } else if (res.reason === 'dev') {
      setAppStatus(res.message);
    } else if (res.reason === 'no-feed') {
      setAppStatus(res.message);
    } else {
      setAppStatus(`You're up to date (app ${res.version}).`);
    }
  } catch (e) { setAppStatus(`App update check failed: ${e.message}`); }
});
$('btnAppDownload').addEventListener('click', async () => {
  setAppStatus('Downloading app update…');
  $('btnAppDownload').disabled = true;
  try { await api.appDownload(); } catch (e) { setAppStatus(`Download failed: ${e.message}`); $('btnAppDownload').disabled = false; }
});
$('btnAppInstall').addEventListener('click', async () => {
  await api.appInstall();
});
(async () => {
  try { $('appCurrentVersion').textContent = await api.appCurrentVersion(); } catch (_) {}
})();

// Startup: fill in the saved/detected path, then check GitHub.
(async () => {
  const settings = await api.getSettings();
  $('addonsPath').value = settings.addOnsPath || '';
  await refreshInstalled();
  log('Gear Audit companion ready.');
  log(`AddOns folder: ${settings.addOnsPath || '(none detected)'}`);
  await checkForUpdate();
})();
