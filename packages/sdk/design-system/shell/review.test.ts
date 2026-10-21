import assert from 'node:assert/strict';
import test from 'node:test';

import { changeBoxes } from './review.ts';

function canvas(width: number, height: number): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height * 4).fill(255);
}

function paint(buffer: Uint8ClampedArray, width: number, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) buffer[(y * width + x) * 4] = 0;
  }
}

test('identical shots have no change to circle', () => {
  assert.deepEqual(changeBoxes(canvas(64, 64), canvas(64, 64), 64, 64), []);
});

test('two distant changed parts get one circle each, top first', () => {
  const head = canvas(400, 300);
  paint(head, 400, 300, 200, 340, 220);
  paint(head, 400, 10, 10, 30, 18);
  const boxes = changeBoxes(head, canvas(400, 300), 400, 300);
  assert.equal(boxes.length, 2);
  assert.deepEqual(boxes[0], { x: 8, y: 8, width: 24, height: 16 });
  assert.deepEqual(boxes[1], { x: 296, y: 200, width: 48, height: 24 });
});

test('changed pixels close to each other share one circle', () => {
  const head = canvas(200, 100);
  paint(head, 200, 10, 10, 20, 20);
  paint(head, 200, 36, 10, 46, 20);
  const boxes = changeBoxes(head, canvas(200, 100), 200, 100);
  assert.equal(boxes.length, 1);
  assert.deepEqual(boxes[0], { x: 8, y: 8, width: 40, height: 16 });
});
