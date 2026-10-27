'use strict';
// Freshness policy for Wowhead spell info (name, icon, tooltip).
//
// The goal is to not hammer Wowhead: a spell is fetched at most
// once per TTL, and only when it is actually shown. The cache
// lives in the app's settings (settings.spellInfo, keyed by
// spell ID) and survives restarts.
//
//   - A good entry is fresh for INFO_TTL (30 days). Icons
//     change rarely, but descriptions can change with patches,
//     so one TTL for the whole entry keeps the description
//     fresh without a separate icon pipeline.
//   - Dirty flag: each entry records the game build it was
//     fetched for (the log's BUILD_VERSION). If a later log
//     has a different build, the entry is dirty and is
//     refetched on next use — patches are exactly when spell
//     info can change. A refetch only happens for spells that
//     are actually displayed, never for the whole cache at
//     once.
//   - A failed lookup (Wowhead has no such spell, network
//     error, timeout) is cached as a failure for FAILED_TTL
//     (7 days), so a missing or brand-new spell is not
//     re-requested on every hover or every launch. After the
//     TTL it is retried, in case Wowhead has caught up.
//   - Entries written before this policy (no fetchedAt) are
//     treated as stale and refetched once on next use.
//
// Statuses: 'missing' | 'fresh' | 'stale' | 'failed-fresh'.
// 'stale' covers both expired entries and dirty (build
// changed) entries, and failed entries past their retry TTL.
const INFO_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const FAILED_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Wowhead's tooltip endpoint form. Failures are tagged with
// the endpoint form that produced them; a failure recorded
// under an older form (e.g. the pre-2026-10-27 `spell=<id>`
// form, which Wowhead now 404s) is retried immediately
// instead of being served as failed-fresh for 7 days.
const SPELL_ENDPOINT = 'slash';
function failureNeedsRetry(entry) {
  return !!(entry && entry.failed && entry.endpoint !== SPELL_ENDPOINT);
}

function entryStatus(entry, now, buildVersion) {
  if (!entry || typeof entry !== 'object') return 'missing';
  const fetchedAt = Number(entry.fetchedAt);
  if (entry.failed) {
    if (Number.isFinite(fetchedAt) && now - fetchedAt < FAILED_TTL_MS) return 'failed-fresh';
    return 'stale';
  }
  if (!Number.isFinite(fetchedAt)) return 'stale';
  if (buildVersion && entry.build && entry.build !== buildVersion) return 'stale';
  if (now - fetchedAt < INFO_TTL_MS) return 'fresh';
  return 'stale';
}

function publicInfo(entry) {
  if (!entry || entry.failed) return null;
  return { name: entry.name || null, icon: entry.icon || null, desc: entry.desc || null };
}

module.exports = { INFO_TTL_MS, FAILED_TTL_MS, SPELL_ENDPOINT, failureNeedsRetry, entryStatus, publicInfo };
