import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three/three.module.js';
import { B, solid } from '../dist/src/blocks.js';
import { Player } from '../dist/src/physics.js';
import { TNT } from '../dist/src/tnt.js';
import { blastCells, tntPattern } from '../dist/src/blast.js';
import { fillNearWater } from '../dist/src/water-view.js';
import { waterCorner } from '../dist/src/water-mesh.js';
import { propagateLight } from '../dist/src/block-light.js';
function world() {
  const cells = new Map();
  return {
    cells,
    epoch: 0,
    onEdit() {},
    onChunkLoaded() {},
    loaded: () => true,
    get(x, y, z) {
      x = Math.floor(x);
      y = Math.floor(y);
      z = Math.floor(z);
      return cells.get(`${x},${y},${z}`) ?? (y <= 0 ? B.BEDROCK : B.AIR);
    },
    set(x, y, z, b) {
      const old = this.get(x, y, z);
      if (old === b) return false;
      cells.set(`${x},${y},${z}`, b);
      this.onEdit(x, y, z, b, old, true);
      return true;
    },
    collides(x, y, z) {
      return solid(this.get(x, y, z));
    },
  };
}
function rig() {
  const w = world(),
    player = new Player();
  player.teleport(15, 2, 0);
  const renderer = {
    scene: new THREE.Scene(),
    uniforms: { uAtlas: { value: new THREE.Texture() } },
    lightMaterial: (m) => m,
  };
  return { w, player, tnt: new TNT(renderer, w, player, { pool: [] }, () => {}) };
}
test('creative accelerates, brakes, and diagonal ascent does not gain speed', () => {
  const w = world(),
    a = new Player(),
    b = new Player();
  for (const p of [a, b]) {
    p.teleport(0, 20, 0);
    p.yaw = 0;
    p.setMode('creative');
  }
  a.tick(w, new Set(['KeyW']), 1 / 60);
  assert.ok(-a.velocity.z > 0 && -a.velocity.z < 2);
  for (let i = 0; i < 120; i++) {
    a.tick(w, new Set(['KeyW']), 1 / 60);
    b.tick(w, new Set(['KeyW', 'KeyD', 'Space']), 1 / 60);
  }
  assert.ok(
    Math.abs(Math.hypot(...Object.values(a.velocity)) - Math.hypot(...Object.values(b.velocity))) <
      0.01,
  );
  const old = a.velocity.z;
  a.tick(w, new Set(), 1 / 60);
  assert.ok(a.velocity.z > old && a.velocity.z < 0);
  for (let i = 0; i < 120; i++) a.tick(w, new Set(), 1 / 60);
  assert.deepEqual(a.velocity, { x: 0, y: 0, z: 0 });
});
test('TNT is a solid labelled block, remains unlit until primed, then has a real fuse', () => {
  const { w, tnt } = rig();
  w.set(0, 1, 0, B.TNT);
  w.set(1, 1, 0, B.DIRT);
  for (let i = 0; i < 60; i++) tnt.tick(1 / 60);
  assert.equal(w.get(0, 1, 0), B.TNT);
  assert.equal(tnt.queue.length, 0);
  assert.equal(tnt.prime(0, 1, 0, 1), true);
  assert.equal(w.get(1, 1, 0), B.DIRT);
  assert.ok(tnt.pool[0].active);
  for (let i = 0; i < 30; i++) tnt.tick(1 / 60);
  tnt.draw(0.5);
  assert.equal(tnt.mesh.count, 1);
  assert.equal(tnt.queue.length, 0);
  for (let i = 0; i < 31; i++) tnt.tick(1 / 60);
  assert.equal(tnt.queue.length, 1);
  tnt.flush();
  assert.equal(w.get(1, 1, 0), B.AIR);
  assert.ok(tnt.particles.some((p) => p.life > 0));
  assert.equal(solid(B.TNT), true);
});
test('explosion ignites adjacent TNT with a short fuse; defuse and dimension resets cancel it', () => {
  const { w, tnt } = rig();
  w.set(1, 1, 0, B.TNT);
  tnt.queue.push({ position: { x: 0.5, y: 1.5, z: 0.5 }, power: 4, chain: true, damage: false });
  tnt.flush();
  assert.equal(w.get(1, 1, 0), B.AIR);
  const primed = tnt.pool.find((b) => b.active);
  assert.ok(primed && primed.fuse >= 0.3 && primed.fuse <= 1.1);
  tnt.defuse();
  assert.equal(
    tnt.pool.some((b) => b.active),
    false,
  );
  w.set(2, 1, 0, B.TNT);
  tnt.prime(2, 1, 0);
  w.epoch++;
  tnt.tick(1 / 60);
  assert.equal(
    tnt.pool.some((b) => b.active),
    false,
  );
  assert.equal(tnt.blocks.size, 0);
});
test('blast resistance preserves bedrock/obsidian and water suppresses terrain damage', () => {
  const w = world();
  for (let x = -3; x < 4; x++) for (let z = -3; z < 4; z++) w.set(x, 1, z, B.DIRT);
  w.set(1, 1, 0, B.OBSIDIAN);
  let cells = blastCells(w, { x: 0.5, y: 2.1, z: 0.5 }, 4, () => 0.5);
  assert.ok(cells.some((c) => c.b === B.DIRT));
  assert.equal(
    cells.some((c) => c.b === B.OBSIDIAN || c.b === B.BEDROCK),
    false,
  );
  w.set(0, 2, 0, B.WATER);
  assert.deepEqual(blastCells(w, { x: 0.5, y: 2.1, z: 0.5 }, 8), []);
});
test('TNT patterns are bounded, honor spacing, and avoid actor collision', () => {
  for (const kind of ['line', 'ring', 'cube', 'stack']) {
    const p = tntPattern({ x: 0, y: 1, z: 0 }, kind, 200, 2);
    assert.equal(p.length, 64);
    assert.equal(new Set(p.map((p) => JSON.stringify(p))).size, 64);
  }
  assert.equal(tntPattern({ x: 0, y: 1, z: 0 }, 'stack', 3, 3)[2].y, 7);
  const { w, tnt, player } = rig();
  player.teleport(0.5, 1, 0.5);
  tnt.spawnPattern({ x: 0, y: 1, z: 0 }, 'stack', 3, 1);
  assert.equal(w.get(0, 1, 0), B.AIR);
  assert.equal(w.get(0, 2, 0), B.AIR);
  assert.equal(w.get(0, 3, 0), B.TNT);
});
test('near-plane water mask samples sloping corners and distinguishes air, surface and deep water', () => {
  const w = world(),
    data = new Uint8Array(4 ** 3 * 4),
    origin = { x: -1, y: 0, z: -1 };
  w.set(0, 1, 0, B.WATER);
  w.set(1, 1, 0, B.WATER_FLOW_7);
  fillNearWater(data, w.get.bind(w), origin);
  const offset = (1 + 4 * (1 + 4 * 1)) * 4;
  assert.equal(data[offset], Math.round(waterCorner(w.get.bind(w), 0, 1, 0, 0, 0) * 255));
  assert.ok(data[offset] > 0 && data[offset] < 255);
  assert.ok(0.5 < data[offset] / 255 && 0.99 > data[offset] / 255); // Lower near-plane pixels submerged; upper pixels remain dry.
  assert.equal(data[(1 + 4 * (2 + 4 * 1)) * 4], 0);
  w.set(0, 2, 0, B.WATER);
  fillNearWater(data, w.get.bind(w), origin);
  assert.equal(data[offset], 255);
});
test('lighting volume carries water depth independently of RGB illumination', () => {
  const n = 4,
    a = new Uint8Array(n ** 3);
  a[1 + n * (1 + n)] = B.WATER;
  a[1 + n * (2 + n)] = B.WATER;
  a[2 + n * (1 + n)] = B.TORCH;
  const out = propagateLight(a, n);
  assert.equal(out[(1 + n * (1 + n)) * 4 + 3], 255);
  assert.equal(out[(1 + n * (2 + n)) * 4 + 3], 227);
  assert.equal(out[(2 + n * (1 + n)) * 4 + 3], 0);
  assert.ok(out[(2 + n * (1 + n)) * 4] > 0);
});

test('blast light decays and pooled debris interpolates without streaks on reuse', () => {
  const { w, tnt } = rig();
  tnt.renderer.uniforms.uBlastLights = {
    value: Array.from({ length: 4 }, () => new THREE.Vector4()),
  };
  tnt.queue.push({ position: { x: 0, y: 5, z: 0 }, power: 4, chain: false, damage: false });
  tnt.flush();
  tnt.draw(1);
  assert.ok(tnt.renderer.uniforms.uBlastLights.value.some((v) => v.w > 0));
  const p = tnt.particles[0],
    x = p.x,
    y = p.y,
    z = p.z;
  tnt.tick(1 / 60);
  tnt.draw(0);
  const matrix = new THREE.Matrix4();
  tnt.particleMesh.getMatrixAt(0, matrix);
  assert.ok(Math.abs(matrix.elements[12] - x) < 1e-5);
  assert.ok(Math.abs(matrix.elements[13] - y) < 1e-5);
  assert.ok(Math.abs(matrix.elements[14] - z) < 1e-5);
  tnt.particleCursor = 0;
  tnt.particle(90, 20, -30, true, '#ffffff', 0.2);
  tnt.draw(0);
  tnt.particleMesh.getMatrixAt(0, matrix);
  assert.deepEqual(matrix.elements.slice(12, 15), [90, 20, -30]);
  for (let i = 0; i < 30; i++) tnt.tick(1 / 60);
  tnt.draw(1);
  assert.ok(tnt.renderer.uniforms.uBlastLights.value.every((v) => v.w === 0));
});

test('waterline follows triangle slopes and displaced corners, rather than a curved bilinear patch', async () => {
  const { triangleWaterHeight, waterWave } = await import('../dist/src/water-mesh.js');
  const h = [0.8, 0.9, 0.9, 0.1];
  assert.ok(Math.abs(triangleWaterHeight(h, 0.5, 0.5) - 0.45) < 1e-9);
  assert.ok(Math.abs(triangleWaterHeight(h, 0.5, 0.5) - h.reduce((a, b) => a + b) / 4) > 0.2);
  const w = world();
  w.set(1, 1, 1, B.WATER);
  const data = new Uint8Array(4 ** 3 * 4),
    time = 2.3;
  fillNearWater(data, w.get.bind(w), { x: 0, y: 0, z: 0 }, time);
  const offset = (1 + 4 * (1 + 4)) * 4;
  const expected = waterCorner(w.get.bind(w), 1, 1, 1, 0, 0) + waterWave(1, 1, time);
  assert.ok(Math.abs(data[offset] / 255 - expected) <= 1 / 255);
});
