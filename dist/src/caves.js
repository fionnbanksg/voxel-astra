import { hash } from './noise.js';
// Deterministic region graph. Capsules make connected, human-sized tunnels;
// branch ramps intersect the surface instead of sealing every cave underground.
export class CaveField {
  constructor(cx, cz, seed, column) {
    this.segments = [];
    const nodes = new Map(),
      node = (gx, gz) => {
        const k = `${gx},${gz}`;
        if (nodes.has(k)) return nodes.get(k);
        const x = gx * 96 + 20 + Math.floor(hash(gx, 12, gz, seed) * 56),
          z = gz * 96 + 20 + Math.floor(hash(gx, 17, gz, seed) * 56),
          c = column(x, z);
        const p = { x, y: Math.max(8, c.height - 16), z, c };
        nodes.set(k, p);
        return p;
      };
    const add = (a, b, r = 3.5) => {
      if (
        Math.max(a.x, b.x) + r < cx * 16 - 12 ||
        Math.min(a.x, b.x) - r > cx * 16 + 28 ||
        Math.max(a.z, b.z) + r < cz * 16 - 12 ||
        Math.min(a.z, b.z) - r > cz * 16 + 28
      )
        return;
      this.segments.push({ a, b, r });
    };
    const gx = Math.floor((cx * 16) / 96),
      gz = Math.floor((cz * 16) / 96);
    for (let iz = gz - 1; iz <= gz + 1; iz++)
      for (let ix = gx - 1; ix <= gx + 1; ix++) {
        const a = node(ix, iz);
        add(a, node(ix + 1, iz));
        add(a, node(ix, iz + 1));
        add(a, a, 5.5);
        const ex = a.x + 24,
          ez = a.z,
          c = column(ex, ez);
        if (c.height > c.waterTop + 4) add(a, { x: ex, y: c.height + 2, z: ez }, 3.5);
      }
    // A nearby, seeded-world-independent landmark makes caves discoverable at spawn.
    const c = column(43, -32),
      a = { x: 19, y: Math.max(8, c.height - 16), z: -32 };
    if (c.height > c.waterTop + 4) {
      add({ x: 43, y: c.height + 2, z: -32 }, a, 4);
      add(a, a, 6);
      add(a, node(0, -1), 3.5);
    }
  }
  forColumn(x, z) {
    return this.segments.filter(
      ({ a, b, r }) =>
        x >= Math.min(a.x, b.x) - r &&
        x <= Math.max(a.x, b.x) + r &&
        z >= Math.min(a.z, b.z) - r &&
        z <= Math.max(a.z, b.z) + r,
    );
  }
}
export function insideCave(segments, x, y, z) {
  if (y < 5) return false;
  for (const { a, b, r } of segments) {
    if (y < Math.min(a.y, b.y) - r || y > Math.max(a.y, b.y) + r) continue;
    const dx = b.x - a.x,
      dy = b.y - a.y,
      dz = b.z - a.z,
      len = dx * dx + dy * dy + dz * dz;
    const t = len
      ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy + (z - a.z) * dz) / len))
      : 0;
    if ((x - a.x - t * dx) ** 2 + (y - a.y - t * dy) ** 2 + (z - a.z - t * dz) ** 2 < r * r)
      return true;
  }
  return false;
}
