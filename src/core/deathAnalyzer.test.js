'use strict';
// Headless tests for the Death Analyzer parser. Run with:
//   npm run test:core
// (updater tests live in updater.test.js; both are run by that
// script — see the test:core script in package.json.)
const assert = require('assert');
const { parseCombatLogText, computeAvgIlvl } = require('./deathAnalyzer');

function csv(fields) { return fields.map((f) => (typeof f === 'string' && f.includes(',')) ? `"${f}"` : String(f)).join(','); }
function line(ts, fields) { return `${ts}  ${csv(fields)}`; }
// Advanced SPELL_* line: spell prefix, 19 advanced values, then
// the damage/heal suffix (amount, baseAmount, overkill, ...).
function spellLine(ts, ev, src, srcName, dst, dstName, spellId, spellName, hpAfter, amount, overkill) {
  const advanced = [dst, '0000000000000000', hpAfter, 800000, 1000, 2000, 1000, 0, 0, 100, 100, 0, 0, 0, 700.0, -350.0, 2608, 3.0, 310];
  return line(ts, [ev, src, srcName, '0x514', '0x80000000', dst, dstName, '0x514', '0x80000000', spellId, spellName, '0x8', ...advanced, amount, amount + 50000, overkill, 8, 0, 0, 0, 'nil', 'nil', 'nil']);
}
function auraLine(ts, ev, src, srcName, dst, dstName, spellId, spellName, type) {
  return line(ts, [ev, src, srcName, '0x514', '0x80000000', dst, dstName, '0x514', '0x80000000', spellId, spellName, '0x1', type]);
}

const PLAYER = 'Player-77-TESTPLAYER';
const BOSS = 'Creature-0-3134-3004-72638-258557-00001A292D';

const log = [
  line('9/3/2026 22:15:22.380-4', ['COMBAT_LOG_VERSION', 22, 'ADVANCED_LOG_ENABLED', 1, 'BUILD_VERSION', '12.1.0', 'PROJECT_ID', 1]),
  line('9/3/2026 22:15:22.380-4', ['ENCOUNTER_START', 3445, 'Entombed Sentinels', 15, 15, 3004]),
  // COMBATANT_INFO: spec 71 (Arms Warrior) sits at field 25.
  (() => {
    const f = ['COMBATANT_INFO', PLAYER, 1, 2603, 429, 38689, 436, 0, 0, 0, 0, 1191, 1191, 1191, 0, 0, 676, 676, 676, 0, 589, 185, 185, 185, 2318, 71];
    return `9/3/2026 22:15:22.380-4  ${csv(f)},[(82088,103147,1),(82091,103150,2)],[(272149,295,(7967,0,0),(12834,6652),(240983,295))]`;
  })(),
  // Shield Wall cast, then a buff aura, then damage, then death.
  line('9/3/2026 22:15:30.000-4', ['SPELL_CAST_SUCCESS', PLAYER, 'Testy-Azgalor-US', '0x514', '0x80000000', PLAYER, 'Testy-Azgalor-US', '0x514', '0x80000000', 871, 'Shield Wall', '0x1', PLAYER, '0000000000000000', 800000, 800000, 1000, 2000, 1000, 0, 0, 100, 100, 0, 0, 0, 700.0, -350.0, 2608, 3.0, 310]),
  auraLine('9/3/2026 22:15:30.000-4', 'SPELL_AURA_APPLIED', PLAYER, 'Testy-Azgalor-US', PLAYER, 'Testy-Azgalor-US', 871, 'Shield Wall', 'BUFF'),
  spellLine('9/3/2026 22:16:40.000-4', 'SPELL_PERIODIC_DAMAGE', BOSS, "Breath of Ula'tek", PLAYER, 'Testy-Azgalor-US', 1284500, 'Mark of Acid', 700000, 50000, -1),
  spellLine('9/3/2026 22:16:49.024-4', 'SPELL_DAMAGE', BOSS, "Breath of Ula'tek", PLAYER, 'Testy-Azgalor-US', 1284209, 'Living Venom', 0, 226661, 40013),
  // The game strips auras at death; these must NOT erase the
  // "active at death" snapshot.
  auraLine('9/3/2026 22:16:49.024-4', 'SPELL_AURA_REMOVED', PLAYER, 'Testy-Azgalor-US', PLAYER, 'Testy-Azgalor-US', 871, 'Shield Wall', 'BUFF'),
  line('9/3/2026 22:16:49.025-4', ['UNIT_DIED', '0000000000000000', 'nil', '0x80000000', '0x80000000', PLAYER, 'Testy-Azgalor-US', '0x514', '0x80000000', 0]),
  line('9/3/2026 22:23:24.967-4', ['ENCOUNTER_END', 3445, 'Entombed Sentinels', 15, 15, 0, 482622]),
].join('\n');

const result = parseCombatLogText(log, { windowSec: 10, avoidableMarks: { 1284209: 'avoidable' } });
assert.strictEqual(result.pulls.length, 1, 'one pull');
assert.strictEqual(result.pulls[0].name, 'Entombed Sentinels');
assert.strictEqual(result.pulls[0].success, false);
assert.strictEqual(result.totalPlayerDeaths, 1, 'one player death');
const death = result.deaths[0];
assert.strictEqual(death.player, 'Testy-Azgalor-US');
assert.strictEqual(death.playerClass, 'Warrior', 'spec 71 maps to Warrior');
assert.strictEqual(death.killingBlow.spell, 'Living Venom');
assert.strictEqual(death.killingBlow.amount, 226661);
assert.strictEqual(death.killingBlow.overkill, 40013);
assert.strictEqual(death.killingBlow.effectiveAmount, 186648);
assert.strictEqual(death.verdict, 'avoidable', 'marked killing blow drives the verdict');
assert.strictEqual(death.totalDamage, 276661, 'periodic + killing blow in the 10s window');
assert.ok(death.activeAuras.some((a) => a.name === 'Shield Wall'), 'Shield Wall survives the death-strip');
assert.ok(death.defensives.active.some((d) => d.name === 'Shield Wall'), 'Shield Wall is an active defensive');
assert.ok(death.damageBySpell.some((s) => s.spell === 'Living Venom' && s.avoidable === 'avoidable'));
assert.strictEqual(death.timeInPullSec, 87, 'time into pull (22:15:22 -> 22:16:49)');
assert.strictEqual(death.killingBlow.hpMax, 800000, 'max HP comes from the advanced params (field 15)');
assert.strictEqual(death.killingBlow.hpAfter, 0, 'HP after the killing blow is 0');
assert.strictEqual(death.avgIlvl, 295, 'average ilvl from the single gear entry in the test log');
assert.strictEqual(death.maxHp, 800000, 'max HP from the killing blow');
// Save analysis: in this log Shield Wall was already active
// at death, so it is not a counterfactual. The available
// ones that would have covered the 40,013 overkill on the
// 226,661 blow are Rallying Cry (+15% max HP) and Die by
// the Sword (30% for 8s).
assert.strictEqual(death.saveAnalysis.available, true, 'save analysis runs with HP data');
assert.strictEqual(death.saveAnalysis.hpBeforeKb, 186648, 'HP before the killing blow = amount - overkill');
assert.strictEqual(death.saveAnalysis.best.name, 'Rallying Cry', 'Rallying Cry leaves the most HP');
assert.strictEqual(death.saveAnalysis.candidates.find((c) => c.name === 'Rallying Cry').survivingHp, 79987, 'Rallying Cry: 186648 - 226661 + 120000');
assert.ok(death.saveAnalysis.candidates.some((c) => c.name === 'Die by the Sword' && c.wouldSave), 'Die by the Sword also saves');
assert.ok(!death.saveAnalysis.candidates.some((c) => c.name === 'Shield Wall'), 'an already-active defensive is not a counterfactual');
// Shirt (index 3), tabard (index 17) and empty slots do not
// count toward average ilvl, matching the in-game figure.
assert.strictEqual(computeAvgIlvl([
  { itemId: 271528, ilvl: 308 }, { itemId: 272229, ilvl: 298 }, { itemId: 271526, ilvl: 308 },
  { itemId: 98080, ilvl: 1 }, { itemId: 271531, ilvl: 308 }, { itemId: 272245, ilvl: 295 },
  { itemId: 268225, ilvl: 308 }, { itemId: 268261, ilvl: 298 }, { itemId: 244576, ilvl: 305 },
  { itemId: 271529, ilvl: 308 }, { itemId: 272149, ilvl: 295 }, { itemId: 251513, ilvl: 285 },
  { itemId: 270175, ilvl: 308 }, { itemId: 270168, ilvl: 308 }, { itemId: 156339, ilvl: 305 },
  { itemId: 268215, ilvl: 308 }, { itemId: 0, ilvl: 0 }, { itemId: 52252, ilvl: 14 },
]), 303, 'real Feral Druid gear from the raid log averages to 303');
assert.deepStrictEqual(death.talents, [
  { nodeId: 82088, spellId: 103147, rank: 1 },
  { nodeId: 82091, spellId: 103150, rank: 2 },
], 'talent triples parse from COMBATANT_INFO; the gear entry does not');

// A second, unmarked log must not guess: verdict stays unknown.
const unmarked = parseCombatLogText(log, { windowSec: 10 });
assert.strictEqual(unmarked.deaths[0].verdict, 'unknown');
assert.strictEqual(unmarked.deaths[0].killingBlow.avoidable, 'unknown');

// Spec awareness: the same class, different specs, get
// different defensive lists, and the spec name is exposed.
assert.strictEqual(death.playerSpec, 'Arms', 'spec 71 maps to Arms');
{
  const names = [...death.defensives.active, ...death.defensives.available, ...death.defensives.onCooldown].map((d) => d.name);
  assert.ok(names.includes('Die by the Sword'), 'Arms sees Die by the Sword');
  assert.ok(!names.includes('Last Stand'), 'Arms does NOT see Protection-only Last Stand');
  assert.ok(!names.includes('Enraged Regeneration'), 'Arms does NOT see Fury-only Enraged Regeneration');
}
function specLog(specId, auraId, auraName) {
  const f = ['COMBATANT_INFO', PLAYER, 1, 2603, 429, 38689, 436, 0, 0, 0, 0, 1191, 1191, 1191, 0, 0, 676, 676, 676, 0, 589, 185, 185, 185, 2318, specId];
  return [
    line('9/3/2026 22:15:22.380-4', ['COMBAT_LOG_VERSION', 22, 'ADVANCED_LOG_ENABLED', 1, 'BUILD_VERSION', '12.1.0', 'PROJECT_ID', 1]),
    line('9/3/2026 22:15:22.380-4', ['ENCOUNTER_START', 3445, 'Entombed Sentinels', 15, 15, 3004]),
    `9/3/2026 22:15:22.380-4  ${csv(f)},[(82088,103147,1),(82091,103150,2)],[(272149,295,(7967,0,0),(12834,6652),(240983,295))]`,
    auraLine('9/3/2026 22:16:40.000-4', 'SPELL_AURA_APPLIED', PLAYER, 'Testy-Azgalor-US', PLAYER, 'Testy-Azgalor-US', auraId, auraName, 'BUFF'),
    spellLine('9/3/2026 22:16:49.024-4', 'SPELL_DAMAGE', BOSS, "Breath of Ula'tek", PLAYER, 'Testy-Azgalor-US', 1284209, 'Living Venom', 0, 226661, 40013),
    line('9/3/2026 22:16:49.025-4', ['UNIT_DIED', '0000000000000000', 'nil', '0x80000000', '0x80000000', PLAYER, 'Testy-Azgalor-US', '0x514', '0x80000000', 0]),
  ].join('\n');
}
function defNames(d) { return [...d.defensives.active, ...d.defensives.available, ...d.defensives.onCooldown].map((x) => x.name); }
const prot = parseCombatLogText(specLog(73, 871, 'Shield Wall'), { windowSec: 10 }).deaths[0];
assert.strictEqual(prot.playerSpec, 'Protection', 'spec 73 maps to Protection');
assert.strictEqual(prot.talents.length, 2, 'spec log talents parse (gear skipped)');
assert.ok(defNames(prot).includes('Last Stand'), 'Protection sees Last Stand');
assert.ok(!defNames(prot).includes('Die by the Sword'), 'Protection does NOT see Die by the Sword');
const shadow = parseCombatLogText(specLog(258, 47585, 'Dispersion'), { windowSec: 10 }).deaths[0];
assert.strictEqual(shadow.playerSpec, 'Shadow', 'spec 258 maps to Shadow');
assert.ok(defNames(shadow).includes('Dispersion'), 'Shadow sees Dispersion');
assert.ok(!defNames(shadow).includes('Pain Suppression'), 'Shadow does NOT see Discipline-only Pain Suppression');
assert.ok(!defNames(shadow).includes('Guardian Spirit'), 'Shadow does NOT see Holy-only Guardian Spirit');
// Spec filtering never hides a fact: a Protection Warrior with
// Die by the Sword actually active still shows it as active.
const protSword = parseCombatLogText(specLog(73, 118038, 'Die by the Sword'), { windowSec: 10 }).deaths[0];
assert.ok(protSword.defensives.active.some((d) => d.name === 'Die by the Sword'), 'actually-active defensive survives spec filtering');

console.log('deathAnalyzer: all tests passed');
