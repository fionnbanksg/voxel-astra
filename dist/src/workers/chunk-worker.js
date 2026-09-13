import { generateChunk } from '../terrain.js';
import { meshSection } from '../mesh.js';
import { C, H, S, idx, mod, isWater, liquid, solid } from '../blocks.js';
// Workers retain authoritative voxel arrays for their assigned chunks. Boundary
// snapshots are supplied by World; no scene objects or GPU work runs here.
const chunks = new Map();
self.onmessage = ({ data: m }) => {
  try {
    if (m.type === 'drop') {
      chunks.delete(m.key);
      return;
    }
    if (m.type === 'reset') {
      chunks.clear();
      return;
    }
    if (m.type === 'generate') {
      const c = generateChunk(m.cx, m.cz, m.dimension, m.seed, m.options);
      for (const [i, b] of m.edits || []) c.data[i] = b;
      const fluidFrontier = [];
      for (let y = 1; y < H; y++)
        for (let z = 0; z < C; z++)
          for (let x = 0; x < C; x++) {
            const i = idx(x, y, z);
            if (!liquid(c.data[i])) continue;
            if (
              (c.data[i] !== 7 && c.data[i] !== 11) ||
              !c.data[idx(x, y - 1, z)] ||
              (x > 0 && !c.data[i - 1]) ||
              (x < 15 && !c.data[i + 1]) ||
              (z > 0 && !c.data[i - C]) ||
              (z < 15 && !c.data[i + C])
            )
              fluidFrontier.push(i);
          }
      chunks.set(m.key, c);
      self.postMessage({
        type: 'generated',
        key: m.key,
        epoch: m.epoch,
        data: c.data.slice(),
        columns: c.columns,
        fluidFrontier,
      });
    } else if (m.type === 'mesh') {
      const c = chunks.get(m.key);
      if (!c) throw Error('Missing worker chunk ' + m.key);
      if (m.data) c.data = new Uint8Array(m.data);
      const neighbors = m.neighbors || {};
      const get = (x, y, z) => {
        if (y < 0 || y >= H) return 0;
        if (x >= 0 && x < C && z >= 0 && z < C) return c.data[idx(x, y, z)];
        const a = neighbors[`${Math.floor(x / C)},${Math.floor(z / C)}`];
        return a ? a[idx(mod(x, C), y, mod(z, C))] : 0;
      };
      const sections = m.sections.map((sy) => {
        const section = meshSection(get, sy, c.columns);
        section.revision = m.revisions?.[sy] ?? m.revision;
        section.collision = c.data
          .slice(sy * C * C * S, (sy + 1) * C * C * S)
          .map((b) => (solid(b) ? 1 : 0));
        return section;
      });
      const transfer = [];
      for (const s of sections)
        for (const kind of ['opaque', 'cutout', 'water', 'effects'])
          for (const array of Object.values(s[kind])) transfer.push(array.buffer);
      for (const s of sections) transfer.push(s.collision.buffer);
      self.postMessage(
        { type: 'meshed', key: m.key, epoch: m.epoch, revision: m.revision, sections },
        transfer,
      );
    }
  } catch (e) {
    self.postMessage({ type: 'error', key: m.key, epoch: m.epoch, message: e.message });
  }
};
