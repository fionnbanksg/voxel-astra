import { B, solid, liquid, voxelKey } from './blocks.js';
export function resistance(b) {
  if (b === B.BEDROCK || b === B.OBSIDIAN || liquid(b)) return Infinity;
  if ([B.STONE, B.ORE, B.BRICK].includes(b)) return 6;
  if ([B.WOOD, B.PLANKS].includes(b)) return 2;
  if (solid(b)) return 0.6;
  return 0;
}
// Original ray-based voxel blast. Resistant material absorbs energy; water
// suppresses terrain damage. Returned edits are applied with a per-frame budget.
export function blastCells(world, p, power, random = Math.random) {
  if (liquid(world.get(p.x, p.y, p.z))) return [];
  const cells = new Map(),
    n = 10;
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        if (x !== 0 && x !== n - 1 && y !== 0 && y !== n - 1 && z !== 0 && z !== n - 1) continue;
        let dx = (x / (n - 1)) * 2 - 1,
          dy = (y / (n - 1)) * 2 - 1,
          dz = (z / (n - 1)) * 2 - 1,
          len = Math.hypot(dx, dy, dz);
        dx /= len;
        dy /= len;
        dz /= len;
        let energy = power * (0.8 + random() * 0.4),
          px = p.x,
          py = p.y,
          pz = p.z;
        for (
          let step = 0;
          energy > 0 && step < 100;
          step++, px += dx * 0.3, py += dy * 0.3, pz += dz * 0.3
        ) {
          const bx = Math.floor(px),
            by = Math.floor(py),
            bz = Math.floor(pz);
          if (by <= 0 || !world.loaded(bx, bz)) break;
          const b = world.get(bx, by, bz),
            r = resistance(b);
          if (b !== B.AIR) energy -= (r + 0.3) * 0.3;
          if (energy > 0 && b !== B.AIR)
            cells.set(voxelKey(bx, by, bz), { x: bx, y: by, z: bz, b });
          energy -= 0.225;
        }
      }
  return [...cells.values()];
}
export function tntPattern(center, kind, count, spacing = 2) {
  const result = [],
    n = Math.min(64, Math.max(1, Math.floor(count)));
  const side = Math.ceil(Math.cbrt(n));
  for (let i = 0; i < n; i++) {
    let x = center.x,
      y = center.y,
      z = center.z;
    if (kind === 'ring') {
      const radius = Math.max(3, (n * spacing) / (Math.PI * 2)),
        a = (i / n) * Math.PI * 2;
      x += Math.round(Math.cos(a) * radius);
      z += Math.round(Math.sin(a) * radius);
    } else if (kind === 'cube') {
      x += (i % side) * spacing;
      y += Math.floor(i / (side * side)) * spacing;
      z += (Math.floor(i / side) % side) * spacing;
    } else if (kind === 'stack') y += i * spacing;
    else x += (i - (n - 1) / 2) * spacing;
    result.push({ x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) });
  }
  return result;
}
