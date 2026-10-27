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
    } else if (res.reason === 'check-failed') {
      // Show the real updater error, not a generic label.
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

// ---- Death Analyzer ----
// Parses a WoWCombatLog.txt (or zip) in the main process and
// renders pulls -> deaths -> one death's full timeline. The
// parser never guesses avoidable: marks come from the user,
// saved in settings, and are applied on every re-parse.
let deathResult = null;
let deathLogPath = null;
let currentDeath = null;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => Number(n || 0).toLocaleString('en-US');
const fmtTime = (sec) => {
  if (sec == null) return '–';
  const m = Math.floor(sec / 60), s = sec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
};
function verdictBadge(v) {
  if (v === 'avoidable') return '<span class="badge bad">Avoidable death</span>';
  if (v === 'unavoidable') return '<span class="badge good">Unavoidable</span>';
  return '<span class="badge unknown">Avoidable: unknown</span>';
}
function avoidableLabel(v) {
  return v === 'avoidable' ? 'Avoidable' : v === 'unavoidable' ? 'Unavoidable' : 'Unknown';
}

async function parseDeathLog() {
  if (!deathLogPath) return;
  const windowSec = Number($('deathWindow').value || 10);
  $('btnPickLog').disabled = true;
  $('btnReparseLog').disabled = true;
  $('deathStatus').textContent = 'Parsing… (large logs take a few seconds)';
  try {
    deathResult = await api.parseDeathLog(deathLogPath, windowSec);
    const pulls = deathResult.pulls || [];
    $('deathStatus').textContent = `${deathResult.totalPlayerDeaths} player deaths in ${pulls.length} pull${pulls.length === 1 ? '' : 's'}${deathResult.advanced ? '' : ' — advanced logging was off, so HP-after-hit is missing.'} Click a death for its timeline.`;
    $('deathPath').textContent = deathLogPath;
    currentDeath = null;
    renderDeathPulls();
    $('deathDetail').innerHTML = '';
  } catch (e) {
    $('deathStatus').textContent = `Parse failed: ${e.message}`;
  } finally {
    $('btnPickLog').disabled = false;
    $('btnReparseLog').disabled = false;
  }
}
api.onDeathProgress((p) => {
  if (p.done) return;
  $('deathStatus').textContent = `Parsing… ${num(p.lines)} lines read`;
});

function deathRowHtml(death) {
  const kb = death.killingBlow;
  const kbTxt = kb ? `${esc(kb.spell)} — ${num(kb.amount)}${kb.overkill > 0 ? ` (${num(kb.overkill)} overkill)` : ''} from ${esc(kb.source)}` : 'No damaging hit in the window';
  return `<button class="death-row" data-death-key="${esc(death.pullIndex)}|${esc(death.player)}|${esc(death.tsIso)}">
    <span class="death-player">${esc(death.player)}${death.playerClass ? ` <span class="muted small">(${esc(death.playerClass)})</span>` : ''}</span>
    <span class="death-time">${death.timeInPullSec != null ? `${fmtTime(death.timeInPullSec)} into pull` : esc(death.timeLabel || '')}</span>
    <span class="death-kb">${kbTxt}</span>
    ${verdictBadge(death.verdict)}
  </button>`;
}

function renderDeathPulls() {
  const filter = ($('deathFilter').value || '').trim().toLowerCase();
  const container = $('deathPulls');
  if (!deathResult) { container.innerHTML = ''; return; }
  let html = '';
  for (const pull of deathResult.pulls) {
    const deaths = (pull.deaths || []).filter((d) => !filter || d.player.toLowerCase().includes(filter));
    if (filter && deaths.length === 0) continue;
    const outcome = pull.success === true ? '<span class="badge good">Kill</span>' : pull.success === false ? '<span class="badge bad">Wipe</span>' : '<span class="badge unknown">In progress / truncated</span>';
    html += `<div class="pull-card">
      <div class="pull-head"><h4>Pull ${pull.index}: ${esc(pull.name)}</h4>${outcome}</div>
      <p class="muted small">${esc(pull.startDate || '')} ${esc(pull.startLabel || '')} · ${pull.fightMs ? `${fmtTime(Math.round(pull.fightMs / 1000))} fight` : 'no end in log'} · ${pull.deathCount} death${pull.deathCount === 1 ? '' : 's'}</p>
      <div class="death-list">${deaths.map(deathRowHtml).join('') || '<p class="muted small">No deaths match the filter.</p>'}</div>
    </div>`;
  }
  if (deathResult.outsideDeaths && deathResult.outsideDeaths.length) {
    const deaths = deathResult.outsideDeaths.filter((d) => !filter || d.player.toLowerCase().includes(filter));
    if (deaths.length) {
      html += `<div class="pull-card"><div class="pull-head"><h4>Outside encounters (trash / between pulls)</h4></div>
        <div class="death-list">${deaths.map(deathRowHtml).join('')}</div></div>`;
    }
  }
  container.innerHTML = html || '<p class="muted">No deaths found in this log.</p>';
  container.querySelectorAll('.death-row').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [pullIndex, player, tsIso] = btn.dataset.deathKey.split('|');
      const all = [...(deathResult.pulls || []).flatMap((p) => p.deaths || []), ...(deathResult.outsideDeaths || [])];
      const death = all.find((d) => String(d.pullIndex) === pullIndex && d.player === player && d.tsIso === tsIso);
      if (death) { currentDeath = death; renderDeathDetail(); }
    });
  });
}

function renderDeathDetail() {
  const d = currentDeath;
  if (!d) return;
  const kb = d.killingBlow;
  const defList = (list) => list.length
    ? `<ul class="def-list">${list.map((x) => `<li><b>${esc(x.name)}</b> <span class="muted small">(${x.cooldownSec}s CD${x.secondsLeft != null ? ` · ${x.secondsLeft}s left` : x.secondsSinceCast != null ? ` · used ${x.secondsSinceCast}s before death` : x.note ? ` · ${esc(x.note)}` : ''})</span></li>`).join('')}</ul>`
    : '<p class="muted small">None.</p>';
  $('deathDetail').innerHTML = `
    <div class="death-detail">
      <h3>${esc(d.player)}${d.playerClass ? ` <span class="muted">(${esc(d.playerClass)})</span>` : ''}</h3>
      <p class="muted small">${esc(d.encounterName || 'Outside encounter')} · pull ${d.pullIndex || '–'} · ${d.timeInPullSec != null ? fmtTime(d.timeInPullSec) + ' into pull' : esc(d.timeLabel || '')} · ${esc(d.dateLabel || '')} ${esc(d.timeLabel || '')}</p>
      <p>${verdictBadge(d.verdict)} <span class="muted small">${d.verdict === 'unknown' ? 'Mark the killing blow below from Blizzard\'s damage meter to classify this death.' : ''}</span></p>
      <h4>Killing blow</h4>
      ${kb ? `<p><b>${esc(kb.spell)}</b> from ${esc(kb.source)} — ${num(kb.amount)} damage${kb.overkill > 0 ? `, ${num(kb.overkill)} overkill (${num(kb.effectiveAmount)} effective)` : ''}${kb.hpAfter != null ? ` · HP after: ${num(kb.hpAfter)}` : ''} · ${avoidableLabel(kb.avoidable)}</p>`
        : '<p class="muted">No damaging hit in the window — this death may be from a mechanic with no damage line (e.g. a fall, an instant kill, or a hit just outside the window).</p>'}
      <h4>Damage in the last ${$('deathWindow').value || 10}s — ${num(d.totalDamage)} total</h4>
      <table class="death-table">
        <thead><tr><th>Spell</th><th>Source</th><th>Hits</th><th>Total</th><th>Max hit</th><th>Avoidable</th><th>Mark</th></tr></thead>
        <tbody>${d.damageBySpell.map((s) => `<tr>
          <td>${esc(s.spell)}</td><td>${esc(s.source)}</td><td>${s.hits}</td><td>${num(s.total)}</td><td>${num(s.maxHit)}</td><td>${avoidableLabel(s.avoidable)}</td>
          <td><button data-mark="avoidable" data-spell-id="${esc(s.spellId)}" data-spell-name="${esc(s.spell)}">Avoidable</button>
          <button data-mark="unavoidable" data-spell-id="${esc(s.spellId)}" data-spell-name="${esc(s.spell)}">Unavoidable</button>
          <button data-mark="unknown" data-spell-id="${esc(s.spellId)}" data-spell-name="${esc(s.spell)}">Clear</button></td>
        </tr>`).join('') || '<tr><td colspan="7" class="muted">No damage in the window.</td></tr>'}</tbody>
      </table>
      <details><summary>Damage timeline (${d.damage.length} hits)</summary>
        <table class="death-table"><thead><tr><th>Before death</th><th>Source</th><th>Spell</th><th>Amount</th><th>HP after</th></tr></thead>
        <tbody>${d.damage.map((e) => `<tr><td>${e.msBeforeDeath}s</td><td>${esc(e.source)}</td><td>${esc(e.spell)}</td><td>${num(e.amount)}${e.overkill > 0 ? ` (${num(e.overkill)} overkill)` : ''}</td><td>${e.hpAfter != null ? num(e.hpAfter) : '–'}</td></tr>`).join('')}</tbody></table>
      </details>
      <h4>Healing in the window — ${num(d.totalHealingGross)} gross, ${num(d.totalHealingNet)} net</h4>
      <table class="death-table"><thead><tr><th>Source</th><th>Gross</th><th>Net</th><th>Overheal</th></tr></thead>
        <tbody>${d.healingBySource.map((h) => `<tr><td>${esc(h.source)}</td><td>${num(h.total)}</td><td>${num(h.net)}</td><td>${num(h.overheal)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No healing in the window.</td></tr>'}</tbody></table>
      <h4>Defensives</h4>
      <p class="muted small">${d.defensives.classKnown ? `Class from log: ${esc(d.defensives.playerClass)}.` : 'Class not found in the log (no COMBATANT_INFO for this player), so only defensives they used or had up are shown.'}</p>
      <p><b>Active at death:</b></p>${defList(d.defensives.active)}
      <p><b>Available (estimated):</b></p>${defList(d.defensives.available)}
      <p><b>On cooldown:</b></p>${defList(d.defensives.onCooldown)}
      <details><summary>All auras active at death (${d.activeAuras.length})</summary>
        <p class="muted small">${d.activeAuras.map((a) => `${esc(a.name)} (${a.type.toLowerCase()})`).join(' · ') || 'None.'}</p>
      </details>
      <div class="row" style="margin-top:16px"><button id="btnCopyDeath">Copy death summary</button></div>
    </div>`;
  $('deathDetail').querySelectorAll('[data-mark]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api.markAvoidable(btn.dataset.spellId, btn.dataset.spellName, btn.dataset.mark);
      const key = currentDeath;
      await parseDeathLog();
      // Restore the same death's detail after the re-parse.
      if (key) {
        const all = [...(deathResult.pulls || []).flatMap((p) => p.deaths || []), ...(deathResult.outsideDeaths || [])];
        currentDeath = all.find((x) => x.player === key.player && x.tsIso === key.tsIso) || null;
        if (currentDeath) renderDeathDetail();
      }
    });
  });
  const copyBtn = $('btnCopyDeath');
  if (copyBtn) copyBtn.addEventListener('click', async () => {
    const kbTxt = kb ? `${kb.spell} from ${kb.source} (${num(kb.amount)}${kb.overkill > 0 ? `, ${num(kb.overkill)} overkill` : ''})` : 'no damaging hit in window';
    const txt = `${d.player} died on ${d.encounterName || 'outside encounter'} (${d.timeInPullSec != null ? fmtTime(d.timeInPullSec) + ' into pull' : d.timeLabel}). Killing blow: ${kbTxt}. Verdict: ${avoidableLabel(d.verdict)}. Damage in last 10s: ${num(d.totalDamage)} (${d.damageBySpell.map((s) => `${s.spell} ${num(s.total)}`).join(', ')}). Healing: ${num(d.totalHealingNet)} net. Defensives active: ${d.defensives.active.map((x) => x.name).join(', ') || 'none'}; available: ${d.defensives.available.map((x) => x.name).join(', ') || 'none'}; on cooldown: ${d.defensives.onCooldown.map((x) => `${x.name} (${x.secondsLeft}s left)`).join(', ') || 'none'}.`;
    try { await navigator.clipboard.writeText(txt); $('deathStatus').textContent = 'Death summary copied to clipboard.'; } catch (_) { $('deathStatus').textContent = 'Could not copy — clipboard unavailable.'; }
  });
}

$('btnPickLog').addEventListener('click', async () => {
  const p = await api.pickDeathLog();
  if (p) { deathLogPath = p; await parseDeathLog(); }
});
$('btnReparseLog').addEventListener('click', parseDeathLog);
$('deathFilter').addEventListener('input', renderDeathPulls);
