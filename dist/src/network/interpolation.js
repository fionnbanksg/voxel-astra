// Visual-only snapshots in receiver-local milliseconds. A short playout delay
// keeps two received poses available instead of restarting a lerp on every packet.
export class RemotePoseBuffer {
  constructor(delay = 100) {
    this.delay = delay;
    this.slots = Array.from({ length: 16 }, () => ({
      at: 0,
      life: 0,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      pitch: 0,
    }));
    this.reset();
  }
  reset() {
    this.start = 0;
    this.count = 0;
  }
  at(index) {
    return this.slots[(this.start + index) % this.slots.length];
  }
  push(pose, now) {
    let last = this.count ? this.at(this.count - 1) : null;
    const p = pose.position,
      life = pose.life || 0;
    // Never interpolate a respawn, teleport or recovery from a long stalled tab.
    if (
      last &&
      (life !== last.life ||
        now - last.at > 500 ||
        now < last.at ||
        Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z) > 8)
    ) {
      this.reset();
      last = null;
    }
    const yaw = last
      ? last.yaw + Math.atan2(Math.sin(pose.yaw - last.yaw), Math.cos(pose.yaw - last.yaw))
      : pose.yaw;
    let slot;
    if (last && now === last.at) slot = last;
    else {
      if (this.count === this.slots.length) {
        this.start = (this.start + 1) % this.slots.length;
        this.count--;
      }
      slot = this.at(this.count++);
    }
    Object.assign(slot, { at: now, life, x: p.x, y: p.y, z: p.z, yaw, pitch: pose.pitch });
  }
  sample(now, out) {
    if (!this.count) return false;
    const target = now - this.delay;
    let a = this.at(0),
      b = a;
    for (let i = 1; i < this.count; i++) {
      b = this.at(i);
      if (b.at >= target) break;
      a = b;
    }
    // Hold the newest pose when packets stall; don't predict spins through walls.
    const t = b.at > a.at ? Math.max(0, Math.min(1, (target - a.at) / (b.at - a.at))) : 0;
    for (const k of ['x', 'y', 'z', 'yaw', 'pitch']) out[k] = a[k] + (b[k] - a[k]) * t;
    return true;
  }
}
