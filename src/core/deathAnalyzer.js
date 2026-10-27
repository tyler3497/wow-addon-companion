'use strict';
// Death Analyzer — pure-Node parser for WoWCombatLog.txt.
//
// Reads the file the game writes with /combatlog (advanced
// logging recommended, but a non-advanced log still parses —
// HP-after-hit is just unavailable there). It never loads the
// whole log into memory: it streams line by line, keeps only a
// short rolling window of damage/healing per player, and emits
// one structured object per player death.
//
// What a death carries:
//   - pull (encounter, start time, time into the pull, wipe/kill)
//   - killing blow: the last damaging hit, with overkill, so a
//     death to a 4x Living Venom tick in one millisecond shows
//     as four hits, not one invented number
//   - the damage and healing timeline in the window before
//     death (default 10s), damage grouped by spell, healing
//     gross vs net (amount minus overheal)
//   - auras active at death, and defensives split into active /
//     available (estimated from last cast + cooldown) / on
//     cooldown. Cooldowns are typical base values from
//     src/core/defensives.js; talents can change them, and a
//     wipe may reset cooldowns, so "available" is an estimate.
//   - avoidable: NEVER guessed. Every spell starts "unknown".
//     The caller passes marks (spellId -> 'avoidable' |
//     'unavoidable', built up by the user from Blizzard's own
//     damage meter) and the parser applies them. A death is
//     only called avoidable when its killing blow is marked so.
//
// Log format notes (COMBAT_LOG_VERSION 22, verified against a
// real Midnight raid log, build 12.1.0):
//   - Advanced parameters (17-19 values: infoGUID, ownerGUID,
//     currentHP, maxHP, stats, position, level) sit BETWEEN the
//     spell prefix and the damage/heal suffix. So for an
//     advanced SPELL_* event the suffix starts at field 31:
//     amount, baseAmount, overkill, school, resisted, blocked,
//     absorbed, ... For a non-advanced log it starts at 12.
//     SWING_* has no spell prefix: advanced suffix at 28,
//     non-advanced at 9.
//   - On death the game strips every aura in the same
//     millisecond as UNIT_DIED. "Active at death" is therefore
//     reconstructed from aura events up to 50ms before death,
//     not from the aura state at the death line itself.
//   - COMBATANT_INFO (one per player at each encounter start)
//     carries the player's talent build as (nodeId, spellId,
//     rank) triples at the start of its first bracketed list,
//     followed by gear entries (which have nested tuples and
//     are skipped). The log gives IDs and ranks, not names;
//     names and icons come from the same Wowhead lookup the
//     renderer already uses for spells.
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { defensiveById, defensivesForSpec, classForSpec, specNameForSpec, effectiveCooldown } = require('./defensives');

const TS_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{1,2}):(\d{1,2})\.(\d+)(?:-\d+)?\s+(.*)$/;
const DAMAGE_EVENTS = new Set(['SPELL_DAMAGE', 'SPELL_PERIODIC_DAMAGE', 'SPELL_BUILDING_DAMAGE', 'RANGE_DAMAGE', 'SWING_DAMAGE', 'SWING_DAMAGE_LANDED']);
const HEAL_EVENTS = new Set(['SPELL_HEAL', 'SPELL_PERIODIC_HEAL']);
const AURA_APPLY = new Set(['SPELL_AURA_APPLIED', 'SPELL_AURA_REFRESH']);
const AURA_REMOVE = new Set(['SPELL_AURA_REMOVED']);

function splitCsv(text) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// Parse the talent triples out of a COMBATANT_INFO line.
// Gear entries in the same list have nested tuples and more
// fields, so only plain 3-number triples match.
function parseCombatantTalents(rest) {
  const start = rest.indexOf('[');
  if (start < 0) return [];
  const sep = rest.indexOf('],[', start);
  const seg = sep >= 0 ? rest.slice(start + 1, sep) : rest.slice(start + 1, rest.lastIndexOf(']'));
  const entries = [];
  let depth = 0;
  let cur = '';
  for (const ch of seg) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { entries.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur) entries.push(cur);
  const talents = [];
  for (const e of entries) {
    const m = /^\((\d+),(\d+),(\d+)\)$/.exec(e.trim());
    if (m) talents.push({ nodeId: Number(m[1]), spellId: Number(m[2]), rank: Number(m[3]) });
  }
  return talents;
}

// Parse the gear list out of a COMBATANT_INFO line. The line
// holds, in order: [(talent triples)], (a 4-number tuple),
// [(gear entries)], [(interesting auras)], trailing numbers.
// A gear entry is (itemId, itemLevel, (enchants), (gems),
// (bonuses)). Entries are split at depth-0 commas so the
// nested tuples inside a gear entry do not split it.
function parseCombatantGear(rest) {
  // Bracketed lists in the line, in order: [talents],
  // [gear], [interesting auras]. '[' never nests, so each
  // list is the text from a '[' to the next ']'.
  const segments = rest.split('[').slice(1).map((c) => c.split(']')[0]);
  if (segments.length < 2) return [];
  const seg = segments[1];
  const entries = [];
  let depth = 0;
  let cur = '';
  for (const ch of seg) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { entries.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur) entries.push(cur);
  const gear = [];
  for (const e of entries) {
    const m = /^\((\d+),(\d+),/.exec(e.trim());
    if (m) gear.push({ itemId: Number(m[1]), ilvl: Number(m[2]) });
  }
  return gear;
}

// Average item level, the way the game reports it: mean of
// equipped gear, excluding shirt (slot index 3) and tabard
// (slot index 17) and empty slots. Gear is in inventory-slot
// order (head, neck, shoulder, shirt, chest, waist, legs,
// feet, wrist, hands, finger, finger, trinket, trinket,
// back, main hand, off hand, tabard), verified against a
// real log: index 3 is a ilvl-1 shirt and index 17 is the
// tabard, with an empty off-hand for a two-handed weapon.
function computeAvgIlvl(gear) {
  if (!gear || !gear.length) return null;
  const vals = gear
    .filter((g, i) => i !== 3 && i !== 17 && g.itemId !== 0 && g.ilvl > 0)
    .map((g) => g.ilvl);
  if (!vals.length) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

function parseTimestampMs(line) {
  const m = TS_RE.exec(line);
  if (!m) return null;
  const ms = new Date(
    Number(m[3]), Number(m[1]) - 1, Number(m[2]),
    Number(m[4]), Number(m[5]), Number(m[6]),
    Number((m[7] + '000').slice(0, 3)),
  ).getTime();
  // Keep the clock time as written in the log for display: the
  // ms value is only ever used for differences, and its wall
  // clock depends on the machine parsing it.
  const pad = (n) => String(n).padStart(2, '0');
  const label = `${pad(Number(m[4]))}:${pad(Number(m[5]))}:${pad(Number(m[6]))}`;
  const dateLabel = `${Number(m[1])}/${Number(m[2])}/${m[3]}`;
  return { ms, rest: m[8], label, dateLabel };
}

function suffixStart(event, advanced) {
  if (event.startsWith('SPELL_') || event.startsWith('RANGE_')) return advanced ? 31 : 12;
  if (event === 'SWING_DAMAGE' || event === 'SWING_DAMAGE_LANDED') return advanced ? 28 : 9;
  if (event === 'ENVIRONMENTAL_DAMAGE') return advanced ? 29 : 10;
  return null;
}

function isPlayerGuid(g) { return typeof g === 'string' && g.startsWith('Player-'); }

function createAnalyzer(opts) {
  const windowMs = (opts && opts.windowSec ? opts.windowSec : 10) * 1000;
  const marks = (opts && opts.avoidableMarks) || {};
  let advanced = true;
  let buildVersion = null;
  let advancedSeen = false;

  const pulls = [];
  const outsideDeaths = [];
  let currentPull = null;
  const playerNames = new Map(); // guid -> name
  const playerSpec = new Map(); // guid -> specId
  const playerTalents = new Map(); // guid -> latest [{nodeId, spellId, rank}]
  const playerGear = new Map(); // guid -> latest [{itemId, ilvl}]
  const recent = new Map(); // guid -> deque [{...}]
  const auraEvents = new Map(); // guid -> [{ms, action, spellId, name, type, source}]
  const lastDefensiveCast = new Map(); // guid -> Map(spellId -> ms)

  function recentFor(guid) {
    if (!recent.has(guid)) recent.set(guid, []);
    return recent.get(guid);
  }
  function pruneRecent(guid, nowMs) {
    const dq = recentFor(guid);
    while (dq.length && nowMs - dq[0].ms > windowMs + 1000) dq.shift();
  }
  function noteName(guid, name) {
    if (isPlayerGuid(guid) && name && name !== 'nil' && !playerNames.has(guid)) playerNames.set(guid, name);
  }
  function activeAurasAt(guid, cutoffMs) {
    const active = new Map();
    for (const e of auraEvents.get(guid) || []) {
      if (e.ms > cutoffMs) break;
      if (e.action === 'apply') active.set(e.spellId, { spellId: e.spellId, name: e.name, type: e.type, source: e.source });
      else active.delete(e.spellId);
    }
    return active;
  }
  function defensivesForDeath(guid, deathMs, activeAuras) {
    const specId = playerSpec.get(guid);
    const cls = specId ? classForSpec(specId) : null;
    const spec = specId ? specNameForSpec(specId) : null;
    const castMap = lastDefensiveCast.get(guid) || new Map();
    // Candidates: the player's SPEC list when known, so a
    // Protection Warrior is not shown Arms/Fury defensives and
    // vice versa. Spec filtering never hides a fact, though:
    // defensives the player actually cast or had active in this
    // log are always added back in, even if they fall outside
    // the spec list (the database is not exhaustive).
    let candidates;
    if (cls) {
      const seen = new Set();
      candidates = [];
      for (const d of defensivesForSpec(cls, spec)) { if (!seen.has(d.id)) { seen.add(d.id); candidates.push(d); } }
      const extraIds = new Set([...castMap.keys(), ...[...activeAuras.values()].map((a) => a.spellId).filter((id) => defensiveById(id))]);
      for (const id of extraIds) {
        const d = defensiveById(id);
        if (d && !seen.has(d.id)) { seen.add(d.id); candidates.push(d); }
      }
    } else {
      const ids = new Set([...castMap.keys(), ...[...activeAuras.values()].map((a) => a.spellId).filter((id) => defensiveById(id))]);
      candidates = [...ids].map((id) => defensiveById(id)).filter(Boolean);
    }
    const active = [];
    const available = [];
    const onCooldown = [];
    for (const d of candidates) {
      const cd = effectiveCooldown(d, spec);
      if (activeAuras.has(String(d.id))) {
        active.push({ id: d.id, name: d.name, cls: d.cls, cooldownSec: cd, desc: d.desc || null, state: 'active' });
        continue;
      }
      const last = castMap.get(String(d.id));
      if (last === undefined) {
        available.push({ id: d.id, name: d.name, cls: d.cls, cooldownSec: cd, desc: d.desc || null, state: 'available', note: 'not used in this log' });
      } else if (deathMs - last >= cd * 1000) {
        available.push({ id: d.id, name: d.name, cls: d.cls, cooldownSec: cd, desc: d.desc || null, state: 'available', secondsSinceCast: Math.round((deathMs - last) / 1000) });
      } else {
        onCooldown.push({ id: d.id, name: d.name, cls: d.cls, cooldownSec: cd, desc: d.desc || null, state: 'cooldown', secondsLeft: Math.ceil((last + cd * 1000 - deathMs) / 1000), secondsSinceCast: Math.round((deathMs - last) / 1000) });
      }
    }
    return { active, available, onCooldown, playerClass: cls, playerSpec: spec, specId: specId || null, classKnown: !!cls };
  }

  // "What would have saved you": for each defensive that was
  // AVAILABLE (not active, not on cooldown) at death, work
  // out whether pressing it would have survived the killing
  // blow. Assumes optimal timing — the defensive up for its
  // duration ending at death (or, for next-hits defensives,
  // covering the killing blow). This is an estimate, not a
  // replay: later hits could still have killed, and a
  // defensive that was actually pressed is not a
  // counterfactual. Defensives without a quantifiable model
  // (absorbs, unknown heals) are left out, never guessed.
  function saveAnalysisForDeath(death, defensives, damage, killing) {
    if (!killing) return { available: false, reason: 'No damaging killing blow in the window.' };
    const hpBefore = killing.overkill > 0
      ? killing.amount - killing.overkill
      : (killing.hpAfter != null ? killing.hpAfter + killing.amount : null);
    if (hpBefore == null) return { available: false, reason: 'HP data is missing — this needs advanced logging on.' };
    const maxHp = killing.hpMax || null;
    const schoolMatches = (schools, e) => {
      if (schools === 'all') return true;
      if (schools === 'melee') return !!e.melee;
      if (schools === 'physical') return !!e.melee || (e.school != null && (e.school & 1) !== 0);
      if (schools === 'magic') return !e.melee && e.school != null && (e.school & ~1) !== 0;
      return true;
    };
    const kbEvent = { school: killing.school != null ? killing.school : null, melee: !!killing.melee };
    const candidates = [];
    for (const d of defensives.available) {
      const full = defensiveById(d.id);
      const model = full && full.save;
      if (!model) continue;
      let kbMit = 0;
      if (model.mitigation && schoolMatches(model.schools || 'all', kbEvent)) kbMit = killing.amount * model.mitigation;
      let surviving = hpBefore - (killing.amount - kbMit);
      if (model.hpBonus && maxHp) surviving += model.hpBonus * maxHp;
      if (model.heal && maxHp) surviving += model.heal * maxHp;
      // Supporting number: total damage this defensive would
      // have mitigated over its duration before death.
      let mitigatedInWindow = 0;
      if (model.mitigation) {
        const windowEvents = model.nextHits
          ? damage.slice(-model.nextHits)
          : damage.filter((e) => (death.tsMs - e.ms) <= (model.durationSec || 0) * 1000);
        for (const e of windowEvents) if (schoolMatches(model.schools || 'all', e)) mitigatedInWindow += e.amount * model.mitigation;
      }
      candidates.push({
        id: d.id, name: d.name, cooldownSec: d.cooldownSec,
        wouldSave: surviving > 0 || !!model.cheatDeath,
        survivingHp: Math.round(surviving),
        mitigatedKb: Math.round(kbMit),
        mitigatedInWindow: Math.round(mitigatedInWindow),
        cheatDeath: !!model.cheatDeath,
        note: d.note || null,
      });
    }
    candidates.sort((a, b) => (b.wouldSave - a.wouldSave) || (b.survivingHp - a.survivingHp));
    return { available: true, hpBeforeKb: hpBefore, maxHp, candidates, best: candidates.find((c) => c.wouldSave) || null };
  }

  function feed(line) {
    if (!line) return;
    const parsed = parseTimestampMs(line);
    if (!parsed) return;
    const { ms, rest, label, dateLabel } = parsed;
    // COMBATANT_INFO carries nested lists; only its simple
    // prefix (up to the first '(') is needed, for the spec ID.
    if (rest.startsWith('COMBATANT_INFO,')) {
      const prefix = rest.split('(', 1)[0];
      const fl = splitCsv(prefix);
      if (fl.length > 25 && isPlayerGuid(fl[1])) {
        const spec = Number(fl[25]);
        if (Number.isFinite(spec)) playerSpec.set(fl[1], spec);
        const talents = parseCombatantTalents(rest);
        if (talents.length) {
          playerTalents.set(fl[1], talents);
          if (currentPull) currentPull.talents.set(fl[1], talents);
        }
        const gear = parseCombatantGear(rest);
        if (gear.length) {
          playerGear.set(fl[1], gear);
          if (currentPull) currentPull.gear.set(fl[1], gear);
        }
      }
      return;
    }
    const fl = splitCsv(rest);
    const ev = fl[0];
    if (ev === 'COMBAT_LOG_VERSION') {
      for (let i = 2; i + 1 < fl.length; i += 2) {
        if (fl[i] === 'ADVANCED_LOG_ENABLED') { advanced = fl[i + 1] === '1'; advancedSeen = true; }
        if (fl[i] === 'BUILD_VERSION') buildVersion = fl[i + 1];
      }
      return;
    }
    // Keep a name map for players, from any event that names them.
    if (fl.length > 6) { noteName(fl[1], fl[2]); noteName(fl[5], fl[6]); }
    if (ev === 'ENCOUNTER_START') {
      currentPull = {
        index: pulls.length + 1, encounterId: fl[1], name: fl[2], difficulty: fl[3],
        groupSize: fl[4], startMs: ms, startIso: new Date(ms).toISOString(),
        success: null, fightMs: null, endIso: null, deaths: [],
        talents: new Map(), // guid -> talents at this pull's start
        gear: new Map(), // guid -> gear at this pull's start
      };
      pulls.push(currentPull);
      return;
    }
    if (ev === 'ENCOUNTER_END') {
      if (currentPull && currentPull.encounterId === fl[1]) {
        currentPull.success = fl[5] === '1';
        currentPull.fightMs = Number(fl[6]) || null;
        currentPull.endIso = new Date(ms).toISOString();
        currentPull = null;
      }
      return;
    }
    if (ev === 'UNIT_DIED' && fl.length > 6 && isPlayerGuid(fl[5])) {
      const guid = fl[5];
      const name = fl[6];
      pruneRecent(guid, ms);
      const window = recentFor(guid).filter((e) => ms - e.ms <= windowMs);
      const damage = window.filter((e) => e.kind === 'damage');
      const healing = window.filter((e) => e.kind === 'heal');
      const killing = damage.length ? damage[damage.length - 1] : null;
      // Auras up to 50ms before death: the game strips them all
      // in the same millisecond as UNIT_DIED, so the state at
      // the death line itself is always empty.
      const activeMap = activeAurasAt(guid, ms - 50);
      const activeAuras = [...activeMap.values()].sort((a, b) => a.name.localeCompare(b.name));
      const defensives = defensivesForDeath(guid, ms, activeMap);
      const bySpell = new Map();
      for (const e of damage) {
        const key = `${e.spellId}|${e.spell}`;
        if (!bySpell.has(key)) bySpell.set(key, { spellId: e.spellId, spell: e.spell, source: e.source, total: 0, hits: 0, maxHit: 0, avoidable: marks[e.spellId] || 'unknown' });
        const s = bySpell.get(key);
        s.total += e.amount; s.hits++; s.maxHit = Math.max(s.maxHit, e.amount);
      }
      const byHealer = new Map();
      for (const e of healing) {
        if (!byHealer.has(e.source)) byHealer.set(e.source, { source: e.source, total: 0, net: 0, overheal: 0 });
        const h = byHealer.get(e.source);
        h.total += e.amount; h.net += e.amount - (e.overheal || 0); h.overheal += e.overheal || 0;
      }
      const kbAvoidable = killing ? (marks[killing.spellId] || 'unknown') : 'unknown';
      const death = {
        player: name, guid,
        playerClass: defensives.playerClass,
        playerSpec: defensives.playerSpec || null,
        specId: defensives.specId || null,
        tsMs: ms, tsIso: new Date(ms).toISOString(), timeLabel: label, dateLabel,
        pullIndex: currentPull ? currentPull.index : null,
        encounterName: currentPull ? currentPull.name : null,
        timeInPullSec: currentPull ? Math.round((ms - currentPull.startMs) / 1000) : null,
        killingBlow: killing ? {
          spell: killing.spell, spellId: killing.spellId, source: killing.source,
          school: killing.school != null ? killing.school : null, melee: !!killing.melee,
          amount: killing.amount, overkill: killing.overkill,
          effectiveAmount: killing.overkill > 0 ? killing.amount - killing.overkill : killing.amount,
          hpAfter: killing.hpAfter, hpMax: killing.hpMax || null, avoidable: kbAvoidable,
        } : null,
        verdict: killing ? kbAvoidable : 'unknown',
        damage: damage.map((e) => ({ tsIso: new Date(e.ms).toISOString(), msBeforeDeath: Math.round((ms - e.ms) / 100) / 10, source: e.source, spell: e.spell, spellId: e.spellId, amount: e.amount, overkill: e.overkill, hpAfter: e.hpAfter, hpMax: e.hpMax || null, school: e.school != null ? e.school : null, melee: !!e.melee, avoidable: marks[e.spellId] || 'unknown' })),
        healing: healing.map((e) => ({ tsIso: new Date(e.ms).toISOString(), msBeforeDeath: Math.round((ms - e.ms) / 100) / 10, source: e.source, spell: e.spell, spellId: e.spellId, amount: e.amount, overheal: e.overheal || 0, net: e.amount - (e.overheal || 0), hpAfter: e.hpAfter, hpMax: e.hpMax || null })),
        damageBySpell: [...bySpell.values()].sort((a, b) => b.total - a.total),
        healingBySource: [...byHealer.values()].sort((a, b) => b.total - a.total),
        totalDamage: damage.reduce((s, e) => s + e.amount, 0),
        totalHealingGross: healing.reduce((s, e) => s + e.amount, 0),
        totalHealingNet: healing.reduce((s, e) => s + (e.amount - (e.overheal || 0)), 0),
        activeAuras,
        defensives,
        talents: (currentPull && currentPull.talents.get(guid)) || playerTalents.get(guid) || [],
        avgIlvl: computeAvgIlvl((currentPull && currentPull.gear.get(guid)) || playerGear.get(guid) || null),
        maxHp: (killing && killing.hpMax) || null,
      };
      death.saveAnalysis = saveAnalysisForDeath(death, defensives, damage, killing);
      if (!death.maxHp) {
        const seen = [...damage, ...healing].map((e) => e.hpMax).filter((v) => v);
        if (seen.length) death.maxHp = Math.max(...seen);
      }
      // If the killing blow itself carried no max HP, rerun
      // the save analysis with the fallback max HP so
      // hpBonus/heal defensives can still be judged.
      if (death.saveAnalysis && !death.saveAnalysis.available) {
        // keep the reason (missing HP data)
      } else if (death.saveAnalysis && death.saveAnalysis.maxHp == null && death.maxHp) {
        const kbWithMax = { ...killing, hpMax: death.maxHp };
        death.saveAnalysis = saveAnalysisForDeath(death, defensives, damage, kbWithMax);
      }
      if (currentPull) currentPull.deaths.push(death);
      else outsideDeaths.push(death);
      // Compact aura history: keep the pre-death state as the
      // new baseline so history does not grow without bound.
      auraEvents.set(guid, [...activeMap.values()].map((a) => ({ ms, action: 'apply', spellId: a.spellId, name: a.name, type: a.type, source: a.source })));
      return;
    }
    // Damage / healing / auras / defensive casts, only for players.
    if (fl.length > 8 && isPlayerGuid(fl[5])) {
      const guid = fl[5];
      if (DAMAGE_EVENTS.has(ev)) {
        const ss = suffixStart(ev, advanced);
        if (ss !== null && fl.length > ss + 2) {
          const amount = Number(fl[ss]);
          const overkill = Number(fl[ss + 2]);
          if (Number.isFinite(amount)) {
            const isSpell = ev.startsWith('SPELL_') || ev.startsWith('RANGE_');
            pruneRecent(guid, ms);
            recentFor(guid).push({
              ms, kind: 'damage', source: fl[2],
              spell: isSpell ? fl[10] : 'Melee', spellId: isSpell ? fl[9] : '0',
              amount, overkill: Number.isFinite(overkill) ? overkill : -1,
              school: Number.isFinite(Number(fl[ss + 3])) ? Number(fl[ss + 3]) : null,
              melee: !isSpell,
              hpAfter: (advanced && isSpell && Number.isFinite(Number(fl[14]))) ? Number(fl[14]) : null,
              hpMax: (advanced && isSpell && Number.isFinite(Number(fl[15])) && Number(fl[15]) > 0) ? Number(fl[15]) : null,
            });
          }
        }
        return;
      }
      if (HEAL_EVENTS.has(ev)) {
        const ss = suffixStart(ev, advanced);
        if (ss !== null && fl.length > ss + 2) {
          const amount = Number(fl[ss]);
          const overheal = Number(fl[ss + 2]);
          if (Number.isFinite(amount)) {
            pruneRecent(guid, ms);
            recentFor(guid).push({
              ms, kind: 'heal', source: fl[2], spell: fl[10], spellId: fl[9],
              amount, overheal: Number.isFinite(overheal) ? overheal : 0,
              hpAfter: (advanced && Number.isFinite(Number(fl[14]))) ? Number(fl[14]) : null,
              hpMax: (advanced && Number.isFinite(Number(fl[15])) && Number(fl[15]) > 0) ? Number(fl[15]) : null,
            });
          }
        }
        return;
      }
      if (AURA_APPLY.has(ev) && fl.length > 12) {
        if (!auraEvents.has(guid)) auraEvents.set(guid, []);
        auraEvents.get(guid).push({ ms, action: 'apply', spellId: fl[9], name: fl[10], type: fl[12], source: fl[2] });
        return;
      }
      if (AURA_REMOVE.has(ev) && fl.length > 9) {
        if (!auraEvents.has(guid)) auraEvents.set(guid, []);
        auraEvents.get(guid).push({ ms, action: 'remove', spellId: fl[9], name: null, type: null, source: null });
        return;
      }
    }
    // Defensive casts by a player (source is the player).
    if (ev === 'SPELL_CAST_SUCCESS' && fl.length > 10 && isPlayerGuid(fl[1])) {
      const d = defensiveById(fl[9]);
      if (d) {
        if (!lastDefensiveCast.has(fl[1])) lastDefensiveCast.set(fl[1], new Map());
        lastDefensiveCast.get(fl[1]).set(String(d.id), ms);
      }
    }
  }

  function finish() {
    const allDeaths = [];
    for (const p of pulls) for (const d of p.deaths) allDeaths.push(d);
    for (const d of outsideDeaths) allDeaths.push(d);
    return {
      buildVersion, advanced: advancedSeen ? advanced : true,
      pulls: pulls.map((p) => ({
        index: p.index, encounterId: p.encounterId, name: p.name,
        startIso: p.startIso, startLabel: p.startLabel, startDate: p.startDate,
        endIso: p.endIso, success: p.success,
        fightMs: p.fightMs, durationSec: p.fightMs ? Math.round(p.fightMs / 1000) : (p.endIso ? null : null),
        deathCount: p.deaths.length, deaths: p.deaths,
      })),
      outsideDeaths,
      deaths: allDeaths,
      totalPlayerDeaths: allDeaths.length,
    };
  }

  return { feed, finish };
}

async function parseCombatLogStream(stream, opts, onProgress) {
  const analyzer = createAnalyzer(opts);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let lines = 0;
  for await (const line of rl) {
    analyzer.feed(line);
    lines++;
    if (onProgress && lines % 50000 === 0) onProgress({ lines });
  }
  if (onProgress) onProgress({ lines, done: true });
  return analyzer.finish();
}

// Synchronous, for tests and small inputs.
function parseCombatLogText(text, opts) {
  const analyzer = createAnalyzer(opts);
  for (const line of text.split(/\r?\n/)) analyzer.feed(line);
  return analyzer.finish();
}

async function parseCombatLogFile(filePath, opts, onProgress) {
  let target = filePath;
  let tmpDir = null;
  if (/\.zip$/i.test(filePath)) {
    // AdmZip is already a dependency (the addon updater uses it).
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(filePath);
    const entries = zip.getEntries().filter((e) => /\.txt$/i.test(e.entryName));
    if (!entries.length) throw new Error('No .txt combat log found inside that zip.');
    const entry = entries.find((e) => /WowCombatLog/i.test(e.entryName)) || entries[0];
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wow-death-'));
    target = path.join(tmpDir, path.basename(entry.entryName));
    zip.extractEntryTo(entry, tmpDir, false, true);
  }
  try {
    const stream = fs.createReadStream(target, { encoding: 'utf8' });
    return await parseCombatLogStream(stream, opts, onProgress);
  } finally {
    if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {} }
  }
}

module.exports = { createAnalyzer, parseCombatLogText, parseCombatLogFile, parseCombatLogStream, splitCsv, suffixStart, parseCombatantGear, computeAvgIlvl };
