import assert from 'node:assert/strict';
import { isWithinQuietHours, reduceProbabilityOvernight } from '../src/quiet-hours.js';

const at = (hour, minute) => new Date(2026, 0, 1, hour, minute);
const quiet = { enabled: true, start: '23:00', end: '08:00' };

assert.equal(isWithinQuietHours(at(22, 59), quiet), false);
assert.equal(isWithinQuietHours(at(23, 0), quiet), true);
assert.equal(isWithinQuietHours(at(0, 0), quiet), true);
assert.equal(isWithinQuietHours(at(7, 59), quiet), true);
assert.equal(isWithinQuietHours(at(8, 0), quiet), false);
assert.equal(isWithinQuietHours(at(2, 0), { enabled: false, start: '23:00', end: '08:00' }), false);
assert.equal(isWithinQuietHours(at(23, 0), { start: 'invalid', end: '08:00' }), true);

assert.equal(reduceProbabilityOvernight(0.2, at(0, 0)), 0.06);
assert.equal(reduceProbabilityOvernight(0.2, at(7, 59)), 0.06);
assert.equal(reduceProbabilityOvernight(0.2, at(8, 0)), 0.2);
assert.equal(reduceProbabilityOvernight(0.2, at(23, 59)), 0.2);

console.log('quiet-hours tests passed');
