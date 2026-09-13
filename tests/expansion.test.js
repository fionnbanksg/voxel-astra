import test from 'node:test';
import assert from 'node:assert/strict';
import { B, isLava, lavaLevel, solid, isWater } from '../dist/src/blocks.js';
import { Player } from '../dist/src/physics.js';
import { Fluids } from '../dist/src/fluids.js';
import { Lava } from '../dist/src/lava.js';
import { PRESETS, normalizeOptions, seedNumber } from '../dist/src/world-options.js';
import { column, generateChunk } from '../dist/src/terrain.js';
import { snowAmount, canSnowOn, Weather } from '../dist/src/weather.js';
import { characterParts, MAX_CHARACTER_PARTS } from '../dist/src/character-models.js';
import { meshSection } from '../dist/src/mesh.js';
function liquids(dimension = 'overworld') {
  const cells = new Map(),
    key = (x, y, z) => `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
  const w = {
    dimension,
    loaded: () => true,
    get: (x, y, z) => cells.get(key(x, y, z)) ?? (y <= 0 ? B.STONE : B.AIR),
    set(x, y, z, b, record = true) {
      const prev = this.get(x, y, z);
      if (prev === b) return false;
      cells.set(key(x, y, z), b);
      this.onEdit?.(x, y, z, b, prev, record);
      return true;
    },
  };
  const water = new Fluids(w),
    lava = new Lava(w);
  const advance = (n = 80) => {
    for (let i = 0; i < n; i++) {
      water.tick(0.25);
      lava.tick(0.25);
    }
  };
  return { w, water, lava, cells, advance };
}
test('generation settings and text seeds are deterministic, bounded and varied', () => {
  assert.equal(seedNumber('snow day'), seedNumber('snow day'));
  assert.notEqual(seedNumber('snow day'), seedNumber('lava day'));
  assert.equal(seedNumber('4294967297'), 1);
  const bad = normalizeOptions({ preset: 'unknown', relief: 100, seaLevel: -5, trees: 90 });
  assert.equal(bad.preset, 'wilds');
  assert.equal(bad.relief, 1.6);
  assert.equal(bad.seaLevel, 12);
  assert.equal(bad.trees, 2);
  const fingerprints = new Set();
  for (const preset of Object.keys(PRESETS)) {
    const opt = normalizeOptions({ preset }),
      a = generateChunk(0, 0, 'overworld', 123, opt),
      b = generateChunk(0, 0, 'overworld', 123, opt);
    assert.deepEqual(a.data, b.data);
    fingerprints.add(Array.from(a.columns, (c) => c.height + ':' + c.biome).join(','));
  }
  assert.equal(fingerprints.size, 6);
  const flat = generateChunk(0, 0, 'overworld', 123, { preset: 'flat' });
  assert.equal(new Set(flat.columns.map((c) => c.height)).size, 1);
  assert.ok(!flat.data.includes(B.WOOD));
  const alpine = generateChunk(4, -2, 'overworld', 123, { preset: 'alpine' });
  assert.ok(alpine.data.includes(B.SNOW));
  assert.ok(alpine.columns.every((c) => c.frozen));
  assert.equal(column(80, 60, 'overworld', 123, { preset: 'flat', seaLevel: 50 }).height, 54);
});
test('creative flies, hovers, remains collidable, rejects damage and returns to gravity', () => {
  const w = { get: () => B.AIR, collides: (x, y, z) => x >= 3 || y < 0 };
  const p = new Player();
  p.teleport(1, 10, 0);
  p.yaw = 0;
  p.setMode('creative');
  for (let i = 0; i < 60; i++) p.tick(w, new Set(['Space']), 1 / 60);
  assert.ok(p.position.y > 20);
  const y = p.position.y;
  p.tick(w, new Set(), 1 / 60);
  assert.ok(p.position.y > y);
  assert.ok(p.velocity.y > 0 && p.velocity.y < 12);
  for (let i = 0; i < 120; i++) p.tick(w, new Set(), 1 / 60);
  assert.equal(p.velocity.y, 0);
  for (let i = 0; i < 60; i++) p.tick(w, new Set(['KeyD', 'ShiftLeft']), 1 / 60);
  assert.ok(p.position.x < 2.71);
  p.damage(100);
  assert.equal(p.health, 20);
  const hoverY = p.position.y;
  p.setMode('survival');
  assert.equal(p.flying, false);
  p.tick(w, new Set(), 1 / 60);
  assert.ok(p.position.y < hoverY);
  p.damage(3);
  assert.equal(p.health, 17);
});
test('lava is slow, reaches three cells, falls and drains after source removal', () => {
  const a = liquids();
  assert.equal(a.w.fluids, a.water);
  a.w.set(0, 1, 0, B.LAVA);
  a.advance(5);
  assert.equal(a.w.get(1, 1, 0), B.AIR);
  a.advance(90);
  for (let x = 1; x <= 3; x++) assert.equal(lavaLevel(a.w.get(x, 1, 0)), x);
  assert.equal(a.w.get(4, 1, 0), B.AIR);
  a.w.set(0, 1, 0, B.AIR);
  a.advance(150);
  assert.equal([...a.cells.values()].filter(isLava).length, 0);
  const fall = liquids();
  fall.w.set(0, 5, 0, B.LAVA);
  fall.advance(130);
  assert.equal(fall.w.get(0, 3, 0), B.LAVA_FALLING);
  assert.equal(fall.w.get(1, 5, 0), B.AIR);
  assert.ok(isLava(fall.w.get(3, 1, 0)));
});
test('Nether lava flows seven cells; water and lava reactions preserve material types', () => {
  const n = liquids('nether');
  n.w.set(0, 1, 0, B.LAVA);
  n.advance(100);
  assert.equal(lavaLevel(n.w.get(7, 1, 0)), 7);
  assert.equal(n.w.get(8, 1, 0), B.AIR);
  const a = liquids();
  a.w.set(0, 1, 0, B.LAVA);
  a.w.set(1, 1, 0, B.WATER);
  a.advance(3);
  assert.equal(a.w.get(0, 1, 0), B.OBSIDIAN);
  const b = liquids();
  b.w.set(0, 1, 0, B.LAVA_FLOW_1);
  b.w.set(1, 1, 0, B.WATER);
  b.advance(3);
  assert.equal(b.w.get(0, 1, 0), B.STONE);
  const c = liquids();
  c.w.set(0, 2, 0, B.LAVA);
  c.w.set(0, 1, 0, B.WATER);
  assert.equal(c.lava.derive(0, 1, 0), B.STONE);
});
test('snow is a thin replaceable layer, weather respects dimensions and roofs invalidate', () => {
  assert.equal(snowAmount('auto', { frozen: false }, 'overworld'), 0);
  assert.ok(snowAmount('auto', { frozen: true }, 'overworld') > 0);
  assert.equal(snowAmount('storm', {}, 'nether'), 0);
  assert.equal(snowAmount('clear', { frozen: true }, 'overworld'), 0);
  assert.ok(canSnowOn(B.GRASS));
  assert.ok(canSnowOn(B.LEAVES));
  assert.equal(canSnowOn(B.LAVA), false);
  assert.equal(canSnowOn(B.SNOW), false);
  assert.equal(solid(B.SNOW_LAYER), false);
  const mesh = meshSection(
    (x, y, z) => (x === 0 && y === 1 && z === 0 ? B.SNOW_LAYER : B.AIR),
    0,
    [],
  );
  const ys = Array.from(mesh.opaque.position).filter((_, i) => i % 3 === 1);
  assert.equal(Math.max(...ys), 1.125);
  const a = liquids();
  a.w.set(1, 1, 0, B.SNOW_LAYER);
  a.w.set(0, 1, 0, B.WATER);
  a.advance();
  assert.ok(isWater(a.w.get(1, 1, 0)));
  assert.equal(a.w.get(10, 1, 0), B.AIR);
  const chunk = { data: true, revision: 0 };
  let roof = 4;
  const fake = {
    world: { chunks: new Map([['0,0', chunk]]), get: (x, y, z) => (y === roof ? B.PLANKS : B.AIR) },
    cache: new Map(),
  };
  assert.equal(Weather.prototype.roof.call(fake, 1, 1), 4);
  roof = 9;
  chunk.revision++;
  assert.equal(Weather.prototype.roof.call(fake, 1, 1), 9);
});
test('detailed character models fit the pooled instance budget and have faces and joints', () => {
  for (const kind of ['sheep', 'companion', 'rival', 'ember']) {
    const p = characterParts(kind, 2);
    assert.ok(p.length > 18);
    assert.ok(p.length <= MAX_CHARACTER_PARTS, kind);
    assert.ok(p.some((a) => a[7] === 'eye'));
    assert.ok(p.some((a) => a[7] === 'legL'));
    for (const part of p) assert.ok(part.slice(0, 6).every(Number.isFinite));
  }
});
