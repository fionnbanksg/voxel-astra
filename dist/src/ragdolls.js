import { THREE } from './renderer.js';
import { characterParts, MAX_CHARACTER_PARTS } from './character-models.js';

export const RAGDOLL_LIMIT = 16,
  RAGDOLL_LIFE = 9,
  JOINT_COUNT = 11;
const animal = (k) => k === 'sheep' || k === 'companion';
const humanoid = [
  [0, 0.7, 0],
  [0, 1.32, 0],
  [0, 1.57, 0],
  [-0.385, 1.34, 0],
  [-0.385, 0.8, 0],
  [0.385, 1.34, 0],
  [0.385, 0.8, 0],
  [-0.15, 0.7, 0],
  [-0.15, 0.09, 0],
  [0.15, 0.7, 0],
  [0.15, 0.09, 0],
];
function skeleton(kind) {
  if (!animal(kind)) return humanoid;
  const w = kind === 'sheep' ? 0.25 : 0.16,
    z = kind === 'sheep' ? 0.34 : 0.28,
    h = kind === 'sheep' ? 0.5 : 0.44;
  return [
    [0, 0.62, -z],
    [0, 0.62, z],
    [0, kind === 'sheep' ? 0.84 : 0.7, kind === 'sheep' ? 0.61 : 0.45],
    [-w, h, z],
    [-w, 0.07, z],
    [w, h, z],
    [w, 0.07, z],
    [-w, h, -z],
    [-w, 0.07, -z],
    [w, h, -z],
    [w, 0.07, -z],
  ];
}
const links = [
  [0, 1],
  [1, 2],
  [1, 3],
  [1, 5],
  [0, 7],
  [0, 9],
  [3, 5],
  [7, 9],
  [3, 7],
  [5, 9],
  [3, 9],
  [5, 7],
  [0, 3],
  [0, 5],
  [1, 7],
  [1, 9],
  [3, 4],
  [5, 6],
  [7, 8],
  [9, 10],
];

/** Bounded position-based ragdolls: a braced torso, neck and four jointed limbs.
 * Verlet nodes collide with voxel AABBs at 120 Hz; iterative distance constraints
 * keep limbs attached. Only the host simulates; guests interpolate node snapshots.
 * No full external rigid-body engine or per-corpse timers/meshes are allocated. */
export class Ragdolls {
  constructor(renderer, world) {
    this.world = world;
    this.epoch = world.epoch;
    this.serial = 0;
    this.accumulator = 0;
    this.frameAt = 0;
    this.pool = Array.from({ length: RAGDOLL_LIMIT }, () => ({
      active: false,
      points: new Float32Array(JOINT_COUNT * 3),
      old: new Float32Array(JOINT_COUNT * 3),
      previous: new Float32Array(JOINT_COUNT * 3),
    }));
    this.dummy = new THREE.Object3D();
    this.color = new THREE.Color();
    this.basis = new THREE.Matrix4();
    this.right = new THREE.Vector3();
    this.up = new THREE.Vector3();
    this.front = new THREE.Vector3();
    this.pos = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.torsoQ = new THREE.Quaternion();
    this.torsoFront = new THREE.Vector3();
    this.nodes = Array.from({ length: JOINT_COUNT }, () => new THREE.Vector3());
    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      renderer.lightMaterial(new THREE.MeshLambertMaterial()),
      RAGDOLL_LIMIT * MAX_CHARACTER_PARTS,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    renderer.scene.add(this.mesh);
  }
  reset() {
    for (const r of this.pool) r.active = false;
    this.mesh.count = 0;
    this.accumulator = 0;
    this.epoch = this.world.epoch;
  }
  spawn(actor, source = '', dx = 0, dz = 0) {
    const r =
      this.pool.find((r) => !r.active) || this.pool.reduce((a, b) => (a.age > b.age ? a : b));
    r.active = true;
    r.id = ++this.serial;
    r.kind = actor.kind || 'player';
    r.skin = actor.skinIndex ?? actor.id ?? 0;
    r.source = source;
    r.age = 0;
    r.base = skeleton(r.kind);
    r.parts = characterParts(r.kind, r.skin);
    r.constraints = links.map(([a, b]) => [
      a,
      b,
      Math.hypot(...r.base[a].map((v, i) => v - r.base[b][i])),
    ]);
    const heading = actor.heading ?? (actor.yaw || 0) + Math.PI,
      co = Math.cos(heading),
      si = Math.sin(heading);
    // Slight unequal limb velocities and a forward impulse break the perfectly
    // balanced standing pose, letting the actual ground determine the fall.
    for (let i = 0; i < JOINT_COUNT; i++) {
      const [x, y, z] = r.base[i],
        j = i * 3;
      r.points[j] = actor.position.x + x * co + z * si;
      r.points[j + 1] = actor.position.y + y;
      r.points[j + 2] = actor.position.z + z * co - x * si;
      const twist = (i % 2 ? 1 : -1) * 0.35;
      const vx = Math.max(
        -18,
        Math.min(18, (actor.velocity?.x || 0) * 0.4 + dx * 6 + si * (i < 3 ? 1.1 : 0.4) + twist),
      );
      const vz = Math.max(
        -18,
        Math.min(18, (actor.velocity?.z || 0) * 0.4 + dz * 6 + co * (i < 3 ? 1.1 : 0.4) - twist),
      );
      r.old[j] = r.points[j] - vx / 120;
      r.old[j + 1] =
        r.points[j + 1] - Math.min(6, 1.2 + Math.max(0, actor.velocity?.y || 0) * 0.3) / 120;
      r.old[j + 2] = r.points[j + 2] - vz / 120;
    }
    r.previous.set(r.points);
    return r;
  }
  impulse(position, power) {
    for (const r of this.pool)
      if (r.active)
        for (let i = 0; i < JOINT_COUNT; i++) {
          const j = i * 3,
            dx = r.points[j] - position.x,
            dy = r.points[j + 1] - position.y,
            dz = r.points[j + 2] - position.z,
            d = Math.hypot(dx, dy, dz);
          const strength = (Math.max(0, 1 - d / (power * 2)) * 12) / (Math.max(0.4, d) * 120);
          r.old[j] -= dx * strength;
          r.old[j + 1] -= (dy + 1) * strength;
          r.old[j + 2] -= dz * strength;
        }
  }
  collide(r, i) {
    const j = i * 3,
      p = r.points,
      radius = i === 2 ? 0.22 : i < 2 ? 0.19 : 0.09;
    // Sphere/AABB projection handles corners, floors and walls. Unloaded cells
    // remain closed through World.collides, including pending mining geometry.
    const minX = Math.floor(p[j] - radius),
      maxX = Math.floor(p[j] + radius),
      minY = Math.floor(p[j + 1] - radius),
      maxY = Math.floor(p[j + 1] + radius),
      minZ = Math.floor(p[j + 2] - radius),
      maxZ = Math.floor(p[j + 2] + radius);
    for (let y = minY; y <= maxY; y++)
      for (let z = minZ; z <= maxZ; z++)
        for (let x = minX; x <= maxX; x++) {
          if (!this.world.collides(x, y, z)) continue;
          const cx = Math.max(x, Math.min(x + 1, p[j])),
            cy = Math.max(y, Math.min(y + 1, p[j + 1])),
            cz = Math.max(z, Math.min(z + 1, p[j + 2]));
          let dx = p[j] - cx,
            dy = p[j + 1] - cy,
            dz = p[j + 2] - cz,
            d = Math.hypot(dx, dy, dz);
          if (d >= radius) continue;
          if (d < 1e-6) {
            const choices = [
              [p[j] - x + radius, -1, 0, 0],
              [x + 1 - p[j] + radius, 1, 0, 0],
              [p[j + 1] - y + radius, 0, -1, 0],
              [y + 1 - p[j + 1] + radius, 0, 1, 0],
              [p[j + 2] - z + radius, 0, 0, -1],
              [z + 1 - p[j + 2] + radius, 0, 0, 1],
            ].sort((a, b) => a[0] - b[0]);
            const c = choices[0];
            p[j] += c[0] * c[1];
            p[j + 1] += c[0] * c[2];
            p[j + 2] += c[0] * c[3];
            dx = c[1];
            dy = c[2];
            dz = c[3];
            d = 1;
          } else {
            const push = (radius - d) / d;
            p[j] += dx * push;
            p[j + 1] += dy * push;
            p[j + 2] += dz * push;
          }
          // Remove inward velocity, then damp contact tangents without bounce.
          const vx = p[j] - r.old[j],
            vy = p[j + 1] - r.old[j + 1],
            vz = p[j + 2] - r.old[j + 2],
            dot = Math.min(0, (vx * dx + vy * dy + vz * dz) / d);
          r.old[j] = p[j] - (vx - (dot * dx) / d) * 0.7;
          r.old[j + 1] = p[j + 1] - (vy - (dot * dy) / d) * 0.7;
          r.old[j + 2] = p[j + 2] - (vz - (dot * dz) / d) * 0.7;
        }
  }
  step(dt) {
    for (const r of this.pool) {
      if (!r.active) continue;
      r.age += dt;
      if (r.age >= RAGDOLL_LIFE) {
        r.active = false;
        continue;
      }
      r.previous.set(r.points);
      for (let j = 0; j < r.points.length; j++) {
        const current = r.points[j],
          v = Math.max(-0.15, Math.min(0.15, (current - r.old[j]) * Math.exp(-1.5 * dt)));
        r.points[j] += v + (j % 3 === 1 ? -20 * dt * dt : 0);
        r.old[j] = current;
      }
      for (let iteration = 0; iteration < 7; iteration++) {
        for (const [a, b, length] of r.constraints) {
          const aj = a * 3,
            bj = b * 3,
            dx = r.points[bj] - r.points[aj],
            dy = r.points[bj + 1] - r.points[aj + 1],
            dz = r.points[bj + 2] - r.points[aj + 2],
            d = Math.hypot(dx, dy, dz) || 1,
            f = ((d - length) / d) * 0.5;
          r.points[aj] += dx * f;
          r.points[aj + 1] += dy * f;
          r.points[aj + 2] += dz * f;
          r.points[bj] -= dx * f;
          r.points[bj + 1] -= dy * f;
          r.points[bj + 2] -= dz * f;
        }
        for (let i = 0; i < JOINT_COUNT; i++) this.collide(r, i);
      }
    }
  }
  update(dt, simulate) {
    if (this.epoch !== this.world.epoch) this.reset();
    if (!simulate) {
      this.accumulator = 0;
      return;
    }
    this.accumulator += Math.min(0.1, dt);
    while (this.accumulator >= 1 / 120) {
      this.step(1 / 120);
      this.accumulator -= 1 / 120;
    }
  }
  snapshot() {
    return this.pool
      .filter((r) => r.active)
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        skin: r.skin,
        source: r.source,
        age: r.age,
        points: Array.from(r.points, (v) => Math.round(v * 1000) / 1000),
      }));
  }
  receive(rows) {
    if (this.epoch !== this.world.epoch) this.reset();
    this.frameAt = performance.now();
    const seen = new Set(rows.map((s) => s.id));
    for (const r of this.pool) if (!seen.has(r.id)) r.active = false;
    for (const s of rows) {
      let r = this.pool.find((r) => r.active && r.id === s.id);
      if (!r)
        r = this.pool.find((r) => !r.active) || this.pool.reduce((a, b) => (a.age > b.age ? a : b));
      const fresh = !r.active || r.id !== s.id,
        newModel = fresh || r.kind !== s.kind || r.skin !== s.skin;
      r.active = true;
      Object.assign(r, { id: s.id, kind: s.kind, skin: s.skin, source: s.source, age: s.age });
      if (newModel) {
        r.base = skeleton(s.kind);
        r.parts = characterParts(s.kind, s.skin);
        r.constraints = links.map(([a, b]) => [
          a,
          b,
          Math.hypot(...r.base[a].map((v, i) => v - r.base[b][i])),
        ]);
      }
      r.previous.set(fresh ? s.points : r.points);
      r.points.set(s.points);
      for (let j = 0; j < r.points.length; j++)
        r.old[j] = r.points[j] - (r.points[j] - r.previous[j]) / 12;
    }
    for (const r of this.pool) if (!seen.has(r.id)) r.active = false;
    this.serial = Math.max(this.serial, ...rows.map((r) => r.id));
  }
  draw(replica = false, paused = false) {
    let n = 0;
    const alpha = replica
      ? Math.min(1, (performance.now() - this.frameAt) / 100)
      : paused
        ? 1
        : this.accumulator * 120;
    for (const r of this.pool) {
      if (!r.active) continue;
      for (let i = 0; i < JOINT_COUNT; i++) {
        const j = i * 3;
        this.nodes[i].set(
          THREE.MathUtils.lerp(r.previous[j], r.points[j], alpha),
          THREE.MathUtils.lerp(r.previous[j + 1], r.points[j + 1], alpha),
          THREE.MathUtils.lerp(r.previous[j + 2], r.points[j + 2], alpha),
        );
      }
      const nodes = this.nodes,
        quadruped = animal(r.kind);
      this.right.subVectors(nodes[5], nodes[3]).normalize();
      if (quadruped) {
        this.front.subVectors(nodes[1], nodes[0]).normalize();
        this.up.crossVectors(this.front, this.right).normalize();
        this.front.crossVectors(this.right, this.up).normalize();
      } else {
        this.up.subVectors(nodes[1], nodes[0]).normalize();
        this.front.crossVectors(this.right, this.up).normalize();
        this.right.crossVectors(this.up, this.front).normalize();
      }
      this.basis.makeBasis(this.right, this.up, this.front);
      this.torsoQ.setFromRotationMatrix(this.basis);
      this.torsoFront.copy(this.front);
      const shrink = Math.min(1, (RAGDOLL_LIFE - r.age) * 2);
      for (const part of r.parts) {
        const [x, y, z, sx, sy, sz, color, joint] = part;
        let anchor = 0,
          tip = null,
          isHead = ['head', 'eye', 'pupil'].includes(joint);
        if (quadruped) {
          if (joint?.startsWith('leg')) {
            anchor = z > 0 ? (x < 0 ? 3 : 5) : x < 0 ? 7 : 9;
            tip = anchor + 1;
          } else if (z > 0.25 && y > 0.54) isHead = true;
        } else if (joint === 'armL') {
          anchor = 3;
          tip = 4;
        } else if (joint === 'armR') {
          anchor = 5;
          tip = 6;
        } else if (joint === 'legL') {
          anchor = 7;
          tip = 8;
        } else if (joint === 'legR') {
          anchor = 9;
          tip = 10;
        }
        if (isHead && tip === null) anchor = 2;
        this.q.copy(this.torsoQ);
        if (tip !== null) {
          this.up.subVectors(nodes[anchor], nodes[tip]).normalize();
          this.right.crossVectors(this.up, this.torsoFront).normalize();
          if (this.right.lengthSq() < 0.01) this.right.set(1, 0, 0);
          this.front.crossVectors(this.right, this.up).normalize();
          this.basis.makeBasis(this.right, this.up, this.front);
          this.q.setFromRotationMatrix(this.basis);
        }
        this.pos
          .set(x - r.base[anchor][0], y - r.base[anchor][1], z - r.base[anchor][2])
          .applyQuaternion(this.q)
          .add(nodes[anchor]);
        this.dummy.position.copy(this.pos);
        this.dummy.quaternion.copy(this.q);
        this.dummy.scale.set(sx * shrink, sy * shrink, sz * shrink);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(n, this.dummy.matrix);
        this.color.set(color);
        this.mesh.setColorAt(n++, this.color);
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
