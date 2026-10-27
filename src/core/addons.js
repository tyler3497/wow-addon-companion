'use strict';
/**
 * The addon registry — the single place a new addon is added.
 *
 * To add an addon, append one entry here. Nothing else needs a
 * code change: the Addon Updater view renders each entry in the
 * section for its game, with its own installed/latest version
 * and its own Update / Install button, and Check All checks
 * every entry at once.
 *
 * Fields:
 *   id     — stable key used by the UI and IPC (never changes)
 *   name   — display name
 *   game   — 'retail' or 'forever'. Decides the section AND
 *            which AddOns folder (from Settings) it installs
 *            into: retail -> .../_retail_/Interface/AddOns,
 *            forever -> .../_forever_/Interface/AddOns.
 *   folder — the folder name inside AddOns (contains the .toc)
 *   toc    — the .toc file name inside that folder
 *   repo   — GitHub "owner/repo" the addon is downloaded from
 *   branch — branch to download (usually 'main')
 *
 * Only one addon is registered for now: Gear Audit (retail).
 * The WoW Forever section is intentionally empty until a
 * Forever addon is registered here.
 */
const ADDONS = [
  {
    id: 'gear-audit',
    name: 'Gear Audit',
    game: 'retail',
    folder: 'GearAudit',
    toc: 'GearAudit.toc',
    repo: 'tyler3497/wow-gear-audit',
    branch: 'main',
  },
];

function getAddon(id) {
  return ADDONS.find((a) => a.id === id) || null;
}

function addonsForGame(game) {
  return ADDONS.filter((a) => a.game === game);
}

module.exports = { ADDONS, getAddon, addonsForGame };
