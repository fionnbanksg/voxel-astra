import test from 'node:test';
import assert from 'node:assert/strict';
import { B, solid } from '../dist/src/blocks.js';
import { propagateLight, lightType } from '../dist/src/block-light.js';
import { meshSection } from '../dist/src/mesh.js';
const n = 20,
  index = (x, y, z) => x + n * (y + n * z),
  rgb = (map, x, y, z) => Array.from(map.slice(index(x, y, z) * 4, index(x, y, z) * 4 + 3));
test('torch light falls off, is warm, and disappears when removed', () => {
  const a = new Uint8Array(n ** 3);
  a[index(5, 10, 10)] = B.TORCH;
  const light = propagateLight(a, n);
  const near = rgb(light, 6, 10, 10),
    far = rgb(light, 13, 10, 10);
  assert.ok(near[0] > near[1] && near[1] > near[2]);
  assert.ok(near[0] > far[0] && far[0] > 0);
  a.fill(0);
  assert.deepEqual(rgb(propagateLight(a, n), 6, 10, 10), [0, 0, 0]);
});
test('solid walls block the flood; opening a doorway lets light pass', () => {
  const a = new Uint8Array(n ** 3);
  a[index(7, 10, 10)] = B.TORCH;
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) a[index(10, y, z)] = B.STONE;
  assert.deepEqual(rgb(propagateLight(a, n), 11, 10, 10), [0, 0, 0]);
  a[index(10, 10, 10)] = B.AIR;
  assert.ok(rgb(propagateLight(a, n), 11, 10, 10)[0] > 0);
});
test('held light moves independently and lava/portals have distinct hues', () => {
  const a = new Uint8Array(n ** 3),
    first = propagateLight(a, n, index(2, 10, 10)),
    moved = propagateLight(a, n, index(18, 10, 10));
  assert.ok(rgb(first, 2, 10, 10)[0] > 0);
  assert.deepEqual(rgb(moved, 2, 10, 10), [0, 0, 0]);
  a[index(5, 10, 10)] = B.PORTAL;
  let color = rgb(propagateLight(a, n), 6, 10, 10);
  assert.ok(color[2] > color[0]);
  a[index(5, 10, 10)] = B.LAVA_FLOW_1;
  color = rgb(propagateLight(a, n), 6, 10, 10);
  assert.ok(color[0] > color[2]);
  assert.equal(lightType(B.STONE), -1);
});
test('torch has a narrow non-colliding mesh in the emissive batch', () => {
  assert.equal(solid(B.TORCH), false);
  const m = meshSection((x, y, z) => (x === 1 && y === 1 && z === 1 ? B.TORCH : B.AIR), 0, []);
  assert.equal(m.effects.index.length, 36);
  assert.equal(m.opaque.index.length, 0);
  const xs = Array.from(m.effects.position).filter((v, i) => i % 3 === 0);
  assert.ok(Math.max(...xs) - Math.min(...xs) < 0.19);
});
