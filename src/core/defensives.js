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
const DEFENSIVES = [
  // Warrior
  { id: 871, name: 'Shield Wall', cls: 'Warrior', cooldownSec: 240, desc: 'Reduces all damage taken by 40% for 8 seconds.' },
  { id: 12975, name: 'Last Stand', cls: 'Warrior', cooldownSec: 180, desc: 'Temporarily increases maximum health by 30% for 15 seconds.' },
  { id: 118038, name: 'Die by the Sword', cls: 'Warrior', cooldownSec: 180, desc: 'Reduces damage taken by 30% and parries attacks for 8 seconds.' },
  { id: 23920, name: 'Spell Reflection', cls: 'Warrior', cooldownSec: 25, desc: 'Reflects the next spell cast at you back at its caster.' },
  { id: 184364, name: 'Enraged Regeneration', cls: 'Warrior', cooldownSec: 120, desc: 'Heals over 10 seconds, increased while below 50% health.' },
  { id: 97463, name: 'Rallying Cry', cls: 'Warrior', cooldownSec: 180, desc: 'Temporarily increases maximum health of all party/raid members by 15% for 10 seconds.' },
  // Paladin
  { id: 642, name: 'Divine Shield', cls: 'Paladin', cooldownSec: 300, desc: 'Makes you immune to all damage and harmful effects for 8 seconds.' },
  { id: 1022, name: 'Blessing of Protection', cls: 'Paladin', cooldownSec: 300, desc: 'Makes a friendly target immune to physical attacks for 10 seconds (cannot attack).' },
  { id: 184662, name: 'Shield of Vengeance', cls: 'Paladin', cooldownSec: 120, desc: 'Absorbs damage for 15 seconds; when it breaks it damages nearby enemies.' },
  { id: 31850, name: 'Ardent Defender', cls: 'Paladin', cooldownSec: 120, desc: 'Reduces damage taken by 20% for 8 seconds; if a killing blow would occur, heals you instead (once).' },
  { id: 86659, name: 'Guardian of Ancient Kings', cls: 'Paladin', cooldownSec: 300, desc: 'Reduces damage taken by 20% for 8 seconds and increases healing received.' },
  { id: 498, name: 'Divine Protection', cls: 'Paladin', cooldownSec: 60, desc: 'Reduces damage taken by 20% for 8 seconds.' },
  // Death Knight
  { id: 48792, name: 'Icebound Fortitude', cls: 'Death Knight', cooldownSec: 180, desc: 'Reduces all damage taken by 30% for 8 seconds.' },
  { id: 48707, name: 'Anti-Magic Shell', cls: 'Death Knight', cooldownSec: 60, desc: 'Absorbs magic damage and prevents harmful magic effects for 5 seconds.' },
  { id: 55233, name: 'Vampiric Blood', cls: 'Death Knight', cooldownSec: 120, desc: 'Increases maximum health by 30% and healing received by 30% for 10 seconds.' },
  { id: 48743, name: 'Death Pact', cls: 'Death Knight', cooldownSec: 120, desc: 'Sacrifices a ghoul to heal you for 50% of maximum health.' },
  // Demon Hunter
  { id: 198589, name: 'Blur', cls: 'Demon Hunter', cooldownSec: 60, desc: 'Increases dodge chance by 50% and reduces damage taken by 20% for 10 seconds.' },
  { id: 196718, name: 'Darkness', cls: 'Demon Hunter', cooldownSec: 180, desc: 'Creates a zone that reduces damage taken by allies inside by 20% for 8 seconds.' },
  { id: 196555, name: 'Netherwalk', cls: 'Demon Hunter', cooldownSec: 180, desc: 'Become immune to damage and untargetable for 4 seconds, then return.' },
  // Druid
  { id: 22812, name: 'Barkskin', cls: 'Druid', cooldownSec: 60, desc: 'Reduces all damage taken by 20% for 12 seconds.' },
  { id: 61336, name: 'Survival Instincts', cls: 'Druid', cooldownSec: 180, desc: 'Reduces all damage taken by 50% for 12 seconds.' },
  { id: 22842, name: 'Frenzied Regeneration', cls: 'Druid', cooldownSec: 60, desc: 'Heals over 3 seconds, with extra healing from recent damage taken.' },
  // Monk
  { id: 115203, name: 'Fortifying Brew', cls: 'Monk', cooldownSec: 360, desc: 'Increases health by 15%, reduces damage taken, and increases stagger for 15 seconds.' },
  { id: 122278, name: 'Dampen Harm', cls: 'Monk', cooldownSec: 120, desc: 'Reduces the next three attacks against you by 50%.' },
  { id: 122783, name: 'Diffuse Magic', cls: 'Monk', cooldownSec: 90, desc: 'Reduces magic damage taken by 60% for 6 seconds.' },
  { id: 115176, name: 'Zen Meditation', cls: 'Monk', cooldownSec: 300, desc: 'Reduces all damage taken by 60% while channeling, up to 5 seconds.' },
  // Priest
  { id: 19236, name: 'Desperate Prayer', cls: 'Priest', cooldownSec: 90, desc: 'Heals you for a large amount instantly.' },
  { id: 47788, name: 'Guardian Spirit', cls: 'Priest', cooldownSec: 180, desc: 'If a target would die, heals them for 40% of maximum health instead (once).' },
  { id: 33206, name: 'Pain Suppression', cls: 'Priest', cooldownSec: 180, desc: 'Reduces damage taken by a friendly target by 40% for 8 seconds.' },
  // Rogue
  { id: 5277, name: 'Evasion', cls: 'Rogue', cooldownSec: 120, desc: 'Increases dodge chance by 100% for 10 seconds.' },
  { id: 31224, name: 'Cloak of Shadows', cls: 'Rogue', cooldownSec: 120, desc: 'Makes you immune to harmful magic effects for 5 seconds.' },
  { id: 178861, name: 'Feint', cls: 'Rogue', cooldownSec: 15, desc: 'Reduces all damage taken by 40% for 5 seconds.' },
  { id: 185311, name: 'Crimson Vial', cls: 'Rogue', cooldownSec: 30, desc: 'Heals you over 4 seconds.' },
  // Hunter
  { id: 186265, name: 'Aspect of the Turtle', cls: 'Hunter', cooldownSec: 180, desc: 'Reduces all damage taken by 30% and deflects attacks for 8 seconds.' },
  { id: 109304, name: 'Exhilaration', cls: 'Hunter', cooldownSec: 120, desc: 'Heals you for a large amount over 10 seconds.' },
  // Mage
  { id: 45438, name: 'Ice Block', cls: 'Mage', cooldownSec: 240, desc: 'Encases you in ice, making you immune to damage for 10 seconds.' },
  { id: 110959, name: 'Greater Invisibility', cls: 'Mage', cooldownSec: 120, desc: 'Turns you invisible and reduces damage taken for 20 seconds.' },
  { id: 235450, name: 'Prismatic Barrier', cls: 'Mage', cooldownSec: 25, desc: 'Absorbs damage for 60 seconds.' },
  // Warlock
  { id: 104773, name: 'Unending Resolve', cls: 'Warlock', cooldownSec: 180, desc: 'Reduces all damage taken by 40% for 8 seconds.' },
  { id: 108416, name: 'Dark Pact', cls: 'Warlock', cooldownSec: 60, desc: 'Sacrifices health to gain a large absorb shield.' },
  // Evoker
  { id: 363916, name: 'Obsidian Scales', cls: 'Evoker', cooldownSec: 150, desc: 'Reduces damage taken by 30% for 12 seconds (scales with vers).' },
  { id: 374348, name: 'Renewing Blaze', cls: 'Evoker', cooldownSec: 90, desc: 'Heals over 5 seconds, increased by damage taken during it.' },
  // Shaman
  { id: 108271, name: 'Astral Shift', cls: 'Shaman', cooldownSec: 90, desc: 'Reduces all damage taken by 40% for 10 seconds.' },
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

function defensiveById(id) { return BY_ID.get(String(id)) || null; }
function defensivesForClass(cls) { return DEFENSIVES.filter((d) => d.cls === cls); }
function classForSpec(specId) { return SPEC_TO_CLASS[specId] || null; }

module.exports = { DEFENSIVES, defensiveById, defensivesForClass, classForSpec };
