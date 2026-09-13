import { B, C, H, idx, key } from './blocks.js';
import { LIGHT_SIZE } from './block-light.js';
/** One worker and one GPU 3D texture; lighting never rebuilds chunk meshes. */
export class Lighting {
  constructor(renderer, world, onError) {
    Object.assign(this, { renderer, world });
    this.busy = false;
    this.dirty = true;
    this.timer = 0;
    this.stamp = '';
    this.epoch = world.epoch;
    const onEdit = world.onEdit,
      onChunkLoaded = world.onChunkLoaded;
    world.onEdit = (...args) => {
      onEdit(...args);
      this.dirty = true;
    };
    world.onChunkLoaded = (c) => {
      onChunkLoaded(c);
      this.dirty = true;
    };
    this.worker = new Worker(new URL('./workers/light-worker.js', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = ({ data: m }) => {
      this.busy = false;
      if (m.epoch !== world.epoch) return;
      const texture = renderer.uniforms.uBlockLight.value;
      texture.image = { data: m.data, width: LIGHT_SIZE, height: LIGHT_SIZE, depth: LIGHT_SIZE };
      texture.needsUpdate = true;
      renderer.uniforms.uLightOrigin.value.set(...m.origin);
      renderer.uniforms.uLightSize.value = LIGHT_SIZE;
    };
    this.worker.onerror = (e) => {
      this.busy = false;
      onError('Local lighting failed: ' + e.message);
    };
  }
  update(dt, position, heldTorch) {
    this.timer += dt;
    const w = this.world,
      n = LIGHT_SIZE;
    if (this.epoch !== w.epoch) {
      this.epoch = w.epoch;
      this.dirty = true;
      this.stamp = '';
      this.renderer.uniforms.uLightSize.value = 0;
    }
    const origin = [
      Math.floor(position.x / 4) * 4 - n / 2,
      Math.floor(position.y / 4) * 4 - n / 2,
      Math.floor(position.z / 4) * 4 - n / 2,
    ];
    const hx = Math.floor(position.x) - origin[0],
      hy = Math.floor(position.y) - origin[1],
      hz = Math.floor(position.z) - origin[2],
      held = heldTorch ? hx + n * (hy + n * hz) : -1;
    const stamp = origin.join(',') + ':' + held;
    if (stamp !== this.stamp) this.dirty = true;
    if (this.busy || !this.dirty || this.timer < 0.1) return;
    this.timer = 0;
    this.dirty = false;
    this.stamp = stamp;
    this.busy = true;
    const voxels = new Uint8Array(n ** 3);
    voxels.fill(B.STONE); // Unloaded chunks block light.
    for (let z = 0; z < n; z++)
      for (let y = 0; y < n; y++) {
        const wy = origin[1] + y,
          wz = origin[2] + z,
          offset = n * (y + n * z);
        if (wy >= H) {
          voxels.fill(B.AIR, offset, offset + n);
          continue;
        }
        if (wy < 0) continue;
        for (let x = 0; x < n; ) {
          const wx = origin[0] + x,
            cx = Math.floor(wx / C),
            cz = Math.floor(wz / C),
            lx = wx - cx * C,
            lz = wz - cz * C,
            len = Math.min(C - lx, n - x),
            chunk = w.chunks.get(key(cx, cz));
          if (chunk?.data) {
            const from = idx(lx, wy, lz);
            voxels.set(chunk.data.subarray(from, from + len), offset + x);
          }
          x += len;
        }
      }
    this.worker.postMessage({ voxels: voxels.buffer, size: n, origin, held, epoch: w.epoch }, [
      voxels.buffer,
    ]);
  }
}
