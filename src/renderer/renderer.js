'use strict';
// Renderer: view switching + the Updater feature UI.
// New features: add a nav button + section in index.html, then a
// small init function here that talks to window.gearAudit.
const $ = (id) => document.getElementById(id);
const api = window.gearAudit;

// Custom title bar controls. Double-clicking the bar (not a
// button) toggles maximize, like a normal title bar would.
$('btnWinMin').addEventListener('click', () => api.windowMinimize());
$('btnWinMax').addEventListener('click', () => api.windowMaximizeToggle());
$('btnWinClose').addEventListener('click', () => api.windowClose());
$('titlebar').addEventListener('dblclick', (e) => {
  if (!e.target.closest('#titlebar-controls')) api.windowMaximizeToggle();
});
api.onWindowMaxState((maximized) => {
  // Restore glyph when maximized, plain square when windowed.
  $('btnWinMax').textContent = maximized ? '❐' : '▢';
  $('btnWinMax').title = maximized ? 'Restore' : 'Maximize';
});

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

// ---- Addon Updater (multi-addon) ----
// Cards are built from the registry (api.listAddons), grouped by
// game. Adding an addon to src/core/addons.js is enough for it
// to appear here, in the right section, with its own versions
// and Update / Install button. Check All checks every addon
// at once; each Update button only touches its own addon.
let addonList = [];
const addonCards = new Map(); // id -> {installed, latest, status, updateBtn}

function statusFor(result) {
  if (result.error) return { text: `Check failed: ${result.error}`, cls: 'error' };
  if (!result.latest) return { text: 'Latest version unknown', cls: 'error' };
  if (result.installed === 'not installed') return { text: 'Not installed', cls: 'update' };
  if (result.installed === result.latest) return { text: 'Up to date', cls: '' };
  return { text: `Update available: ${result.installed} → ${result.latest}`, cls: 'update' };
}

function renderAddonCards() {
  for (const game of ['retail', 'forever']) {
    const container = $(`addonList-${game}`);
    const list = addonList.filter((a) => a.game === game);
    container.innerHTML = '';
    if (list.length === 0) {
      container.innerHTML = `<p class="muted small">No addons registered for ${game === 'retail' ? 'WoW Retail' : 'WoW Forever'} yet.</p>`;
      continue;
    }
    for (const addon of list) {
      const card = document.createElement('div');
      card.className = 'addon-card';
      card.innerHTML = `
        <div class="addon-card-head">
          <h4>${addon.name}</h4>
          <span class="addon-status">–</span>
        </div>
        <div class="versions">
          <div><span class="label">Installed:</span> <span class="installed">–</span></div>
          <div><span class="label">Latest:</span> <span class="latest">–</span></div>
        </div>
        <div class="row">
          <button class="update-btn primary">Install</button>
          <button class="open-btn">Open AddOns Folder</button>
        </div>`;
      const refs = {
        installed: card.querySelector('.installed'),
        latest: card.querySelector('.latest'),
        status: card.querySelector('.addon-status'),
        updateBtn: card.querySelector('.update-btn'),
      };
      refs.updateBtn.addEventListener('click', () => updateOneAddon(addon));
      card.querySelector('.open-btn').addEventListener('click', () => api.openFolder(addon.game));
      addonCards.set(addon.id, refs);
      container.appendChild(card);
    }
  }
}

function applyCheckResult(result) {
  const refs = addonCards.get(result.id);
  if (!refs) return;
  refs.installed.textContent = result.installed;
  refs.latest.textContent = result.latest || 'could not reach GitHub';
  const s = statusFor(result);
  refs.status.textContent = s.text;
  refs.status.className = `addon-status ${s.cls}`.trim();
  refs.updateBtn.textContent = result.installed === 'not installed' ? 'Install' : 'Update';
}

async function checkAllAddons() {
  $('btnCheckAll').disabled = true;
  $('addonStatus').textContent = 'Checking all addons…';
  try {
    const results = await api.checkAllAddons();
    let available = 0;
    for (const r of results) {
      applyCheckResult(r);
      if (r.updateAvailable) available++;
      log(r.error ? `[${r.name}] Check failed: ${r.error}` : `[${r.name}] Installed ${r.installed}, latest ${r.latest}.`);
    }
    $('addonStatus').textContent = available > 0
      ? `${available} update${available === 1 ? '' : 's'} available.`
      : 'All addons are up to date.';
  } catch (e) {
    $('addonStatus').textContent = `Check failed: ${e.message}`;
    log(`Check all failed: ${e.message}`);
  } finally {
    $('btnCheckAll').disabled = false;
  }
}

async function updateOneAddon(addon) {
  const refs = addonCards.get(addon.id);
  if (refs) { refs.updateBtn.disabled = true; refs.status.textContent = 'Updating…'; refs.status.className = 'addon-status'; }
  $('addonStatus').textContent = `Updating ${addon.name}…`;
  try {
    const version = await api.update(addon.id);
    $('addonStatus').textContent = `${addon.name} updated to ${version}.`;
    log(`Done — ${addon.name} ${version} is installed.`);
  } catch (e) {
    $('addonStatus').textContent = `${addon.name} update failed: ${e.message}`;
    log(`[${addon.name}] FAILED: ${e.message}`);
  } finally {
    if (refs) refs.updateBtn.disabled = false;
    await checkAllAddons();
  }
}

$('btnCheckAll').addEventListener('click', checkAllAddons);

// Log is hidden by default — the toggle reveals it.
$('btnToggleLog').addEventListener('click', () => {
  const wrap = $('logWrap');
  const open = wrap.classList.toggle('open');
  $('btnToggleLog').textContent = open ? 'Hide log ▾' : 'Show log ▸';
  if (open) { const el = $('log'); el.scrollTop = el.scrollHeight; }
});

// ---- Settings menu ----
async function openSettings() {
  const settings = await api.getSettings();
  const paths = settings.addOnsPaths || {};
  $('pathRetail').value = paths.retail || '';
  $('pathForever').value = paths.forever || '';
  $('settingsModal').classList.add('open');
}
function closeSettings() { $('settingsModal').classList.remove('open'); }
$('btnSettings').addEventListener('click', openSettings);
$('btnOpenSettings').addEventListener('click', openSettings);
$('btnCloseSettings').addEventListener('click', async () => { closeSettings(); await checkAllAddons(); });
$('settingsModal').addEventListener('click', (e) => { if (e.target === $('settingsModal')) closeSettings(); });
$('btnBrowseRetail').addEventListener('click', async () => {
  const p = await api.pickAddOns('retail');
  if (p) $('pathRetail').value = p;
});
$('btnBrowseForever').addEventListener('click', async () => {
  const p = await api.pickAddOns('forever');
  if (p) $('pathForever').value = p;
});
$('pathRetail').addEventListener('change', async () => { await api.setPath('retail', $('pathRetail').value.trim()); });
$('pathForever').addEventListener('change', async () => { await api.setPath('forever', $('pathForever').value.trim()); });

// ---- App Updates (the app itself) ----
// The main process already auto-checks on launch and forwards
// events here. Manual Check just re-runs that same check.
function setAppStatus(text) { $('appUpdateStatus').textContent = text; }
api.onAppUpdate((event) => {
  if (event.type === 'available') {
    $('appLatestVersion').textContent = event.version;
    // Seamless: the download starts on its own now.
    setAppStatus(`App update available: ${event.version}. Downloading it automatically…`);
    $('btnAppDownload').disabled = true;
  } else if (event.type === 'none') {
    setAppStatus(`You're up to date (app ${event.version}).`);
  } else if (event.type === 'progress') {
    setAppStatus(`Downloading app update… ${event.percent}%`);
  } else if (event.type === 'downloaded') {
    setAppStatus(`App update ${event.version} downloaded. Installing silently and restarting…`);
    $('btnAppDownload').disabled = true;
    $('btnAppInstall').disabled = true;
  } else if (event.type === 'auto-installing') {
    setAppStatus(`Installing app update ${event.version} and restarting…`);
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
      if (res.feedLag) {
        // Release exists, feed hasn't caught up: Download will
        // retry the check in this same session (no restart).
        setAppStatus(res.message);
        $('btnAppDownload').disabled = false;
      } else {
        setAppStatus(`App update available: ${res.version}. Downloading automatically…`);
        $('btnAppDownload').disabled = true;
      }
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
  try {
    const res = await api.appDownload();
    if (res && !res.started) { setAppStatus(res.message || 'No update available.'); $('btnAppDownload').disabled = false; }
  } catch (e) { setAppStatus(`Download failed: ${e.message}`); $('btnAppDownload').disabled = false; }
});
$('btnAppInstall').addEventListener('click', async () => {
  await api.appInstall();
});
(async () => {
  try { $('appCurrentVersion').textContent = await api.appCurrentVersion(); } catch (_) {}
})();

// Startup: build the addon cards from the registry, then check
// all addons at once.
(async () => {
  addonList = await api.listAddons();
  renderAddonCards();
  log("Tyler's WoW Tools ready.");
  await checkAllAddons();
})();
