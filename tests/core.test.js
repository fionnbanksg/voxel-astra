import test from 'node:test';
import assert from 'node:assert/strict';
import { B, C, H, idx, solid, isWater } from '../dist/src/blocks.js';
import { generateChunk, column } from '../dist/src/terrain.js';
import { noise } from '../dist/src/noise.js';
import { cornerAO, meshSection } from '../dist/src/mesh.js';
import { raycast } from '../dist/src/raycast.js';
import { moveBody, intersects, overlapsBlock } from '../dist/src/physics.js';
import { Fluids } from '../dist/src/fluids.js';
import { rayBox } from '../dist/src/combat.js';
import { validFrame, FRAME_W, FRAME_H } from '../dist/src/portals.js';

const worldOf = (get) => ({ get, loaded: () => true, collides: (x, y, z) => solid(get(x, y, z)) });
test('deterministic terrain, world limits, caves and dimension separation', () => {
  const a = generateChunk(0, 0, 'overworld', 73191),
    b = generateChunk(0, 0, 'overworld', 73191),
    n = generateChunk(0, 0, 'nether', 73191);
  assert.deepEqual(a.data, b.data);
  assert.equal(a.data.length, C * C * H);
  assert.notDeepEqual(a.data, n.data);
  for (let z = 0; z < C; z++)
    for (let x = 0; x < C; x++) assert.equal(a.data[idx(x, 0, z)], B.BEDROCK);
  assert.ok(n.data.includes(B.NETHERRACK));
  assert.ok(n.data[idx(1, H - 1, 1)] !== B.AIR);
  assert.notEqual(noise(0.1, 0.2, 0.3, 1), noise(0.1, 0.2, 0.3, 2));
});
test('climate tint and heights stay continuous across adjacent columns', () => {
  for (let x = -300; x < 300; x++) {
    const a = column(x, 43),
      b = column(x + 1, 43);
    assert.ok(Math.abs(a.height - b.height) <= 10);
    assert.ok(Math.abs(a.color[0] - b.color[0]) < 0.04);
  }
});
test('culled meshing removes the shared face and orients triangles outward', () => {
  const mesh = meshSection(
    (x, y, z) => (y === 2 && z === 2 && (x === 2 || x === 3) ? B.STONE : B.AIR),
    0,
    [],
  ).opaque;
  assert.equal(mesh.index.length, 10 * 6);
  for (let k = 0; k < mesh.index.length; k += 3) {
    const v = [0, 1, 2].map((j) =>
        Array.from(mesh.position.slice(mesh.index[k + j] * 3, mesh.index[k + j] * 3 + 3)),
      ),
      u = v[1].map((x, i) => x - v[0][i]),
      w = v[2].map((x, i) => x - v[0][i]),
      cross = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]],
      ni = mesh.index[k] * 3;
    assert.ok(cross.reduce((s, x, i) => s + x * mesh.normal[ni + i], 0) > 0);
  }
});
test('AO handles both side blockers and a diagonal blocker', () => {
  assert.equal(cornerAO(false, false, false), 3);
  assert.equal(cornerAO(true, true, false), 0);
  assert.equal(cornerAO(false, false, true), 2);
});
test('opaque and water surfaces use separate geometry', () => {
  const m = meshSection(
    (x, y, z) =>
      x === 1 && z === 1 && y === 1 ? B.WATER : x === 3 && z === 3 && y === 1 ? B.STONE : 0,
    0,
    [],
  );
  assert.equal(m.water.index.length, 36);
  assert.equal(m.opaque.index.length, 36);
});
test('DDA handles negative coordinates, parallel axes, reach and exact ties', () => {
  let hit = raycast(
    (x, y, z) => (x === -3 ? B.STONE : 0),
    { x: 0.5, y: 2, z: 1 },
    { x: -1, y: 0, z: 0 },
    7,
  );
  assert.equal(hit.x, -3);
  assert.equal(hit.distance, 2.5);
  assert.equal(hit.normal.x, 1);
  assert.equal(
    raycast((x) => (x === 20 ? 3 : 0), { x: 0.5, y: 1, z: 1 }, { x: 1, y: 0, z: 0 }, 7),
    null,
  );
  hit = raycast(
    (x, y) => (x === 1 && y === 1 ? 3 : 0),
    { x: 0.5, y: 0.5, z: 0 },
    { x: Math.SQRT1_2, y: Math.SQRT1_2, z: 0 },
    7,
  );
  assert.equal(hit.x, 1);
  assert.equal(hit.y, 1);
});
test('collision prevents falling and high-speed wall tunneling', () => {
  const world = worldOf((x, y, z) => (y < 0 || x === 2 ? B.STONE : 0));
  const b = {
    position: { x: 0, y: 2, z: 0 },
    velocity: { x: 200, y: -100, z: 0 },
    width: 0.6,
    height: 1.8,
    grounded: false,
  };
  moveBody(b, world, 0.1, false);
  assert.ok(b.position.x < 1.71);
  assert.ok(b.position.y >= 0);
  assert.ok(!intersects(world, b.position));
  assert.ok(b.grounded);
  assert.ok(overlapsBlock({ x: 0.5, y: 1, z: 0.5 }, 0, 1, 0));
});
test('one-block step-up succeeds with headroom and fails under low ceiling', () => {
  for (const ceiling of [false, true]) {
    const w = worldOf((x, y) =>
      y < 0 || (x === 1 && y === 0) || (ceiling && y === 2) ? B.STONE : 0,
    );
    const b = {
      position: { x: 0.6, y: 0, z: 0.5 },
      velocity: { x: 4, y: 0, z: 0 },
      width: 0.6,
      height: 1.8,
      grounded: true,
    };
    moveBody(b, w, 0.15);
    assert.equal(b.position.y > 1, !ceiling);
  }
});
test('source water spreads, respects walls, and drains after source removal', () => {
  const cells = new Map(),
    k = (x, y, z) => `${x},${y},${z}`,
    w = {
      dimension: 'overworld',
      loaded: () => true,
      get: (x, y, z) => (y === 0 ? B.STONE : cells.get(k(x, y, z)) || 0),
      set(x, y, z, b, record = true) {
        const prev = this.get(x, y, z);
        cells.set(k(x, y, z), b);
        this.onEdit?.(x, y, z, b, prev, record);
        return true;
      },
    };
  const f = new Fluids(w);
  w.set(0, 1, 0, B.WATER);
  w.set(1, 1, 0, B.STONE);
  for (let n = 0; n < 20; n++) f.tick(0.25);
  assert.ok(isWater(w.get(-1, 1, 0)));
  assert.equal(w.get(1, 1, 0), B.STONE);
  assert.equal(w.get(-8, 1, 0), B.AIR);
  w.set(0, 1, 0, B.AIR);
  for (let n = 0; n < 30; n++) f.tick(0.25);
  assert.equal(w.get(-1, 1, 0), B.AIR);
});
test('ray/AABB combat rejects parallel misses and detects hits', () => {
  const min = { x: 1, y: 0, z: 0 },
    max = { x: 2, y: 2, z: 1 };
  assert.equal(rayBox({ x: 0, y: 1, z: 0.5 }, { x: 1, y: 0, z: 0 }, min, max), 1);
  assert.equal(rayBox({ x: 0, y: 3, z: 0.5 }, { x: 1, y: 0, z: 0 }, min, max), Infinity);
});
test('portal frames require all borders and a clear opening on either axis', () => {
  for (const axis of ['x', 'z']) {
    const get = (x, y, z) => {
      const u = axis === 'x' ? x : z;
      if (u < 0 || u >= FRAME_W || y < 0 || y >= FRAME_H) return 0;
      return u === 0 || u === FRAME_W - 1 || y === 0 || y === FRAME_H - 1 ? B.OBSIDIAN : B.AIR;
    };
    assert.ok(validFrame(get, 0, 0, 0, axis));
    assert.ok(!validFrame((x, y, z) => (y === FRAME_H - 1 ? B.AIR : get(x, y, z)), 0, 0, 0, axis));
  }
});
