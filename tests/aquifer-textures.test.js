import test from 'node:test';
import assert from 'node:assert/strict';
import { B, C, H, idx, solid } from '../dist/src/blocks.js';
import { generateChunk } from '../dist/src/terrain.js';
import { meshSection } from '../dist/src/mesh.js';
import { LOG_END, tilePixel } from '../dist/src/textures.js';

test('carved caves generate source water below groundwater, with dry caves above it', () => {
  let flooded = 0,
    dry = 0,
    boundary = 0;
  for (const [cx, cz] of [
    [-1, -1],
    [0, -1],
    [0, 0],
    [1, 0],
    [2, -2],
    [3, -2],
  ]) {
    const wet = generateChunk(cx, cz, 'overworld', 73191, { trees: 0 });
    const sealed = generateChunk(cx, cz, 'overworld', 73191, { trees: 0, caves: false });
    for (let z = 0; z < C; z++)
      for (let x = 0; x < C; x++) {
        const c = wet.columns[x + z * C];
        for (let y = 1; y <= c.height; y++) {
          const i = idx(x, y, z),
            b = wet.data[i];
          if (!solid(sealed.data[i]) || solid(b)) continue;
          if (y <= c.waterTop) {
            assert.equal(b, B.WATER);
            flooded++;
            if (x === 0 || x === 15 || z === 0 || z === 15) boundary++;
          } else {
            assert.equal(b, B.AIR);
            dry++;
          }
        }
      }
  }
  assert.ok(flooded > 500, `Only ${flooded} flooded cave cells`);
  assert.ok(dry > 100);
  assert.ok(boundary > 50);
});

test('groundwater follows world sea-level options and does not introduce water into volcanic or Nether caves', () => {
  for (const seaLevel of [20, 50]) {
    const c = generateChunk(0, 0, 'overworld', 73191, { seaLevel, trees: 0 });
    for (let y = 1; y <= seaLevel; y++)
      for (let z = 0; z < C; z++)
        for (let x = 0; x < C; x++) assert.notEqual(c.data[idx(x, y, z)], B.AIR);
  }
  for (const [dimension, options] of [
    ['overworld', { preset: 'volcanic' }],
    ['nether', {}],
  ]) {
    const c = generateChunk(0, 0, dimension, 73191, options);
    assert.equal(c.data.includes(B.WATER), false);
  }
});

test('vertical block textures stay upright on every face and logs use end grain on caps', () => {
  const mesh = meshSection(
    (x, y, z) => (x === 2 && y === 3 && z === 4 ? B.WOOD : B.AIR),
    0,
    [],
  ).opaque;
  let caps = 0,
    sides = 0;
  for (let i = 0; i < mesh.position.length / 3; i++) {
    const y = mesh.position[i * 3 + 1],
      ny = mesh.normal[i * 3 + 1],
      u = mesh.uv[i * 2],
      v = mesh.uv[i * 2 + 1];
    const tile = Math.floor(u * 8) + Math.floor((1 - v) * 4) * 8;
    if (ny !== 0) {
      assert.equal(tile, LOG_END);
      caps++;
    } else {
      assert.equal(tile, B.WOOD);
      assert.ok(y === 3 ? v < 0.77 : v > 0.99);
      sides++;
    }
  }
  assert.equal(caps, 8);
  assert.equal(sides, 16);
  // Grass side tile has green at its top and brown underneath.
  assert.notEqual(tilePixel(19, 5, 0), tilePixel(19, 5, 14));
  assert.notEqual(tilePixel(B.WOOD, 7, 7), tilePixel(LOG_END, 7, 7));
});
