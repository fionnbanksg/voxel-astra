import { B, isLava, isWater, waterHeight, occludes } from './blocks.js';
export const LIGHT_SIZE = 64;
export const LIGHT_COLORS = [
  [1, 0.68, 0.3],
  [1, 0.27, 0.045],
  [0.55, 0.2, 1],
];
export const lightType = (b) => (b === B.TORCH ? 0 : isLava(b) ? 1 : b === B.PORTAL ? 2 : -1);
/** Three bounded breadth-first floods. All sources of a type start together,
 * so each cell enters that type's queue at most once. Solid voxels block light.
 * Rebuilding this local volume handles removal without leaving stale light. */
export function propagateLight(voxels, size = LIGHT_SIZE, held = -1) {
  const count = size ** 3,
    plane = size * size,
    out = new Uint8Array(count * 4),
    queue = new Uint32Array(count),
    levels = new Uint8Array(count);
  for (let type = 0; type < 3; type++) {
    levels.fill(0);
    let head = 0,
      tail = 0;
    const strength = type === 1 ? 15 : type === 0 ? 14 : 12;
    for (let i = 0; i < count; i++)
      if (lightType(voxels[i]) === type || (type === 0 && i === held)) {
        levels[i] = strength;
        queue[tail++] = i;
      }
    const visit = (i, value) => {
      if (levels[i] || occludes(voxels[i])) return;
      levels[i] = value;
      queue[tail++] = i;
    };
    while (head < tail) {
      const i = queue[head++],
        value = levels[i] - 1;
      if (value <= 0) continue;
      const x = i % size,
        y = Math.floor(i / size) % size,
        z = Math.floor(i / plane);
      if (x > 0) visit(i - 1, value);
      if (x < size - 1) visit(i + 1, value);
      if (y > 0) visit(i - size, value);
      if (y < size - 1) visit(i + size, value);
      if (z > 0) visit(i - plane, value);
      if (z < size - 1) visit(i + plane, value);
    }
    const color = LIGHT_COLORS[type];
    for (let i = 0; i < count; i++) {
      const power = (levels[i] / 15) ** 2;
      for (let c = 0; c < 3; c++)
        out[i * 4 + c] = Math.min(255, out[i * 4 + c] + Math.round(power * color[c] * 255));
    }
  }
  // Reuse alpha for coarse water occupancy in the underwater distance pass.
  // This layout is x + size * (y + size * z), unlike chunk voxel storage.
  for (let i = 0; i < count; i++) {
    out[i * 4 + 3] = isWater(voxels[i])
      ? Math.round(
          (i % (size * size) < size * (size - 1) && isWater(voxels[i + size])
            ? 1
            : waterHeight(voxels[i])) * 255,
        )
      : 0;
  }
  return out;
}
