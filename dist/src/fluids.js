import {
  B,
  C,
  H,
  idx,
  isWater,
  isLava,
  waterLevel,
  flowingWater,
  waterHeight,
  solid,
  voxelKey,
} from './blocks.js';
const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const AROUND = [
  [0, 0, 0],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
  [0, 1, 0],
  [0, -1, 0],
];

/** Scheduled, local cellular water. Natural and placed sources use identical rules.
 * Java-style assumptions: 5 game ticks/update, seven horizontal levels, downward
 * priority, four-cell slope search, and two adjacent sources over solid/source support.
 * Work budgets postpone updates; they never truncate or delete an active flow. */
export class Fluids {
  constructor(world) {
    this.world = world;
    this.pending = new Map();
    this.urgent = new Map();
    this.urgentMode = false;
    this.timer = 0;
    this.stepSeconds = 0.25;
    this.budget = 1536;
    this.outletCache = new Map();
    world.onEdit = (x, y, z, b, prev, playerEdit) => {
      const wasUrgent = this.urgentMode;
      this.urgentMode = playerEdit || wasUrgent;
      this.wake(x, y, z);
      if (playerEdit) {
        // A new hole can change the shortest slope route without changing the
        // intervening levels. Wake the nearby established stream as well.
        for (let dz = -8; dz <= 8; dz++)
          for (let dx = -8; dx <= 8; dx++)
            for (let dy = -1; dy <= 1; dy++)
              if (isWater(world.get(x + dx, y + dy, z + dz))) this.wake(x + dx, y + dy, z + dz);
      }
      this.urgentMode = wasUrgent;
    };
    world.onChunkLoaded = (chunk) => this.chunkLoaded(chunk);
    world.fluids = this;
  }
  reset() {
    this.urgent.clear();
    this.pending.clear();
    this.outletCache.clear();
    this.timer = 0;
  }
  schedule(x, y, z) {
    if (y <= 0 || y >= H || !this.world.loaded(x, z)) return;
    const k = voxelKey(x, y, z);
    if (this.urgentMode) {
      this.pending.delete(k);
      if (!this.urgent.has(k)) this.urgent.set(k, { x, y, z });
    } else if (!this.pending.has(k) && !this.urgent.has(k)) this.pending.set(k, { x, y, z });
  }
  wake(x, y, z) {
    for (const [dx, dy, dz] of AROUND) this.schedule(x + dx, y + dy, z + dz);
  }
  chunkLoaded(c) {
    // Generation reports active/exposed fluid cells. Wake shared chunk borders
    // again when their other half arrives, including edited levels replayed there.
    for (const i of c.fluidFrontier || [])
      this.wake(c.cx * C + (i % C), Math.floor(i / (C * C)), c.cz * C + (Math.floor(i / C) % C));
    for (let y = 1; y < H; y++)
      for (let a = 0; a < C; a++)
        for (const [x, z, dx, dz] of [
          [0, a, -1, 0],
          [15, a, 1, 0],
          [a, 0, 0, -1],
          [a, 15, 0, 1],
        ]) {
          const wx = c.cx * C + x,
            wz = c.cz * C + z;
          if (!this.world.loaded(wx + dx, wz + dz)) continue;
          const a = this.world.get(wx, y, wz),
            b = this.world.get(wx + dx, y, wz + dz);
          if (
            a !== b &&
            (isWater(a) || isWater(b)) &&
            (a === B.AIR || b === B.AIR || waterLevel(a) > 0 || waterLevel(b) > 0)
          ) {
            this.schedule(wx, y, wz);
            this.schedule(wx + dx, y, wz + dz);
          }
        }
  }
  passable(x, y, z) {
    if (y <= 0 || y >= H || !this.world.loaded(x, z)) return false;
    const b = this.world.get(x, y, z);
    return b === B.AIR || b === B.SNOW_LAYER || b === B.TORCH || (isWater(b) && b !== B.WATER);
  }
  canFall(x, y, z) {
    return this.passable(x, y - 1, z);
  }
  sourceNeighbors(x, y, z) {
    let n = 0;
    for (const [dx, dz] of SIDES) if (this.world.get(x + dx, y, z + dz) === B.WATER) n++;
    return n;
  }
  outlets(x, y, z) {
    const k = voxelKey(x, y, z);
    if (this.outletCache.has(k)) return this.outletCache.get(k);
    const b = this.world.get(x, y, z),
      level = waterLevel(b);
    const result = [];
    this.outletCache.set(k, result);
    if (level < 0 || level === 7 || (this.canFall(x, y, z) && this.sourceNeighbors(x, y, z) < 3))
      return result;
    // BFS chooses the nearest downward route, all ties included. No available
    // drop within four steps means the ordinary four-way spreading diamond.
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
        if (depth >= 3) continue;
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
      b = w.get(x, y, z);
    if (w.dimension === 'nether') return isWater(b) ? B.AIR : b;
    if (
      isLava(b) &&
      (isWater(w.get(x, y + 1, z)) || SIDES.some(([dx, dz]) => isWater(w.get(x + dx, y, z + dz))))
    )
      return b === B.LAVA ? B.OBSIDIAN : B.STONE;
    if (b === B.WATER) return b;
    if (b !== B.AIR && b !== B.SNOW_LAYER && b !== B.TORCH && !isWater(b)) return b;
    const support = w.get(x, y - 1, z);
    // Source regeneration happens before falling conversion, so a hole in a
    // supported lake floor refills from its neighboring natural sources.
    if (this.sourceNeighbors(x, y, z) >= 2 && (solid(support) || support === B.WATER))
      return B.WATER;
    if (isWater(w.get(x, y + 1, z))) return B.WATER_FALLING;
    let best = 8;
    for (const [dx, dz] of SIDES) {
      const nx = x + dx,
        nz = z + dz,
        nb = w.get(nx, y, nz);
      if (!isWater(nb)) continue;
      const nl = waterLevel(nb),
        level = nl === 8 ? 1 : nl + 1;
      if (level >= best) continue;
      if (this.outlets(nx, y, nz).some(([ox, oz]) => ox === -dx && oz === -dz)) best = level;
    }
    return best <= 7 ? flowingWater(best) : b === B.SNOW_LAYER || b === B.TORCH ? b : B.AIR;
  }
  tick(dt) {
    this.timer += dt;
    if (this.timer < this.stepSeconds) return;
    this.timer %= this.stepSeconds;
    const batch = [];
    // Snapshot the work list, not the whole world. Changes schedule the next
    // tick, preventing a waterfall from crossing a hundred blocks in one frame.
    for (const queue of [this.urgent, this.pending]) {
      for (const [k, p] of queue) {
        batch.push({ ...p, urgent: queue === this.urgent });
        queue.delete(k);
        if (batch.length >= this.budget) break;
      }
      if (batch.length >= this.budget) break;
    }
    this.outletCache.clear();
    for (const { x, y, z, urgent } of batch) {
      this.urgentMode = urgent;
      if (!this.world.loaded(x, z)) continue;
      const old = this.world.get(x, y, z),
        next = this.derive(x, y, z);
      if (next !== old) {
        // Store simulation edits too, so unloading cannot resurrect removed water.
        this.world.set(x, y, z, next, false, true);
        this.outletCache.clear();
      }
    }
    this.urgentMode = false;
  }
  // Match immersion to actual fluid depth, instead of treating a thin stream
  // as a full cube. The renderer additionally averages adjacent corner heights.
  contains(x, y, z) {
    const by = Math.floor(y),
      b = this.world.get(x, by, z);
    return isWater(b) && (isWater(this.world.get(x, by + 1, z)) || y - by < waterHeight(b));
  }
  current(x, y, z) {
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    const b = this.world.get(x, y, z);
    if (!isWater(b)) return { x: 0, y: 0, z: 0 };
    const h = waterHeight(b);
    let vx = 0,
      vz = 0;
    for (const [dx, dz] of SIDES) {
      const n = this.world.get(x + dx, y, z + dz);
      if (isWater(n)) {
        const slope = h - waterHeight(n);
        vx += dx * slope;
        vz += dz * slope;
      } else if (n === B.AIR && this.canFall(x + dx, y, z + dz)) {
        vx += dx;
        vz += dz;
      }
    }
    const len = Math.hypot(vx, vz) || 1;
    return { x: vx / len, y: b === B.WATER_FALLING ? -1 : 0, z: vz / len };
  }
}
