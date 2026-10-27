'use strict';
// Tests for the Wowhead spell-info cache policy. Run with:
//   npm run test:core
const assert = require('assert');
const { INFO_TTL_MS, FAILED_TTL_MS, SPELL_ENDPOINT, failureNeedsRetry, entryStatus, publicInfo } = require('./spellCache');

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const fresh = { name: 'Divine Shield', icon: 'spell_holy_divineshield', desc: 'Immune.', fetchedAt: now - DAY, build: '12.1.0' };
assert.strictEqual(entryStatus(fresh, now, '12.1.0'), 'fresh', 'recent entry, same build is fresh');
assert.strictEqual(entryStatus(fresh, now, '12.2.0'), 'stale', 'different build marks the entry dirty');
assert.strictEqual(entryStatus({ ...fresh, fetchedAt: now - INFO_TTL_MS - DAY }, now, '12.1.0'), 'stale', 'entry past the info TTL is stale');
assert.strictEqual(entryStatus({ name: 'Old' }, now, '12.1.0'), 'stale', 'pre-policy entry without fetchedAt is stale');
assert.strictEqual(entryStatus(null, now, '12.1.0'), 'missing', 'no entry is missing');
assert.strictEqual(entryStatus(undefined, now, null), 'missing', 'undefined entry is missing');
assert.strictEqual(entryStatus({ failed: true, fetchedAt: now - DAY }, now, null), 'failed-fresh', 'recent failure is not retried');
assert.strictEqual(entryStatus({ failed: true, fetchedAt: now - FAILED_TTL_MS - DAY }, now, null), 'stale', 'old failure is retried');
assert.strictEqual(entryStatus(fresh, now, null), 'fresh', 'unknown build does not dirty a fresh entry');
assert.deepStrictEqual(publicInfo(fresh), { name: 'Divine Shield', icon: 'spell_holy_divineshield', desc: 'Immune.' }, 'public info strips cache bookkeeping');
assert.strictEqual(publicInfo({ failed: true, fetchedAt: now }), null, 'failed entry has no public info');
// Failures are tagged with the endpoint form that produced them:
// a failure recorded under the old `spell=<id>` form (which
// Wowhead now 404s) must be retried at once, not served as
// failed-fresh for 7 days; a failure under the current form is not.
assert.strictEqual(failureNeedsRetry({ failed: true, fetchedAt: now - DAY }), true, 'untagged failure needs a retry');
assert.strictEqual(failureNeedsRetry({ failed: true, fetchedAt: now - DAY, endpoint: 'equals' }), true, 'old-form failure needs a retry');
assert.strictEqual(failureNeedsRetry({ failed: true, fetchedAt: now - DAY, endpoint: SPELL_ENDPOINT }), false, 'current-form failure is not retried');
assert.strictEqual(failureNeedsRetry(fresh), false, 'good entry never needs a failure retry');
assert.strictEqual(failureNeedsRetry(null), false, 'no entry needs no retry');

console.log('spellCache: all tests passed');
