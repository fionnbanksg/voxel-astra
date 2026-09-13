import { C, H, S, B, key, idx, mod, solid, occludes, foliage } from './blocks.js';
import { Chunk } from './chunk.js';
import { normalizeOptions, seedNumber } from './world-options.js';
import { column } from './terrain.js';
export class World {
  constructor(renderer, onError) {
    this.renderer = renderer;
    this.chunks = new Map();
    this.edits = new Map();
    this.dimension = 'overworld';
    this.seed = 73191;
    this.options = normalizeOptions();
    this.radius = 8;
    this.epoch = 0;
    this.center = [0, 0];
    this.streamStamp = '';
    this.wanted = [];
    this.onEdit = () => {};
    this.onChunkLoaded = () => {};
    this.workers = [];
    this.uploads = [];
    const count = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    for (let i = 0; i < count; i++) {
      const worker = new Worker(new URL('./workers/chunk-worker.js', import.meta.url), {
        type: 'module',
      });
      const slot = { worker, busy: false };
      worker.onmessage = (e) => this.receive(slot, e.data);
      worker.onerror = (e) => {
        slot.busy = false;
        onError('Terrain worker failed: ' + e.message);
      };
      this.workers.push(slot);
    }
    this.onError = onError;
  }
  column(x, z) {
    return column(x, z, this.dimension, this.seed, this.options);
  }
  regenerate(seed, options) {
    this.seed = seedNumber(seed);
    this.options = normalizeOptions(options);
    this.edits.clear();
    this.switchDimension('overworld');
  }
  editKey(cx, cz) {
    return `${this.dimension}:${key(cx, cz)}`;
  }
  get(x, y, z) {
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    if (y < 0) return B.BEDROCK;
    if (y >= H) return B.AIR;
    return (
      this.chunks.get(key(Math.floor(x / C), Math.floor(z / C)))?.data?.[
        idx(mod(x, C), y, mod(z, C))
      ] ?? B.AIR
    );
  }
  loaded(x, z) {
    return !!this.chunks.get(key(Math.floor(x / C), Math.floor(z / C)))?.data;
  }
  collides(x, y, z) {
    if (y < 0) return true;
    if (y >= H) return false;
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    const c = this.chunks.get(key(Math.floor(x / C), Math.floor(z / C))),
      sy = Math.floor(y / S);
    if (!c?.data || !c.sections.has(sy) || solid(this.get(x, y, z))) return true;
    const i = idx(mod(x, C), y, mod(z, C)),
      gate = c.pendingOpen.get(i);
    if (gate) {
      if (
        gate.some(
          ([chunk, section, revision]) => chunk.data && chunk.appliedRevisions[section] < revision,
        )
      )
        return true;
      c.pendingOpen.delete(i);
    }
    return !!c.visibleSolids.get(sy)?.[i % (C * C * S)];
  }
  set(x, y, z, b, record = true, persist = record) {
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    if (y <= 0 || y >= H) return false;
    const cx = Math.floor(x / C),
      cz = Math.floor(z / C),
      c = this.chunks.get(key(cx, cz));
    if (!c?.data) return false;
    const i = idx(mod(x, C), y, mod(z, C)),
      prev = c.data[i];
    if (prev === b) return false;
    c.data[i] = b;
    c.revision++;
    if (persist) {
      const k = this.editKey(cx, cz);
      if (!this.edits.has(k)) this.edits.set(k, new Map());
      this.edits.get(k).set(i, b);
    }
    // A 3×3×3 influence box covers changed faces AND diagonally adjacent AO.
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const n = this.chunks.get(key(Math.floor((x + dx) / C), Math.floor((z + dz) / C)));
          const sy = Math.floor((y + dy) / S);
          if (n?.data && sy >= 0 && sy < H / S) {
            n.dirty.add(sy);
            n.sectionRevisions[sy]++;
            if (occludes(prev) !== occludes(b) || foliage(prev) !== foliage(b))
              for (let below = 0; below <= Math.floor(y / S); below++) {
                n.dirty.add(below);
                n.sectionRevisions[below]++;
              }
          }
        }
    if (solid(prev) && !solid(b)) {
      // Opening collision before all newly exposed faces arrive lets the camera
      // enter an old culled mesh. Gate only this hole, not the surrounding air.
      const deps = new Map();
      for (const [dx, dy, dz] of [
        [0, 0, 0],
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ]) {
        const n = this.chunks.get(key(Math.floor((x + dx) / C), Math.floor((z + dz) / C))),
          section = Math.floor((y + dy) / S);
        if (n?.data && section >= 0 && section < H / S)
          deps.set(`${n.cx},${n.cz},${section}`, [n, section, n.sectionRevisions[section]]);
      }
      c.pendingOpen.set(i, [...deps.values()]);
      for (const [chunk, section] of deps.values()) chunk.urgentSections.add(section);
    }
    this.onEdit(x, y, z, b, prev, record);
    return true;
  }
  ground(x, z, start = H - 3) {
    for (let y = Math.min(H - 3, Math.floor(start)); y > 0; y--)
      if (
        solid(this.get(x, y, z)) &&
        !solid(this.get(x, y + 1, z)) &&
        !solid(this.get(x, y + 2, z))
      )
        return y + 1;
    return 40;
  }
  update(px, pz) {
    const cx = Math.floor(px / C),
      cz = Math.floor(pz / C);
    this.center = [cx, cz];
    const focus = (this.networkFocus || []).map((p) => ({
      cx: Math.floor(p.x / C),
      cz: Math.floor(p.z / C),
    }));
    const stamp =
      `${cx},${cz},${this.radius},${this.epoch}:` + focus.map((p) => `${p.cx},${p.cz}`).join(';');
    if (stamp !== this.streamStamp) {
      this.streamStamp = stamp;
      this.wanted = [];
      for (let dz = -this.radius; dz <= this.radius; dz++)
        for (let dx = -this.radius; dx <= this.radius; dx++)
          if (dx * dx + dz * dz <= this.radius * this.radius)
            this.wanted.push({ cx: cx + dx, cz: cz + dz, d: dx * dx + dz * dz });
      // Keep a small simulation neighborhood loaded around each guest. Their
      // own browser independently streams its full visual render distance.
      const wantedKeys = new Set(this.wanted.map((p) => key(p.cx, p.cz)));
      for (const p of focus)
        for (let dz = -2; dz <= 2; dz++)
          for (let dx = -2; dx <= 2; dx++) {
            const k = key(p.cx + dx, p.cz + dz);
            if (wantedKeys.has(k)) continue;
            wantedKeys.add(k);
            this.wanted.push({ cx: p.cx + dx, cz: p.cz + dz, d: 4 + dx * dx + dz * dz });
          }
      this.wanted.sort((a, b) => a.d - b.d);
      for (const [k, c] of this.chunks)
        if (
          Math.hypot(c.cx - cx, c.cz - cz) > this.radius + 2 &&
          !focus.some((p) => Math.max(Math.abs(c.cx - p.cx), Math.abs(c.cz - p.cz)) <= 3)
        ) {
          c.dispose(this.renderer);
          this.workers[c.owner].worker.postMessage({ type: 'drop', key: k });
          this.chunks.delete(k);
        }
    }
    // Limit geometry uploads per frame. Typed buffers are transferred from workers.
    const deadline = performance.now() + 3;
    for (let n = 0; n < 4 && this.uploads.length && performance.now() < deadline; n++) {
      const m = this.uploads.shift();
      const c = this.chunks.get(m.key);
      if (c && m.epoch === this.epoch) {
        if (m.sections.every((s) => s.revision === c.sectionRevisions[s.sy])) {
          c.apply(m.sections, this.renderer, m.final);
          for (const [i, deps] of c.pendingOpen)
            if (
              deps.every(
                ([chunk, section, revision]) =>
                  !chunk.data || chunk.appliedRevisions[section] >= revision,
              )
            )
              c.pendingOpen.delete(i);
        } else for (const s of m.sections) c.dirty.add(s.sy);
      }
    }
    this.dispatch();
  }
  dispatch() {
    if (this.uploads.length > 12) return;
    for (let i = 0; i < this.workers.length; i++) {
      const slot = this.workers[i];
      if (slot.busy) continue;
      const dirty = [...this.chunks.entries()]
        .filter(([, c]) => c.owner === i && c.data && c.dirty.size && !c.meshing)
        .sort(
          (a, b) =>
            Number(b[1].urgentSections.size > 0) - Number(a[1].urgentSections.size > 0) ||
            (a[1].cx - this.center[0]) ** 2 +
              (a[1].cz - this.center[1]) ** 2 -
              ((b[1].cx - this.center[0]) ** 2 + (b[1].cz - this.center[1]) ** 2),
        );
      if (dirty.length) {
        const [k, c] = dirty[0];
        const neighbors = {};
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++)
            if (dx || dz) {
              const n = this.chunks.get(key(c.cx + dx, c.cz + dz));
              if (n?.data) neighbors[key(dx, dz)] = n.data;
            }
        slot.busy = true;
        c.meshing = true;
        slot.chunk = c;
        const urgent = [...c.dirty].filter((sy) => c.urgentSections.has(sy));
        const sections = urgent.length ? urgent : [...c.dirty];
        for (const sy of sections) c.dirty.delete(sy);
        slot.worker.postMessage({
          type: 'mesh',
          key: k,
          epoch: this.epoch,
          revision: c.revision,
          revisions: [...c.sectionRevisions],
          data: c.data,
          sections,
          neighbors,
        });
        continue;
      }
      const next = this.wanted.find((p) => !this.chunks.has(key(p.cx, p.cz)));
      if (!next) continue;
      const k = key(next.cx, next.cz),
        c = new Chunk(next.cx, next.cz, i);
      this.chunks.set(k, c);
      slot.busy = true;
      slot.chunk = c;
      slot.worker.postMessage({
        type: 'generate',
        key: k,
        cx: c.cx,
        cz: c.cz,
        dimension: this.dimension,
        seed: this.seed,
        options: this.options,
        epoch: this.epoch,
        edits: [...(this.edits.get(this.editKey(c.cx, c.cz)) || [])],
      });
    }
  }
  receive(slot, m) {
    slot.busy = false;
    if (m.epoch !== this.epoch) return;
    const c = this.chunks.get(m.key);
    if (!c || (slot.chunk && slot.chunk !== c)) return;
    if (m.type === 'error') {
      this.onError(m.message);
      return;
    }
    if (m.type === 'generated') {
      c.data = m.data;
      // Network edits can arrive after a generation job was dispatched.
      // Replay the current delta map before exposing the new voxel mirror.
      for (const [i, b] of this.edits.get(this.editKey(c.cx, c.cz)) || []) c.data[i] = b;
      c.columns = m.columns;
      c.fluidFrontier = m.fluidFrontier || [];
      this.onChunkLoaded(c);
      for (let s = 0; s < H / S; s++) {
        c.dirty.add(s);
        c.sectionRevisions[s]++;
      }
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const n = this.chunks.get(key(c.cx + dx, c.cz + dz));
          if (n?.data)
            for (let s = 0; s < H / S; s++) {
              n.dirty.add(s);
              n.sectionRevisions[s]++;
            }
        }
    } else if (m.type === 'meshed') {
      c.meshing = false;
      // An unrelated edit elsewhere in a tall chunk must not starve this section.
      for (const s of m.sections) {
        if (s.revision !== c.sectionRevisions[s.sy]) {
          c.dirty.add(s.sy);
          continue;
        }
        const upload = { ...m, sections: [s], final: true };
        if (c.urgentSections.has(s.sy)) this.uploads.unshift(upload);
        else this.uploads.push(upload);
      }
    }
  }
  switchDimension(d) {
    this.dimension = d;
    this.epoch++;
    for (const c of this.chunks.values()) c.dispose(this.renderer);
    this.chunks.clear();
    this.uploads = [];
    for (const slot of this.workers) {
      slot.worker.postMessage({ type: 'reset' }); /* In-flight completion frees the slot. */
    }
    this.renderer.setDimension(d);
  }
  get readyCount() {
    let n = 0;
    for (const c of this.chunks.values()) if (c.ready) n++;
    return n;
  }
}
