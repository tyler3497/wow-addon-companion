'use strict';
// Headless tests for the Death Analyzer parser. Run with:
//   npm run test:core
// (updater tests live in updater.test.js; both are run by that
// script — see the test:core script in package.json.)
const assert = require('assert');
const { parseCombatLogText } = require('./deathAnalyzer');

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
    return `9/3/2026 22:15:22.380-4  ${csv(f)},[(1,2,1)]`;
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

// A second, unmarked log must not guess: verdict stays unknown.
const unmarked = parseCombatLogText(log, { windowSec: 10 });
assert.strictEqual(unmarked.deaths[0].verdict, 'unknown');
assert.strictEqual(unmarked.deaths[0].killingBlow.avoidable, 'unknown');

console.log('deathAnalyzer: all tests passed');
