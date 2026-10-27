'use strict';
// Defensive cooldown database for the Death Analyzer.
//
// Every entry is a spell a player can press to reduce or prevent
// damage. Cooldowns are the typical base values — talents, set
// bonuses and class tuning can change them, so the analyzer calls
// "available" an estimate, never a certainty, when it is derived
// from last-cast + cooldown. An aura that is actually active at
// the moment of death is a fact, not an estimate.
//
// Spell IDs are the cast spell IDs. In most cases the buff aura
// shares the same ID, which is how "active at death" is detected
// from SPELL_AURA_APPLIED / SPELL_AURA_REFRESH in the log.
//
// Save analysis: an entry with a `save` model can be
// quantified for "what would have saved you" — mitigation
// (fraction of damage reduced, for durationSec, for the
// given schools), hpBonus / heal (fraction of max HP),
// cheatDeath, or nextHits (mitigation on the next N hits).
// Entries without a model (absorbs with unknown amounts,
// heals with unknown amounts, Spell Reflection, etc.) are
// left out of the save analysis rather than guessed.
// School bitmask: 1 physical, rest magic; melee = SWING hits.
 //
// Spec awareness: an entry with a `specs` list only belongs to
// those specs; entries without one are class-wide. An entry may
// also carry `cooldownBySpec` for specs whose cooldown differs
// from the base. Only restrictions and cooldowns that are clear
// for a spec are listed — anything else stays class-wide with
// the base cooldown, and the UI still calls "available" an
// estimate. Crucially, spec filtering never hides a fact: a
// defensive the player actually cast or had active in the log
// is always shown, even if it falls outside their spec list.
const DEFENSIVES = [
  // Warrior
  { id: 871, name: 'Shield Wall', cls: 'Warrior', cooldownSec: 240, desc: 'Reduces all damage taken by 40% for 8 seconds.', save: { mitigation: 0.40, durationSec: 8, schools: 'all' } },
  { id: 12975, name: 'Last Stand', cls: 'Warrior', cooldownSec: 180, specs: ['Protection'], desc: 'Temporarily increases maximum health by 30% for 15 seconds.', save: { hpBonus: 0.30 } },
  { id: 118038, name: 'Die by the Sword', cls: 'Warrior', cooldownSec: 180, specs: ['Arms', 'Fury'], desc: 'Reduces damage taken by 30% and parries attacks for 8 seconds.', save: { mitigation: 0.30, durationSec: 8, schools: 'all' } },
  { id: 23920, name: 'Spell Reflection', cls: 'Warrior', cooldownSec: 25, desc: 'Reflects the next spell cast at you back at its caster.' },
  { id: 184364, name: 'Enraged Regeneration', cls: 'Warrior', cooldownSec: 120, specs: ['Fury'], desc: 'Heals over 10 seconds, increased while below 50% health.' },
  { id: 97463, name: 'Rallying Cry', cls: 'Warrior', cooldownSec: 180, desc: 'Temporarily increases maximum health of all party/raid members by 15% for 10 seconds.', save: { hpBonus: 0.15 } },
  // Paladin
  { id: 642, name: 'Divine Shield', cls: 'Paladin', cooldownSec: 300, desc: 'Makes you immune to all damage and harmful effects for 8 seconds.', save: { mitigation: 1.00, durationSec: 8, schools: 'all' } },
  { id: 1022, name: 'Blessing of Protection', cls: 'Paladin', cooldownSec: 300, desc: 'Makes a friendly target immune to physical attacks for 10 seconds (cannot attack).', save: { mitigation: 1.00, durationSec: 10, schools: 'physical' } },
  { id: 184662, name: 'Shield of Vengeance', cls: 'Paladin', cooldownSec: 120, specs: ['Retribution'], desc: 'Absorbs damage for 15 seconds; when it breaks it damages nearby enemies.' },
  { id: 31850, name: 'Ardent Defender', cls: 'Paladin', cooldownSec: 120, specs: ['Protection'], desc: 'Reduces damage taken by 20% for 8 seconds; if a killing blow would occur, heals you instead (once).', save: { mitigation: 0.20, durationSec: 8, schools: 'all', cheatDeath: true } },
  { id: 86659, name: 'Guardian of Ancient Kings', cls: 'Paladin', cooldownSec: 300, specs: ['Holy', 'Protection'], desc: 'Reduces damage taken by 20% for 8 seconds and increases healing received.', save: { mitigation: 0.20, durationSec: 8, schools: 'all' } },
  { id: 498, name: 'Divine Protection', cls: 'Paladin', cooldownSec: 60, specs: ['Retribution'], desc: 'Reduces damage taken by 20% for 8 seconds.', save: { mitigation: 0.20, durationSec: 8, schools: 'all' } },
  // Death Knight
  { id: 48792, name: 'Icebound Fortitude', cls: 'Death Knight', cooldownSec: 180, desc: 'Reduces all damage taken by 30% for 8 seconds.', save: { mitigation: 0.30, durationSec: 8, schools: 'all' } },
  { id: 48707, name: 'Anti-Magic Shell', cls: 'Death Knight', cooldownSec: 60, desc: 'Absorbs magic damage and prevents harmful magic effects for 5 seconds.' },
  { id: 55233, name: 'Vampiric Blood', cls: 'Death Knight', cooldownSec: 120, specs: ['Blood'], desc: 'Increases maximum health by 30% and healing received by 30% for 10 seconds.', save: { hpBonus: 0.30 } },
  { id: 48743, name: 'Death Pact', cls: 'Death Knight', cooldownSec: 120, desc: 'Sacrifices a ghoul to heal you for 50% of maximum health.', save: { heal: 0.50 } },
  // Demon Hunter
  { id: 198589, name: 'Blur', cls: 'Demon Hunter', cooldownSec: 60, specs: ['Havoc'], desc: 'Increases dodge chance by 50% and reduces damage taken by 20% for 10 seconds.', save: { mitigation: 0.20, durationSec: 10, schools: 'all' } },
  { id: 196718, name: 'Darkness', cls: 'Demon Hunter', cooldownSec: 180, desc: 'Creates a zone that reduces damage taken by allies inside by 20% for 8 seconds.', save: { mitigation: 0.20, durationSec: 8, schools: 'all' } },
  { id: 196555, name: 'Netherwalk', cls: 'Demon Hunter', cooldownSec: 180, specs: ['Havoc'], desc: 'Become immune to damage and untargetable for 4 seconds, then return.', save: { mitigation: 1.00, durationSec: 4, schools: 'all' } },
  // Druid
  { id: 22812, name: 'Barkskin', cls: 'Druid', cooldownSec: 60, desc: 'Reduces all damage taken by 20% for 12 seconds.', save: { mitigation: 0.20, durationSec: 12, schools: 'all' } },
  { id: 61336, name: 'Survival Instincts', cls: 'Druid', cooldownSec: 180, specs: ['Feral', 'Guardian'], desc: 'Reduces all damage taken by 50% for 12 seconds.', save: { mitigation: 0.50, durationSec: 12, schools: 'all' } },
  { id: 22842, name: 'Frenzied Regeneration', cls: 'Druid', cooldownSec: 60, specs: ['Guardian'], desc: 'Heals over 3 seconds, with extra healing from recent damage taken.' },
  // Monk
  { id: 115203, name: 'Fortifying Brew', cls: 'Monk', cooldownSec: 360, desc: 'Increases health by 15%, reduces damage taken, and increases stagger for 15 seconds.', save: { hpBonus: 0.15 } },
  { id: 122278, name: 'Dampen Harm', cls: 'Monk', cooldownSec: 120, desc: 'Reduces the next three attacks against you by 50%.', save: { mitigation: 0.50, schools: 'all', nextHits: 3 } },
  { id: 122783, name: 'Diffuse Magic', cls: 'Monk', cooldownSec: 90, desc: 'Reduces magic damage taken by 60% for 6 seconds.', save: { mitigation: 0.60, durationSec: 6, schools: 'magic' } },
  { id: 115176, name: 'Zen Meditation', cls: 'Monk', cooldownSec: 300, desc: 'Reduces all damage taken by 60% while channeling, up to 5 seconds.', save: { mitigation: 0.60, durationSec: 5, schools: 'all' } },
  // Priest
  { id: 19236, name: 'Desperate Prayer', cls: 'Priest', cooldownSec: 90, specs: ['Holy', 'Discipline'], desc: 'Heals you for a large amount instantly.' },
  { id: 47788, name: 'Guardian Spirit', cls: 'Priest', cooldownSec: 180, specs: ['Holy'], desc: 'If a target would die, heals them for 40% of maximum health instead (once).', save: { cheatDeath: true } },
  { id: 33206, name: 'Pain Suppression', cls: 'Priest', cooldownSec: 180, specs: ['Discipline'], desc: 'Reduces damage taken by a friendly target by 40% for 8 seconds.', save: { mitigation: 0.40, durationSec: 8, schools: 'all' } },
  // Priest (spec-only additions)
  { id: 47585, name: 'Dispersion', cls: 'Priest', cooldownSec: 120, specs: ['Shadow'], desc: 'Reduces all damage taken by 75% for 6 seconds.', save: { mitigation: 0.75, durationSec: 6, schools: 'all' } },
  // Rogue
  { id: 5277, name: 'Evasion', cls: 'Rogue', cooldownSec: 120, desc: 'Increases dodge chance by 100% for 10 seconds.', save: { mitigation: 1.00, durationSec: 10, schools: 'melee' } },
  { id: 31224, name: 'Cloak of Shadows', cls: 'Rogue', cooldownSec: 120, desc: 'Makes you immune to harmful magic effects for 5 seconds.', save: { mitigation: 1.00, durationSec: 5, schools: 'magic' } },
  { id: 178861, name: 'Feint', cls: 'Rogue', cooldownSec: 15, desc: 'Reduces all damage taken by 40% for 5 seconds.', save: { mitigation: 0.40, durationSec: 5, schools: 'all' } },
  { id: 185311, name: 'Crimson Vial', cls: 'Rogue', cooldownSec: 30, desc: 'Heals you over 4 seconds.' },
  // Hunter
  { id: 186265, name: 'Aspect of the Turtle', cls: 'Hunter', cooldownSec: 180, desc: 'Reduces all damage taken by 30% and deflects attacks for 8 seconds.', save: { mitigation: 0.30, durationSec: 8, schools: 'all' } },
  { id: 109304, name: 'Exhilaration', cls: 'Hunter', cooldownSec: 120, desc: 'Heals you for a large amount over 10 seconds.' },
  // Mage
  { id: 45438, name: 'Ice Block', cls: 'Mage', cooldownSec: 240, desc: 'Encases you in ice, making you immune to damage for 10 seconds.', save: { mitigation: 1.00, durationSec: 10, schools: 'all' } },
  { id: 110959, name: 'Greater Invisibility', cls: 'Mage', cooldownSec: 120, desc: 'Turns you invisible and reduces damage taken for 20 seconds.' },
  { id: 235450, name: 'Prismatic Barrier', cls: 'Mage', cooldownSec: 25, desc: 'Absorbs damage for 60 seconds.' },
  // Warlock
  { id: 104773, name: 'Unending Resolve', cls: 'Warlock', cooldownSec: 180, desc: 'Reduces all damage taken by 40% for 8 seconds.', save: { mitigation: 0.40, durationSec: 8, schools: 'all' } },
  { id: 108416, name: 'Dark Pact', cls: 'Warlock', cooldownSec: 60, desc: 'Sacrifices health to gain a large absorb shield.' },
  // Evoker
  { id: 363916, name: 'Obsidian Scales', cls: 'Evoker', cooldownSec: 150, desc: 'Reduces damage taken by 30% for 12 seconds (scales with vers).', save: { mitigation: 0.30, durationSec: 12, schools: 'all' } },
  { id: 374348, name: 'Renewing Blaze', cls: 'Evoker', cooldownSec: 90, desc: 'Heals over 5 seconds, increased by damage taken during it.' },
  // Demon Hunter (spec-only additions)
  { id: 203720, name: 'Demon Spikes', cls: 'Demon Hunter', cooldownSec: 20, specs: ['Vengeance'], desc: 'Increases armor and parry chance for 6 seconds.' },
  // Shaman
  { id: 108271, name: 'Astral Shift', cls: 'Shaman', cooldownSec: 90, desc: 'Reduces all damage taken by 40% for 10 seconds.', save: { mitigation: 0.40, durationSec: 10, schools: 'all' } },
];

const BY_ID = new Map(DEFENSIVES.map((d) => [String(d.id), d]));

// Spec ID (from COMBATANT_INFO) -> class. Covers the current
// retail specs; unknown specs map to null and the analyzer then
// only shows defensives the player actually used or had active.
const SPEC_TO_CLASS = {
  62: 'Mage', 63: 'Mage', 64: 'Mage',
  65: 'Paladin', 66: 'Paladin', 70: 'Paladin',
  71: 'Warrior', 72: 'Warrior', 73: 'Warrior',
  102: 'Druid', 103: 'Druid', 104: 'Druid', 105: 'Druid',
  250: 'Death Knight', 251: 'Death Knight', 252: 'Death Knight',
  253: 'Hunter', 254: 'Hunter', 255: 'Hunter',
  256: 'Priest', 257: 'Priest', 258: 'Priest',
  259: 'Rogue', 260: 'Rogue', 261: 'Rogue',
  262: 'Shaman', 263: 'Shaman', 264: 'Shaman',
  265: 'Warlock', 266: 'Warlock', 267: 'Warlock',
  268: 'Monk', 269: 'Monk', 270: 'Monk',
  577: 'Demon Hunter', 581: 'Demon Hunter',
  1467: 'Evoker', 1468: 'Evoker', 1473: 'Evoker',
};

const SPEC_NAMES = {
  62: 'Arcane', 63: 'Fire', 64: 'Frost',
  65: 'Holy', 66: 'Protection', 70: 'Retribution',
  71: 'Arms', 72: 'Fury', 73: 'Protection',
  102: 'Balance', 103: 'Feral', 104: 'Guardian', 105: 'Restoration',
  250: 'Blood', 251: 'Frost', 252: 'Unholy',
  253: 'Beast Mastery', 254: 'Marksmanship', 255: 'Survival',
  256: 'Discipline', 257: 'Holy', 258: 'Shadow',
  259: 'Assassination', 260: 'Outlaw', 261: 'Subtlety',
  262: 'Elemental', 263: 'Enhancement', 264: 'Restoration',
  265: 'Affliction', 266: 'Demonology', 267: 'Destruction',
  268: 'Brewmaster', 269: 'Windwalker', 270: 'Mistweaver',
  577: 'Havoc', 581: 'Vengeance',
  1467: 'Devastation', 1468: 'Preservation', 1473: 'Augmentation',
};

function defensiveById(id) { return BY_ID.get(String(id)) || null; }
function defensivesForClass(cls) { return DEFENSIVES.filter((d) => d.cls === cls); }
function classForSpec(specId) { return SPEC_TO_CLASS[specId] || null; }
function specNameForSpec(specId) { return SPEC_NAMES[specId] || null; }
function specMatches(d, spec) { return !spec || !d.specs || d.specs.includes(spec); }
function defensivesForSpec(cls, spec) {
  return DEFENSIVES.filter((d) => d.cls === cls && specMatches(d, spec));
}
function effectiveCooldown(d, spec) {
  return (spec && d.cooldownBySpec && d.cooldownBySpec[spec]) || d.cooldownSec;
}

module.exports = { DEFENSIVES, defensiveById, defensivesForClass, defensivesForSpec, classForSpec, specNameForSpec, effectiveCooldown };
