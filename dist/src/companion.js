import { B, solid, isLava } from './blocks.js';
import { U } from './scale.js';
import { overlapsBlock, intersects } from './physics.js';
import { raycast } from './raycast.js';
export class Companion {
  constructor(entities, world, player, notify) {
    Object.assign(this, { entities, world, player, notify });
    this.entity = null;
    this.mode = 'follow';
    this.jobs = [];
    this.timer = 0;
    this.biteTimer = 0;
    this.healTimer = 0;
    this.guardTarget = null;
  }
  safeSpot() {
    const p = this.player.position;
    for (const [dx, dz] of [
      [3, 2],
      [-3, 2],
      [3, -2],
      [-3, -2],
      [0, 4],
      [4, 0],
    ]) {
      const x = p.x + dx * U,
        z = p.z + dz * U;
      if (!this.world.loaded(x, z)) continue;
      const y = this.world.ground(x, z, p.y + 3 * U),
        point = { x, y: y + 0.03, z };
      if (
        Math.abs(y - p.y) < 8 * U &&
        !intersects(this.world, point, 0.6 * U, 0.95 * U) &&
        !isLava(this.world.get(x, y, z)) &&
        solid(this.world.get(x, y - 1, z))
      )
        return point;
    }
    return null;
  }
  summon() {
    if (this.entity?.active) return;
    const p = this.safeSpot();
    if (p) this.entity = this.entities.spawn('companion', p.x, p.y, p.z);
  }
  command(command, target, selected) {
    this.summon();
    if (!this.entity) {
      this.notify('Pip needs a clear patch of ground nearby.');
      return;
    }
    this.jobs = [];
    this.mode = command;
    if (command === 'stay') this.stayAt = { ...this.entity.position };
    if (command === 'mine') {
      if (!target) {
        this.notify('Aim at a block for Pip to dig.');
        this.mode = 'follow';
        return;
      }
      this.jobs.push({ x: target.x, y: target.y, z: target.z, b: B.AIR });
    }
    if (command === 'build') {
      const p = this.player.position,
        dx = Math.round(-Math.sin(this.player.yaw)),
        dz = Math.abs(dx) === 1 ? 0 : Math.round(-Math.cos(this.player.yaw));
      for (let i = 2 * U; i < 7 * U; i++)
        this.jobs.push({
          x: Math.floor(p.x) + dx * i,
          y: Math.floor(p.y) - 1,
          z: Math.floor(p.z) + dz * i,
          b: selected,
        });
    }
    this.notify(
      command === 'follow'
        ? 'Pip is following and guarding you.'
        : command === 'stay'
          ? 'Pip will wait here and defend nearby.'
          : command === 'mine'
            ? 'Pip is going to dig that block.'
            : 'Pip is making your path.',
    );
  }
  visible(e, target) {
    const a = { x: e.position.x, y: e.position.y + e.height * 0.65, z: e.position.z },
      b = {
        x: target.position.x,
        y: target.position.y + Math.min(e.height, target.height) * 0.65,
        z: target.position.z,
      };
    const dx = b.x - a.x,
      dy = b.y - a.y,
      dz = b.z - a.z,
      d = Math.hypot(dx, dy, dz);
    return !raycast(
      this.world.get.bind(this.world),
      a,
      { x: dx / (d || 1), y: dy / (d || 1), z: dz / (d || 1) },
      d,
      solid,
    );
  }
  tick(dt) {
    this.timer -= dt;
    this.biteTimer = Math.max(0, this.biteTimer - dt);
    this.healTimer += dt;
    if (!this.entity?.active) {
      if (this.timer <= 0) {
        this.summon();
        this.timer = 4;
      }
      return;
    }
    const e = this.entity,
      p = this.player.position;
    if (this.mode === 'follow' && Math.hypot(e.position.x - p.x, e.position.z - p.z) > 20 * U) {
      const spot = this.safeSpot();
      if (spot) {
        Object.assign(e.position, spot);
        Object.assign(e.velocity, { x: 0, y: 0, z: 0 });
      }
    }
    // Guarding interrupts commands only while a visible threat is nearby. No
    // damage through walls; enemies struck by Pip can retaliate against him.
    let threat = null,
      best = Infinity;
    for (const mob of this.entities.pool) {
      if (!mob.active || !['rival', 'ember'].includes(mob.kind)) continue;
      const ownerDistance = Math.hypot(mob.position.x - p.x, mob.position.z - p.z),
        dogDistance = Math.hypot(mob.position.x - e.position.x, mob.position.z - e.position.z);
      if (
        ownerDistance > 10 * U ||
        dogDistance > 14 * U ||
        (this.mode === 'stay' && dogDistance > 6 * U)
      )
        continue;
      if (Math.abs(mob.position.y - e.position.y) > 4 * U) continue;
      if (dogDistance < best && this.visible(e, mob)) {
        best = dogDistance;
        threat = mob;
      }
    }
    this.guardTarget = threat;
    e.followDistance = threat ? 0.8 * U : 2 * U;
    if (threat) {
      e.destination = threat.position;
      if (best < 1.4 * U && this.biteTimer <= 0) {
        const dx = threat.position.x - e.position.x,
          dz = threat.position.z - e.position.z,
          d = Math.hypot(dx, dz) || 1;
        threat.damage(5, dx / d, dz / d);
        threat.combatTarget = e;
        e.attackTimer = 0.4;
        this.biteTimer = 0.65;
      }
      return;
    }
    if (this.healTimer > 2) {
      e.health = Math.min(24, e.health + 1);
      this.healTimer = 0;
    }
    if (this.mode === 'follow') e.destination = p;
    else if (this.jobs.length) {
      const j = this.jobs[0];
      e.destination = { x: j.x + 0.5, y: j.y + 1, z: j.z + 0.5 };
      if (
        Math.hypot(e.position.x - j.x, e.position.z - j.z) < 4 * U &&
        Math.abs(e.position.y - j.y) < 3 * U &&
        this.timer <= 0
      ) {
        if (
          !overlapsBlock(p, j.x, j.y, j.z, this.player.width, this.player.height) &&
          this.world.get(j.x, j.y, j.z) !== B.BEDROCK
        ) {
          this.world.set(j.x, j.y, j.z, j.b);
          this.jobs.shift();
          this.timer = 0.15;
        } else {
          this.notify('Pip needs you to step aside.');
          this.timer = 2;
        }
      }
    } else e.destination = this.mode === 'stay' ? this.stayAt : null;
  }
}
