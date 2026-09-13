import test from 'node:test';
import assert from 'node:assert/strict';
import { B, isWater, waterLevel, waterHeight, flowingWater, solid } from '../dist/src/blocks.js';
import { Fluids } from '../dist/src/fluids.js';
import { waterCorner } from '../dist/src/water-mesh.js';
function fixture(base = (x, y, z) => (y <= 0 ? B.STONE : B.AIR)) {
  const cells = new Map(),
    key = (x, y, z) => `${x},${y},${z}`;
  const w = {
    dimension: 'overworld',
    loaded: () => true,
    get: (x, y, z) =>
      cells.get(key(Math.floor(x), Math.floor(y), Math.floor(z))) ??
      base(Math.floor(x), Math.floor(y), Math.floor(z)),
    set(x, y, z, b, record = true) {
      const old = this.get(x, y, z);
      if (old === b) return false;
      cells.set(key(x, y, z), b);
      this.onEdit?.(x, y, z, b, old, record);
      return true;
    },
  };
  const f = new Fluids(w);
  const advance = (n = 45) => {
    for (let i = 0; i < n; i++) f.tick(0.25);
  };
  return { w, f, cells, advance };
}
test('natural lake refills a mined block and falls into an excavated floor', () => {
  const { w, advance } = fixture((x, y, z) =>
    y <= 0 ? B.STONE : y === 1 && Math.abs(x) < 4 && Math.abs(z) < 4 ? B.WATER : B.AIR,
  );
  w.set(0, 1, 0, B.AIR);
  advance(4);
  assert.equal(w.get(0, 1, 0), B.WATER);
  // A raised lake with two layers of support; break support to open a real cavity.
  const a = fixture((x, y, z) =>
    y === 4 && Math.abs(x) < 3 && Math.abs(z) < 3 ? B.WATER : y === 3 || y <= 0 ? B.STONE : B.AIR,
  );
  a.w.set(0, 3, 0, B.AIR);
  a.advance();
  assert.equal(a.w.get(0, 3, 0), B.WATER_FALLING);
  assert.ok(isWater(a.w.get(0, 1, 0)));
});
test('seven declining horizontal levels, eighth block dry, source removal drains', () => {
  const { w, advance, cells } = fixture();
  w.set(0, 1, 0, B.WATER);
  advance();
  for (let x = 1; x <= 7; x++) assert.equal(waterLevel(w.get(x, 1, 0)), x, `distance ${x}`);
  assert.equal(w.get(8, 1, 0), B.AIR);
  w.set(0, 1, 0, B.AIR);
  advance(70);
  assert.equal([...cells.values()].filter(isWater).length, 0);
});
test('falling column has downward priority and restarts seven-block reach at bottom', () => {
  const { w, advance } = fixture();
  w.set(0, 8, 0, B.WATER);
  advance(60);
  assert.equal(w.get(1, 8, 0), B.AIR);
  assert.equal(w.get(0, 4, 0), B.WATER_FALLING);
  assert.equal(waterLevel(w.get(7, 1, 0)), 7);
  assert.equal(w.get(8, 1, 0), B.AIR);
});
test('two diagonal sources form a renewable 2x2 pool only with support', () => {
  const a = fixture();
  a.w.set(0, 1, 0, B.WATER);
  a.w.set(1, 1, 1, B.WATER);
  a.advance();
  assert.equal(a.w.get(1, 1, 0), B.WATER);
  assert.equal(a.w.get(0, 1, 1), B.WATER);
  a.w.set(0, 1, 0, B.AIR);
  a.advance();
  assert.equal(a.w.get(0, 1, 0), B.WATER);
  const b = fixture();
  b.w.set(0, 5, 0, B.WATER);
  b.w.set(1, 5, 1, B.WATER);
  b.advance();
  assert.notEqual(b.w.get(1, 5, 0), B.WATER);
});
test('water chooses a nearby downward route over an equally open flat side', () => {
  const { w, f } = fixture((x, y, z) => (y === 0 || y === 1 ? B.STONE : B.AIR));
  w.set(2, 1, 0, B.AIR);
  w.set(0, 2, 0, B.WATER);
  assert.deepEqual(f.outlets(0, 2, 0), [[1, 0]]);
});
test('breaking a dam activates neighboring natural source water', () => {
  const a = fixture((x, y, z) =>
    y <= 0
      ? B.STONE
      : y === 1 && x === 0
        ? B.STONE
        : y === 1 && x < 0 && x > -4 && Math.abs(z) < 3
          ? B.WATER
          : B.AIR,
  );
  a.w.set(0, 1, 0, B.AIR);
  a.advance();
  assert.ok(isWater(a.w.get(1, 1, 0)));
});
test('large flows defer work rather than permanently truncating the frontier', () => {
  const a = fixture();
  a.f.budget = 3;
  a.w.set(0, 1, 0, B.WATER);
  a.advance(900);
  assert.equal(waterLevel(a.w.get(7, 1, 0)), 7);
  assert.equal(a.f.pending.size + a.f.urgent.size, 0);
});
test('unloaded boundary is closed; waking it after loading resumes flow', () => {
  const a = fixture();
  let loaded = false;
  a.w.loaded = (x) => x < 16 || loaded;
  a.w.set(15, 1, 0, B.WATER);
  a.advance();
  assert.equal(a.w.get(16, 1, 0), 0);
  loaded = true;
  a.f.wake(16, 1, 0);
  a.advance();
  assert.ok(isWater(a.w.get(17, 1, 0)));
});
test('water depth affects immersion, and flowing states do not become solid', () => {
  const a = fixture();
  a.w.set(0, 1, 0, flowingWater(7));
  assert.equal(a.f.contains(0.5, 1.5, 0.5), false);
  assert.equal(a.f.contains(0.5, 1.05, 0.5), true);
  assert.equal(solid(flowingWater(7)), false);
});
test('corner heights agree across shared edge and fall with level', () => {
  const get = (x, y, z) => (y === 1 && z === 0 && x >= 0 && x <= 7 ? flowingWater(x) : B.AIR);
  assert.equal(waterCorner(get, 0, 1, 0, 1, 0), waterCorner(get, 1, 1, 0, 0, 0));
  assert.ok(waterCorner(get, 0, 1, 0, 0, 0) > waterCorner(get, 6, 1, 0, 1, 0));
});
test('water evaporates in Nether; contact with source lava makes obsidian', () => {
  const a = fixture();
  a.w.dimension = 'nether';
  a.w.set(0, 1, 0, B.WATER);
  a.advance(2);
  assert.equal(a.w.get(0, 1, 0), 0);
  const b = fixture();
  b.w.set(1, 1, 0, B.LAVA);
  b.w.set(0, 1, 0, B.WATER);
  b.advance(3);
  assert.equal(b.w.get(1, 1, 0), B.OBSIDIAN);
});
