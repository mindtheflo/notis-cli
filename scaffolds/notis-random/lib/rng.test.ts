import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkBounds,
  parseBoundDraft,
  randomIntInclusive,
  randomUnit,
  roll,
} from './rng';

test('numeric drafts preserve empty and negative intermediate states', () => {
  assert.ok(Number.isNaN(parseBoundDraft('')));
  assert.ok(Number.isNaN(parseBoundDraft('-')));
  assert.equal(parseBoundDraft('-12.5'), -12.5);
});

test('randomUnit stays inside [0, 1)', () => {
  for (let i = 0; i < 20000; i += 1) {
    const value = randomUnit();
    assert.ok(value >= 0, `${value} < 0`);
    assert.ok(value < 1, `${value} >= 1`);
  }
});

test('randomIntInclusive never leaves the range and reaches both ends', () => {
  const seen = new Set<number>();
  for (let i = 0; i < 20000; i += 1) {
    const value = randomIntInclusive(1, 6);
    assert.ok(Number.isInteger(value), `${value} is not an integer`);
    assert.ok(value >= 1 && value <= 6, `${value} outside [1, 6]`);
    seen.add(value);
  }
  assert.deepEqual([...seen].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
});

test('randomIntInclusive is uniform enough over a non-power-of-two span', () => {
  const draws = 60000;
  const faces = 6;
  const counts = new Map<number, number>();
  for (let i = 0; i < draws; i += 1) {
    const value = randomIntInclusive(1, faces);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const expected = draws / faces;
  for (const [face, count] of counts) {
    const drift = Math.abs(count - expected) / expected;
    assert.ok(drift < 0.06, `face ${face} drifted ${(drift * 100).toFixed(2)}% from uniform`);
  }
});

test('randomIntInclusive collapses a single-value range', () => {
  assert.equal(randomIntInclusive(7, 7), 7);
});

test('randomIntInclusive snaps fractional bounds inward', () => {
  for (let i = 0; i < 500; i += 1) {
    const value = randomIntInclusive(1.2, 4.8);
    assert.ok([2, 3, 4].includes(value), `${value} outside {2, 3, 4}`);
  }
});

test('checkBounds rejects min >= max', () => {
  assert.equal(checkBounds(10, 10, 'integer').issue?.code, 'min-not-below-max');
  assert.equal(checkBounds(10, 1, 'integer').issue?.code, 'min-not-below-max');
});

test('checkBounds rejects NaN bounds', () => {
  assert.equal(checkBounds(Number.NaN, 10, 'integer').issue?.code, 'min-not-a-number');
  assert.equal(checkBounds(1, Number.NaN, 'integer').issue?.code, 'max-not-a-number');
});

test('checkBounds rejects an integer range with no whole number inside', () => {
  assert.equal(checkBounds(1.2, 1.8, 'integer').issue?.code, 'empty-integer-range');
});

test('checkBounds keeps fractional bounds in decimal mode', () => {
  const result = checkBounds(0.5, 1.5, 'decimal');
  assert.equal(result.ok, true);
  assert.equal(result.min, 0.5);
  assert.equal(result.max, 1.5);
});

test('checkBounds rejects decimal spans that overflow', () => {
  const result = checkBounds(-Number.MAX_VALUE, Number.MAX_VALUE, 'decimal');
  assert.equal(result.ok, false);
  assert.equal(result.issue?.code, 'range-too-wide');
  assert.throws(
    () => roll(-Number.MAX_VALUE, Number.MAX_VALUE, 'decimal'),
    RangeError,
  );
});

test('checkBounds snaps integer bounds inward', () => {
  const result = checkBounds(1.2, 4.8, 'integer');
  assert.equal(result.ok, true);
  assert.equal(result.min, 2);
  assert.equal(result.max, 4);
});

test('checkBounds rejects integer bounds outside the safe range', () => {
  const result = checkBounds(
    Number.MAX_SAFE_INTEGER + 1,
    Number.MAX_SAFE_INTEGER + 4,
    'integer',
  );
  assert.equal(result.ok, false);
  assert.equal(result.issue?.code, 'range-too-wide');
  assert.throws(
    () => randomIntInclusive(
      Number.MAX_SAFE_INTEGER + 1,
      Number.MAX_SAFE_INTEGER + 4,
    ),
    RangeError,
  );
});

test('roll records the bounds it actually used', () => {
  const result = roll(1.2, 4.8, 'integer');
  assert.equal(result.min, 2);
  assert.equal(result.max, 4);
  assert.ok(Number.isInteger(result.value));
  assert.ok(result.value >= 2 && result.value <= 4);
  assert.ok(!Number.isNaN(Date.parse(result.at)));
});

test('roll in decimal mode stays in [min, max)', () => {
  for (let i = 0; i < 5000; i += 1) {
    const result = roll(0, 1, 'decimal');
    assert.ok(result.value >= 0 && result.value < 1, `${result.value} outside [0, 1)`);
  }
});

test('roll throws on an invalid range instead of silently swapping', () => {
  assert.throws(() => roll(10, 1, 'integer'), RangeError);
});
