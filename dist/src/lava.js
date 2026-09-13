import { Fluids } from './fluids.js';
import { B, C, H, isLava, isWater, lavaLevel, flowingLava, voxelKey } from './blocks.js';
const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
/** Slow scheduled lava, sharing the bounded queue implementation with water.
 * Three horizontal cells in Overworld, seven in Nether; never renews sources. */
export class Lava extends Fluids {
  constructor(world) {
    const water = world.fluids,
      onEdit = world.onEdit,
      onChunkLoaded = world.onChunkLoaded;
    super(world);
    world.fluids = water;
    this.budget = 768;
    world.onEdit = (x, y, z, b, prev, record) => {
      onEdit?.(x, y, z, b, prev, record);
      this.urgentMode = record;
      this.wake(x, y, z);
      if (record)
        for (let dz = -4; dz <= 4; dz++)
          for (let dx = -4; dx <= 4; dx++)
            if (isLava(world.get(x + dx, y, z + dz))) this.wake(x + dx, y, z + dz);
      this.urgentMode = false;
    };
    world.onChunkLoaded = (c) => {
      onChunkLoaded?.(c);
      this.chunkLoaded(c);
    };
  }
  chunkLoaded(c) {
    for (const i of c.fluidFrontier || []) {
      const x = c.cx * C + (i % C),
        y = Math.floor(i / (C * C)),
        z = c.cz * C + (Math.floor(i / C) % C);
      if (isLava(this.world.get(x, y, z))) this.wake(x, y, z);
    }
    for (let y = 1; y < H; y++)
      for (let a = 0; a < C; a++)
        for (const [x, z] of [
          [0, a],
          [15, a],
          [a, 0],
          [a, 15],
        ]) {
          const wx = c.cx * C + x,
            wz = c.cz * C + z;
          if (isLava(this.world.get(wx, y, wz))) this.wake(wx, y, wz);
          for (const [dx, dz] of SIDES)
            if (isLava(this.world.get(wx + dx, y, wz + dz))) this.wake(wx + dx, y, wz + dz);
        }
  }
  passable(x, y, z) {
    if (y <= 0 || y >= H || !this.world.loaded(x, z)) return false;
    const b = this.world.get(x, y, z);
    return b === B.AIR || b === B.SNOW_LAYER || b === B.TORCH || (isLava(b) && b !== B.LAVA);
  }
  outlets(x, y, z) {
    const k = voxelKey(x, y, z);
    if (this.outletCache.has(k)) return this.outletCache.get(k);
    const result = [];
    this.outletCache.set(k, result);
    const max = this.world.dimension === 'nether' ? 7 : 3;
    if (this.canFall(x, y, z) || lavaLevel(this.world.get(x, y, z)) === max) return result;
    let best = Infinity;
    const candidates = [];
    for (const [dx, dz] of SIDES) {
      const sx = x + dx,
        sz = z + dz;
      if (!this.passable(sx, y, sz)) continue;
      const queue = [[sx, sz, 0]],
        seen = new Set([`${x},${z}`, `${sx},${sz}`]);
      let cost = Infinity;
      for (let head = 0; head < queue.length; head++) {
        const [qx, qz, depth] = queue[head];
        if (this.canFall(qx, y, qz)) {
          cost = depth;
          break;
        }
        if (depth >= (max === 3 ? 1 : 3)) continue;
        for (const [ax, az] of SIDES) {
          const nx = qx + ax,
            nz = qz + az,
            nk = `${nx},${nz}`;
          if (!seen.has(nk) && this.passable(nx, y, nz)) {
            seen.add(nk);
            queue.push([nx, nz, depth + 1]);
          }
        }
      }
      best = Math.min(best, cost);
      candidates.push({ dx, dz, cost });
    }
    for (const p of candidates) if (p.cost === best) result.push([p.dx, p.dz]);
    return result;
  }
  derive(x, y, z) {
    const w = this.world,
      b = w.get(x, y, z),
      above = w.get(x, y + 1, z);
    if (
      isLava(b) &&
      (isWater(above) || SIDES.some(([dx, dz]) => isWater(w.get(x + dx, y, z + dz))))
    )
      return b === B.LAVA ? B.OBSIDIAN : B.STONE;
    if (isWater(b) && isLava(above)) return B.STONE;
    if (b === B.LAVA) return b;
    if (b !== B.AIR && b !== B.SNOW_LAYER && b !== B.TORCH && !isLava(b)) return b;
    if (isLava(above)) return B.LAVA_FALLING;
    let best = 8;
    const max = w.dimension === 'nether' ? 7 : 3;
    for (const [dx, dz] of SIDES) {
      const nx = x + dx,
        nz = z + dz,
        n = w.get(nx, y, nz);
      if (!isLava(n)) continue;
      const nl = lavaLevel(n),
        level = nl === 8 ? 1 : nl + 1;
      if (
        level <= max &&
        level < best &&
        this.outlets(nx, y, nz).some(([ox, oz]) => ox === -dx && oz === -dz)
      )
        best = level;
    }
    return best <= max ? flowingLava(best) : b === B.SNOW_LAYER || b === B.TORCH ? b : B.AIR;
  }
  tick(dt) {
    this.stepSeconds = this.world.dimension === 'nether' ? 0.5 : 1.5;
    super.tick(dt);
  }
}
