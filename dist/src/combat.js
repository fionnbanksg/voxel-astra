import { U } from './scale.js';
// Ray/AABB slab intersection for opponents, limited by the first solid voxel.
export function rayBox(origin, dir, min, max) {
  let near = 0,
    far = Infinity;
  for (const a of ['x', 'y', 'z']) {
    if (Math.abs(dir[a]) < 1e-9) {
      if (origin[a] < min[a] || origin[a] > max[a]) return Infinity;
      continue;
    }
    let t1 = (min[a] - origin[a]) / dir[a],
      t2 = (max[a] - origin[a]) / dir[a];
    if (t1 > t2) [t1, t2] = [t2, t1];
    near = Math.max(near, t1);
    far = Math.min(far, t2);
    if (near > far) return Infinity;
  }
  return near;
}
export function attack(entities, player, origin, dir, wallDistance = 4 * U) {
  let target = null,
    nearest = Math.min(4 * U, wallDistance);
  for (const e of entities.pool) {
    if (!e.active || e.kind === 'companion') continue;
    const p = e.position,
      r = e.width / 2;
    const t = rayBox(
      origin,
      dir,
      { x: p.x - r, y: p.y, z: p.z - r },
      { x: p.x + r, y: p.y + e.height, z: p.z + r },
    );
    if (t < nearest) {
      nearest = t;
      target = e;
    }
  }
  if (!target) return false;
  const dx = target.position.x - player.position.x,
    dz = target.position.z - player.position.z,
    d = Math.hypot(dx, dz) || 1;
  target.damage(4, dx / d, dz / d);
  return true;
}
