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

// Startup: fill in the saved/detected path, then check GitHub.
(async () => {
  const settings = await api.getSettings();
  $('addonsPath').value = settings.addOnsPath || '';
  await refreshInstalled();
  log('Gear Audit companion ready.');
  log(`AddOns folder: ${settings.addOnsPath || '(none detected)'}`);
  await checkForUpdate();
})();
