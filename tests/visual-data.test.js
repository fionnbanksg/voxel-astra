import test from 'node:test';
import assert from 'node:assert/strict';
import { B, occludes } from '../dist/src/blocks.js';
import { leafPixelVisible } from '../dist/src/renderer.js';
import { meshSection } from '../dist/src/mesh.js';
import { column } from '../dist/src/terrain.js';
test('leaf tiles contain substantial cutout holes without making leaves non-collidable', () => {
  for (const b of [B.LEAVES, B.CRIMSON, B.WARPED]) {
    let filled = 0;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) filled += leafPixelVisible(x, y, b);
    assert.ok(filled > 120 && filled < 220);
    assert.equal(occludes(b), false);
  }
});
test('leaf cutouts and interior trunk faces use separate depth-writing geometry', () => {
  const mesh = meshSection(
    (x, y, z) => (y === 4 && z === 4 ? (x === 4 ? B.WOOD : x === 5 ? B.LEAVES : B.AIR) : B.AIR),
    0,
    [],
  );
  assert.equal(mesh.opaque.index.length, 36);
  assert.equal(mesh.cutout.index.length, 30);
  assert.equal(mesh.water.index.length, 0);
  for (const kind of ['opaque', 'cutout']) {
    const m = mesh[kind];
    assert.equal(m.sky.length, m.position.length / 3);
    assert.equal(m.flow.length, (m.position.length / 3) * 2);
  }
});
test('spawn neighborhood has broad elevation range and multiple genuinely different biomes', () => {
  let min = 128,
    max = 0;
  const biomes = new Set();
  for (let z = -160; z < 96; z += 8)
    for (let x = -64; x < 192; x += 8) {
      const c = column(x, z);
      min = Math.min(min, c.height);
      max = Math.max(max, c.height);
      biomes.add(c.biome);
    }
  assert.ok(max - min > 60);
  for (const b of ['mountains', 'forest', 'desert', 'ocean', 'taiga']) assert.ok(biomes.has(b));
});
