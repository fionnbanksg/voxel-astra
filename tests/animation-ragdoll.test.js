import test from 'node:test';
import assert from 'node:assert/strict';
import { THREE } from '../dist/src/renderer.js';
import { Ragdolls, RAGDOLL_LIMIT } from '../dist/src/ragdolls.js';
import { FirstPersonHand, itemGeometry } from '../dist/src/held-items.js';
import { startAction, actionPulse, limbAngle } from '../dist/src/character-motion.js';
import { Player } from '../dist/src/physics.js';
import { validRagdolls } from '../dist/src/network/protocol.js';
import { World } from '../dist/src/world.js';
import { Chunk } from '../dist/src/chunk.js';
import { B, C, H, S, idx } from '../dist/src/blocks.js';
const renderer = () => ({
  scene: new THREE.Scene(),
  camera: new THREE.PerspectiveCamera(73, 16 / 9, 0.08, 300),
  uniforms: { uAtlas: { value: new THREE.Texture() } },
  lightMaterial: (m) => m,
});

test('ragdolls fall, keep limbs attached, collide with floor/walls and expire within their pool', () => {
  const world = { epoch: 0, collides: (x, y, z) => y < 1 || x >= 3 },
    r = new Ragdolls(renderer(), world);
  const body = r.spawn(
    {
      kind: 'player',
      id: 0,
      position: { x: 0, y: 1, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      yaw: 0,
    },
    'player:test:0',
    2,
    0,
  );
  for (let i = 0; i < 360; i++) r.update(1 / 120, true);
  assert.ok(body.points[7] < 1.45, 'head lies near the ground');
  for (let i = 0; i < 11; i++) {
    assert.ok(body.points[i * 3] < 3);
    assert.ok(body.points[i * 3 + 1] >= 1.08);
  }
  for (const [a, b, length] of body.constraints) {
    const d = Math.hypot(...[0, 1, 2].map((i) => body.points[a * 3 + i] - body.points[b * 3 + i]));
    assert.ok(Math.abs(d - length) < 0.06);
  }
  r.draw();
  assert.equal(r.mesh.count, body.parts.length);
  assert.ok([...r.mesh.instanceMatrix.array.slice(0, r.mesh.count * 16)].every(Number.isFinite));
  for (let i = 0; i < 16; i++)
    r.spawn(
      { kind: 'sheep', id: i, position: { x: 0, y: 1, z: 0 }, velocity: { x: 0, y: 0, z: 0 } },
      'mob:' + i,
    );
  assert.equal(r.pool.filter((r) => r.active).length, RAGDOLL_LIMIT);
  for (const b of r.pool) b.age = 8.99;
  r.update(0.02, true);
  assert.equal(
    r.pool.some((r) => r.active),
    false,
  );
});

test('ragdoll snapshots interpolate without guest physics and can resume safely in solo', () => {
  const world = { epoch: 0, collides: (x, y, z) => y < 0 },
    host = new Ragdolls(renderer(), world),
    guest = new Ragdolls(renderer(), world);
  host.spawn(
    { kind: 'companion', id: 1, position: { x: 0, y: 2, z: 0 }, velocity: { x: 0, y: 0, z: 0 } },
    'dog',
  );
  host.update(0.1, true);
  const packet = host.snapshot();
  assert.equal(validRagdolls(packet), true);
  guest.receive(packet);
  const p = guest.pool.find((r) => r.active),
    before = [...p.points];
  guest.update(0.1, false);
  assert.deepEqual([...p.points], before);
  host.update(0.1, true);
  guest.receive(host.snapshot());
  guest.draw(true);
  const saved = [...p.points];
  guest.update(1 / 120, true);
  assert.ok(
    Math.max(...p.points.map((v, i) => Math.abs(v - saved[i]))) < 0.2,
    '10Hz snapshots must not become 120Hz velocities',
  );
  assert.equal(validRagdolls([{ ...packet[0], points: [Infinity] }]), false);
  world.epoch++;
  guest.update(0.01, false);
  assert.equal(
    guest.pool.some((r) => r.active),
    false,
  );
});

test('held block atlas faces, hand sway and action poses stay inside the first-person view', () => {
  const g = itemGeometry(B.TNT),
    uv = g.attributes.uv;
  const tile = (i) => Math.floor(uv.getX(i) * 8) + 8 * Math.floor((1 - uv.getY(i)) * 4);
  assert.equal(tile(0), B.TNT);
  assert.equal(tile(8), 23);
  const render = renderer(),
    hand = new FirstPersonHand(render),
    p = new Player();
  p.yaw = 0;
  p.pitch = 0;
  render.camera.position.set(0, 2, 0);
  render.camera.updateMatrixWorld();
  hand.update(1 / 60, 0, p, B.TNT, true);
  hand.root.updateMatrixWorld(true);
  const center = hand.item.getWorldPosition(new THREE.Vector3()).project(render.camera);
  assert.ok(Math.abs(center.x) < 1 && Math.abs(center.y) < 1 && center.z < 1 && center.z > -1);
  const rest = hand.rig.position.clone();
  startAction(p, 'attack');
  p.actionAt -= 0.12;
  assert.ok(actionPulse(p) > 0.8);
  hand.update(1 / 60, 0, p, B.TNT, true);
  assert.ok(hand.rig.position.distanceTo(rest) > 0.1);
  assert.ok(limbAngle({ ...p, kind: 'player' }, 'armR', 0) < -1);
  const first = p.actionSeq;
  startAction(p, 'place');
  assert.equal(p.actionSeq, first + 1);
  hand.update(1 / 60, 0, p, B.STONE, false);
  assert.equal(hand.root.visible, false);
});

function emptySection(sy, revision) {
  return {
    sy,
    revision,
    collision: new Uint8Array(C * C * S),
    ...Object.fromEntries(
      ['opaque', 'water', 'cutout', 'effects'].map((k) => [k, { index: new Uint32Array() }]),
    ),
  };
}
test('mined boundary stays closed until both chunk faces and vertical faces are uploaded', () => {
  const w = Object.create(World.prototype);
  Object.assign(w, {
    chunks: new Map(),
    edits: new Map(),
    dimension: 'overworld',
    epoch: 0,
    onEdit() {},
    uploads: [],
    workers: [],
    renderer: renderer(),
    radius: 0,
  });
  for (let x = 0; x < 2; x++) {
    const c = new Chunk(x, 0, 0);
    c.data = new Uint8Array(C * C * H).fill(B.STONE);
    c.appliedRevisions.fill(0);
    for (let sy = 0; sy < H / S; sy++) {
      c.sections.set(sy, []);
      c.visibleSolids.set(sy, new Uint8Array(C * C * S).fill(1));
    }
    w.chunks.set(`${x},0`, c);
  }
  const left = w.chunks.get('0,0'),
    right = w.chunks.get('1,0');
  w.set(15, 31, 8, B.AIR);
  assert.equal(w.get(15, 31, 8), B.AIR);
  assert.equal(w.collides(15, 31, 8), true);
  left.apply([emptySection(1, left.sectionRevisions[1])], w.renderer);
  left.apply([emptySection(2, left.sectionRevisions[2])], w.renderer);
  assert.equal(
    w.collides(15, 31, 8),
    true,
    'adjacent chunk has not uploaded its newly exposed face',
  );
  right.apply([emptySection(1, right.sectionRevisions[1])], w.renderer);
  assert.equal(w.collides(15, 31, 8), false);
  // Only a matching section version is required, despite a newer chunk-wide edit.
  left.revision = 100;
  left.sectionRevisions[3] = 7;
  left.meshing = true;
  w.receive(
    { busy: true },
    {
      type: 'meshed',
      key: '0,0',
      epoch: 0,
      revision: 99,
      sections: [emptySection(3, 7), emptySection(1, 0)],
    },
  );
  assert.equal(w.uploads.length, 1);
  assert.equal(w.uploads[0].sections[0].sy, 3);
  assert.ok(left.dirty.has(1));
});
