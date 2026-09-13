import { limbAngle } from './character-motion.js';
import { HeldItems } from './held-items.js';
import { U } from './scale.js';
import { THREE } from './renderer.js';
import { B, solid, isWater } from './blocks.js';
import { moveBody, intersects } from './physics.js';
import { characterParts, MAX_CHARACTER_PARTS } from './character-models.js';
import { raycast } from './raycast.js';
export class Entity {
  constructor(id) {
    this.id = id;
    this.active = false;
    this.position = { x: 0, y: 0, z: 0 };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.previous = { ...this.position };
    this.stepHeight = 1;
    this.width = 0.65 * U;
    this.height = 1.7;
    this.health = 10;
    this.grounded = false;
    this.heading = 0;
    this.timer = 0;
    this.hurt = 0;
    this.attackTimer = 0;
    this.kind = 'sheep';
    this.mesh = null;
  }
  spawn(kind, x, y, z) {
    this.active = true;
    this.kind = kind;
    this.parts = characterParts(kind, this.id);
    this.attackTimer = 0;
    this.destination = null;
    Object.assign(this.position, { x, y, z });
    Object.assign(this.previous, this.position);
    Object.assign(this.velocity, { x: 0, y: 0, z: 0 });
    this.health = kind === 'companion' ? 24 : kind === 'rival' ? 16 : kind === 'ember' ? 14 : 8;
    this.combatTarget = null;
    this.followDistance = 2 * U;
    this.width = (kind === 'sheep' ? 0.85 : 0.6) * U;
    this.height = (kind === 'companion' ? 0.95 : kind === 'sheep' ? 1.05 : 1.8) * U;
    this.heading = Math.random() * Math.PI * 2;
    this.timer = 0;
    this.hurt = 0;
    this.grounded = false;
    return this;
  }
  damage(amount, dx, dz) {
    if (!this.active || this.health <= 0) return;
    this.health -= amount;
    this.hurt = 1.2;
    this.velocity.x = dx * 6 * U;
    this.velocity.z = dz * 6 * U;
    this.velocity.y = 4 * U;
    if (this.health <= 0) {
      this.active = false;
      this.onDeath?.(this, dx, dz);
    }
  }
  tick(world, player, dt, light) {
    Object.assign(this.previous, this.position);
    if (
      this.grounded &&
      !intersects(
        world,
        { x: this.position.x, y: this.position.y - 0.04, z: this.position.z },
        this.width,
        this.height,
      )
    )
      this.grounded = false;
    this.hurt = Math.max(0, this.hurt - dt);
    this.attackTimer -= dt;
    this.timer -= dt;
    const victim = this.combatTarget?.active ? this.combatTarget : player;
    const dx = victim.position.x - this.position.x,
      dz = victim.position.z - this.position.z,
      dist = Math.hypot(dx, dz),
      hostile = this.kind === 'rival' || this.kind === 'ember';
    if (this.hurt <= 0.65) {
      let speed = 0;
      if (this.kind === 'companion') {
        if (this.destination) {
          const tx = this.destination.x - this.position.x,
            tz = this.destination.z - this.position.z;
          if (Math.hypot(tx, tz) > this.followDistance) {
            this.heading = Math.atan2(tx, tz);
            speed = 4.2 * U;
          }
        }
      } else if (hostile && dist < 22 * U && player.mode !== 'creative') {
        this.heading = Math.atan2(dx, dz);
        speed = (this.kind === 'ember' ? 3.3 : 3.0) * U;
        if (
          dist < 1.25 * U &&
          Math.abs(victim.position.y - this.position.y) < 1.6 * U &&
          this.attackTimer <= 0
        ) {
          const blocked = raycast(
            world.get.bind(world),
            {
              x: this.position.x,
              y: this.position.y + Math.min(this.height, victim.height) * 0.5,
              z: this.position.z,
            },
            { x: dx / (dist || 1), y: 0, z: dz / (dist || 1) },
            dist,
            solid,
          );
          if (!blocked) victim.damage(3, dx / (dist || 1), dz / (dist || 1));
          this.attackTimer = 1.1;
        }
      } else {
        if (this.timer <= 0) {
          this.heading += Math.random() * 2 - 1;
          this.timer = 2 + Math.random() * 3;
        }
        speed = (this.kind === 'sheep' ? 0.65 : 1.1) * U;
        if (this.kind === 'sheep' && this.hurt > 0) {
          this.heading = Math.atan2(-dx, -dz);
          speed = 4 * U;
        }
      }
      this.velocity.x = Math.sin(this.heading) * speed;
      this.velocity.z = Math.cos(this.heading) * speed;
    }
    const ahead = {
      x: this.position.x + Math.sin(this.heading) * 0.6 * U,
      y: this.position.y,
      z: this.position.z + Math.cos(this.heading) * 0.6 * U,
    };
    if (this.grounded && intersects(world, ahead, this.width, this.height)) {
      this.velocity.y = 8.5 * U;
      this.grounded = false;
    }
    // Keep land mobs out of open water and drop-offs when wandering.
    if (this.kind === 'sheep' && !solid(world.get(ahead.x, ahead.y - 1, ahead.z))) {
      this.heading += Math.PI * 0.8;
      this.velocity.x = this.velocity.z = 0;
    }
    this.velocity.y = Math.max(-30 * U, this.velocity.y - 25 * U * dt);
    if (isWater(world.get(this.position.x, this.position.y + 0.5 * U, this.position.z)))
      this.velocity.y = Math.max(this.velocity.y, -U);
    moveBody(this, world, dt);
    if ((this.kind !== 'companion' && dist > 95 * U) || this.position.y < 1) this.active = false;
  }
}
export class Entities {
  constructor(renderer, world) {
    this.world = world;
    this.pool = Array.from({ length: 28 }, (_, i) => new Entity(i));
    this.timer = 0;
    this.heldItems = renderer.uniforms?.uAtlas ? new HeldItems(renderer) : null;
    this.dummy = new THREE.Object3D();
    this.color = new THREE.Color();
    this.hurtColor = new THREE.Color('#ff715b');
    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      renderer.lightMaterial(new THREE.MeshLambertMaterial()),
      28 * MAX_CHARACTER_PARTS,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    renderer.scene.add(this.mesh);
    this.mesh.count = 0;
  }
  spawn(kind, x, y, z) {
    return this.pool.find((e) => !e.active)?.spawn(kind, x, y, z);
  }
  clear() {
    this.heldItems?.hide();
    for (const e of this.pool) e.active = false;
  }
  tick(player, dt, light, guests = []) {
    const players = [player, ...guests].filter((p) => p.health > 0);
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 3;
      const active = this.pool.filter((e) => e.active).length;
      if (active < 16) {
        const anchor = players[Math.floor(Math.random() * players.length)] || player;
        const a = Math.random() * Math.PI * 2,
          r = 10 * U + Math.random() * 12 * U,
          x = anchor.position.x + Math.cos(a) * r,
          z = anchor.position.z + Math.sin(a) * r;
        if (this.world.loaded(x, z)) {
          const c = this.world.column(x, z),
            y = c.height + 1;
          const nether = this.world.dimension === 'nether';
          const kind =
            nether || c.biome === 'volcanic'
              ? 'ember'
              : light < 0.5 || c.biome === 'desert' || active % 5 === 4
                ? 'rival'
                : 'sheep';
          if (
            this.world.get(x, y, z) === B.AIR &&
            solid(this.world.get(x, y - 1, z)) &&
            !intersects(this.world, { x, y, z }, 0.85 * U, 1.8 * U)
          )
            this.spawn(kind, x, y, z);
        }
      }
    }
    for (const e of this.pool)
      if (e.active) {
        const nearest = players.reduce(
          (a, b) =>
            Math.hypot(b.position.x - e.position.x, b.position.z - e.position.z) <
            Math.hypot(a.position.x - e.position.x, a.position.z - e.position.z)
              ? b
              : a,
          player,
        );
        e.tick(this.world, nearest, dt, light);
      }
  }
  draw(time, player, alpha = 1) {
    this.heldItems?.hide();
    let n = 0;
    for (const e of this.pool) {
      if (!e.active) continue;
      const dx = THREE.MathUtils.lerp(e.previous.x, e.position.x, alpha),
        dy = THREE.MathUtils.lerp(e.previous.y, e.position.y, alpha),
        dz = THREE.MathUtils.lerp(e.previous.z, e.position.z, alpha);
      const moving = Math.hypot(e.velocity.x, e.velocity.z) > 0.2;
      const walk = moving ? Math.sin(time * 9 + e.id) * 0.52 : 0;
      const bob = moving
        ? Math.abs(Math.sin(time * 9 + e.id)) * 0.025
        : Math.sin(time * 2 + e.id) * 0.009;
      const blink = Math.sin(time * 0.71 + e.id * 3.17) > 0.998;
      const co = Math.cos(e.heading),
        si = Math.sin(e.heading);
      let look = 0;
      if (player && e.kind !== 'player') {
        const dx = player.position.x - e.position.x,
          dz = player.position.z - e.position.z;
        if (Math.hypot(dx, dz) < 8 * U)
          look = Math.max(
            -0.55,
            Math.min(
              0.55,
              Math.atan2(
                Math.sin(Math.atan2(dx, dz) - e.heading),
                Math.cos(Math.atan2(dx, dz) - e.heading),
              ),
            ),
          );
      }
      for (const [bx, by, bz, sx, sy, sz, c, joint, pivot] of e.parts) {
        let x = bx,
          y = by,
          z = bz,
          rx = 0,
          ry = e.heading;
        const head =
          ['head', 'eye', 'pupil'].includes(joint) && !['sheep', 'companion'].includes(e.kind);
        if (head) {
          x = bx * Math.cos(look) + bz * Math.sin(look);
          z = bz * Math.cos(look) - bx * Math.sin(look);
          ry += look;
          if (e.kind === 'player') {
            rx = -(e.pitch || 0);
            const hy = y - 1.36;
            y = 1.36 + hy * Math.cos(rx) - z * Math.sin(rx);
            z = hy * Math.sin(rx) + z * Math.cos(rx);
          }
        }
        if (joint?.startsWith('leg') || joint?.startsWith('arm')) {
          rx = limbAngle(e, joint, time);
          const dy = by - pivot;
          y = pivot + dy * Math.cos(rx) - bz * Math.sin(rx);
          z = dy * Math.sin(rx) + bz * Math.cos(rx);
        }
        if (joint === 'tail') {
          x += Math.sin(time * 9) * 0.12;
          ry += Math.sin(time * 9) * 0.3;
        }
        this.dummy.position.set(
          dx + (x * co + z * si) * U,
          dy + (y + bob) * U,
          dz + (z * co - x * si) * U,
        );
        this.dummy.rotation.set(rx, ry, 0, 'YXZ');
        this.dummy.scale.set(
          sx * U,
          blink && (joint === 'eye' || joint === 'pupil') ? sy * 0.12 * U : sy * U,
          sz * U,
        );
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(n, this.dummy.matrix);
        this.color.set(c);
        if (e.hurt > 0.8) this.color.lerp(this.hurtColor, 0.55);
        this.mesh.setColorAt(n++, this.color);
      }
      if (e.kind === 'player' && e.heldBlock && this.heldItems) {
        const rx = limbAngle(e, 'armR', time),
          hy = 0.76 - 1.34,
          hz = 0.09;
        const y = 1.34 + hy * Math.cos(rx) - hz * Math.sin(rx),
          z = hy * Math.sin(rx) + hz * Math.cos(rx);
        this.dummy.position.set(dx + 0.385 * co + z * si, dy + y + bob, dz + z * co - 0.385 * si);
        this.dummy.rotation.set(rx, e.heading, 0, 'YXZ');
        this.dummy.scale.setScalar(0.27);
        this.dummy.updateMatrix();
        this.heldItems.set(e.id, e.heldBlock, this.dummy.matrix);
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
