import { U, PLAYER_WIDTH, PLAYER_HEIGHT } from './scale.js';
import { B, clamp, isWater, isLava } from './blocks.js';
export function overlapsBlock(p, x, y, z, width = 0.6, height = 1.8) {
  return (
    p.x + width / 2 > x &&
    p.x - width / 2 < x + 1 &&
    p.y + height > y &&
    p.y < y + 1 &&
    p.z + width / 2 > z &&
    p.z - width / 2 < z + 1
  );
}
export function intersects(world, p, width = 0.6, height = 1.8) {
  const r = width / 2,
    e = 1e-6;
  for (let y = Math.floor(p.y + e); y <= Math.floor(p.y + height - e); y++)
    for (let z = Math.floor(p.z - r + e); z <= Math.floor(p.z + r - e); z++)
      for (let x = Math.floor(p.x - r + e); x <= Math.floor(p.x + r - e); x++)
        if (world.collides(x, y, z)) return true;
  return false;
}
export function moveBody(body, world, dt, step = true) {
  const p = body.position,
    v = body.velocity,
    width = body.width || 0.6,
    height = body.height || 1.8;
  let landedSpeed = 0;
  // Axis substeps cap travel at .2 blocks, preventing high-velocity tunneling.
  for (const axis of ['x', 'z', 'y']) {
    const distance = v[axis] * dt,
      n = Math.max(1, Math.ceil(Math.abs(distance) / 0.2)),
      delta = distance / n;
    for (let i = 0; i < n; i++) {
      const old = p[axis];
      p[axis] += delta;
      if (intersects(world, p, width, height)) {
        if (axis !== 'y' && step && body.grounded) {
          const oldY = p.y;
          p.y += (body.stepHeight || 1) + 0.001;
          if (!intersects(world, p, width, height)) {
            body.grounded = false;
            continue;
          }
          p.y = oldY;
        }
        p[axis] = old;
        if (axis === 'y' && delta < 0) {
          body.grounded = true;
          landedSpeed = -v.y;
        }
        v[axis] = 0;
        break;
      }
    }
  }
  return landedSpeed;
}
export class Player {
  constructor() {
    this.position = { x: 8.5, y: 70, z: 8.5 };
    this.previous = { ...this.position };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.stepHeight = 1;
    this.width = PLAYER_WIDTH;
    this.height = PLAYER_HEIGHT;
    this.grounded = false;
    this.yaw = -0.65;
    this.pitch = -0.16;
    this.health = 20;
    this.life = 0;
    this.heldBlock = B.GRASS;
    this.hurtTime = 0;
    this.inWater = false;
    this.mode = 'survival';
    this.flying = false;
    this.flySpeed = 12;
    this.flightResponse = 7;
    this.knock = { x: 0, z: 0 };
  }
  setMode(mode) {
    if (this.health <= 0) this.life++;
    this.mode = mode === 'creative' ? 'creative' : 'survival';
    this.flying = this.mode === 'creative';
    this.velocity.y = 0;
    this.knock.x = this.knock.z = 0;
    this.health = 20;
    this.hurtTime = 0;
  }
  toggleFlight() {
    if (this.mode === 'creative') {
      this.flying = !this.flying;
      this.velocity.y = 0;
      this.grounded = false;
    }
  }
  tick(world, keys, dt) {
    Object.assign(this.previous, this.position);
    this.hurtTime = Math.max(0, this.hurtTime - dt);
    this.inWater = world.fluids
      ? world.fluids.contains(this.position.x, this.position.y + 0.8 * U, this.position.z)
      : isWater(world.get(this.position.x, this.position.y + 0.8 * U, this.position.z));
    const speed = this.flying
        ? keys.has('ShiftLeft') || keys.has('ShiftRight')
          ? this.flySpeed * 2 * U
          : this.flySpeed * U
        : keys.has('ShiftLeft')
          ? 7 * U
          : 4.5 * U,
      forward = Number(keys.has('KeyW')) - Number(keys.has('KeyS')),
      right = Number(keys.has('KeyD')) - Number(keys.has('KeyA')),
      len = Math.hypot(forward, right) || 1;
    let vx = ((-Math.sin(this.yaw) * forward + Math.cos(this.yaw) * right) / len) * speed;
    let vz = ((-Math.cos(this.yaw) * forward - Math.sin(this.yaw) * right) / len) * speed;
    this.knock.x *= Math.exp(-7 * dt);
    this.knock.z *= Math.exp(-7 * dt);
    // Exponential response gives stable acceleration/braking across fixed ticks.
    if (this.flying) {
      const up =
        Number(keys.has('Space')) - Number(keys.has('ControlLeft') || keys.has('ControlRight'));
      const length = Math.hypot(forward, right, up) || 1;
      vx = ((-Math.sin(this.yaw) * forward + Math.cos(this.yaw) * right) / length) * speed;
      vz = ((-Math.cos(this.yaw) * forward - Math.sin(this.yaw) * right) / length) * speed;
      const response = forward || right || up ? this.flightResponse : this.flightResponse * 1.5;
      const blend = 1 - Math.exp(-response * dt);
      this.velocity.x += (vx - this.velocity.x) * blend;
      this.velocity.z += (vz - this.velocity.z) * blend;
      this.velocity.y += ((up / length) * speed - this.velocity.y) * blend;
      if (
        !forward &&
        !right &&
        !up &&
        Math.hypot(this.velocity.x, this.velocity.y, this.velocity.z) < 0.015
      )
        Object.assign(this.velocity, { x: 0, y: 0, z: 0 });
      this.grounded = false;
      moveBody(this, world, dt, false);
      this.position.y = Math.min(180, Math.max(1, this.position.y));
      return;
    }
    if (this.inWater) {
      vx *= 0.58;
      vz *= 0.58;
    }
    const blend = 1 - Math.exp(-(this.inWater ? 7 : this.grounded ? 18 : 10) * dt);
    this.velocity.x += (vx + this.knock.x - this.velocity.x) * blend;
    this.velocity.z += (vz + this.knock.z - this.velocity.z) * blend;
    if (this.inWater) {
      const current = world.fluids?.current(
        this.position.x,
        this.position.y + 0.8 * U,
        this.position.z,
      ) || { x: 0, y: 0, z: 0 };
      this.velocity.x += current.x * 7 * dt * U;
      this.velocity.z += current.z * 7 * dt * U;
      this.velocity.y += current.y * dt * 3 * U;
      this.velocity.y += ((keys.has('Space') ? 17 : 6) - 10) * dt * U;
      this.velocity.y *= Math.exp(-3 * dt);
    } else {
      if (keys.has('Space') && this.grounded) {
        this.velocity.y = 9 * U;
        this.grounded = false;
      }
      this.velocity.y = Math.max(-45 * U, this.velocity.y - 25 * U * dt);
    }
    if (this.grounded) {
      const below = { ...this.position, y: this.position.y - 0.04 };
      if (!intersects(world, below, this.width, this.height)) this.grounded = false;
    }
    const fall = moveBody(this, world, dt);
    if (fall > 13 * U) this.damage(Math.floor((fall / U - 12) * 0.65));
    if (isLava(world.get(this.position.x, this.position.y + 0.2, this.position.z))) this.damage(4);
    if (this.position.y < 0) this.damage(20);
  }
  damage(n, dx = 0, dz = 0) {
    if (this.mode === 'creative' || this.hurtTime > 0 || this.health <= 0) return;
    this.health = Math.max(0, this.health - n);
    this.hurtTime = 0.7;
    this.knock.x = dx * 7 * U;
    this.knock.z = dz * 7 * U;
    this.velocity.y = 5 * U;
    if (this.health === 0) this.onDeath?.(this, dx, dz);
  }
  teleport(x, y, z) {
    Object.assign(this.position, { x, y, z });
    Object.assign(this.previous, this.position);
    Object.assign(this.velocity, { x: 0, y: 0, z: 0 });
    this.grounded = false;
  }
}
