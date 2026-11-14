import { test } from "node:test";
import assert from "node:assert/strict";
import { lineLengthM, stairBlocks } from "../../src/lib/map/extrude";

// ~11.1 m north-south line downtown
const line: [number, number][] = [[-117.16, 32.72], [-117.16, 32.7201]];

test("lineLengthM ~ 11.1 m for 0.0001° latitude", () => {
  assert.ok(Math.abs(lineLengthM(line) - 11.13) < 0.1);
});

test("stairBlocks: heights rise monotonically, closed rings", () => {
  const b = stairBlocks(line, "way/1", null);
  assert.equal(b.length, 9); // round(11.13/1.2)=9, within [3,12]
  b.forEach((f, i) => {
    assert.ok(Math.abs(f.properties.height - 0.35 * (i + 1)) < 1e-9);
    const ring = f.geometry.coordinates[0];
    assert.equal(ring.length, 5);
    assert.deepEqual(ring[0], ring[4]);
  });
  for (let i = 1; i < b.length; i++) assert.ok(b[i].properties.height > b[i - 1].properties.height);
});

test("stairBlocks: step_count sets block count (capped at 24), tiny lines yield none", () => {
  assert.equal(stairBlocks(line, "way/1", 6).length, 6);
  assert.equal(stairBlocks(line, "way/1", 99).length, 24);
  assert.equal(stairBlocks([[-117.16, 32.72], [-117.16, 32.720001]], "way/1", null).length, 0);
});
