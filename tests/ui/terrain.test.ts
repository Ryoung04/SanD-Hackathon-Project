import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { terrarium, encodePng } from "../../scripts/elevation/build-terrain";

const decode = ([r, g, b]: number[]) => r * 256 + g + b / 256 - 32768;

test("terrarium encoding round-trips downtown elevations to 0.25 m", () => {
  for (const e of [0, 0.8, 12.34, 86.97, -2]) assert.ok(Math.abs(decode(terrarium(e)) - e) <= 0.125 + 1e-9, String(e));
});

test("encodePng writes a valid RGB PNG with the given pixels", () => {
  const rgb = new Uint8Array([1, 2, 3, 4, 5, 6]);
  const png = encodePng(2, 1, rgb);
  assert.deepEqual([...png.subarray(1, 4)], [80, 78, 71]);
  assert.equal(png.readUInt32BE(16), 2);
  const idat = png.indexOf("IDAT");
  const len = png.readUInt32BE(idat - 4);
  assert.deepEqual([...zlib.inflateSync(png.subarray(idat + 4, idat + 4 + len))], [0, 1, 2, 3, 4, 5, 6]);
});
