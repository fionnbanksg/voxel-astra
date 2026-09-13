import { isWater, waterHeight, occludes } from './blocks.js';
// Shared corner sampling means two neighboring fluid quads meet at the same
// height, including chunk borders. Deep/full neighbors get stronger weighting.
export function waterCorner(get, x, y, z, cornerX, cornerZ) {
  let sum = 0,
    weight = 0;
  for (let dz = cornerZ - 1; dz <= cornerZ; dz++)
    for (let dx = cornerX - 1; dx <= cornerX; dx++) {
      if (isWater(get(x + dx, y + 1, z + dz))) return 1;
      const b = get(x + dx, y, z + dz);
      if (occludes(b)) continue;
      const h = waterHeight(b),
        w = h >= 0.8 ? 10 : 1;
      sum += h * w;
      weight += w;
    }
  return weight ? sum / weight : 0;
}
export function flowVector(get, x, y, z) {
  const sample = (dx, dz) => waterHeight(get(x + dx, y, z + dz));
  let fx = sample(-1, 0) - sample(1, 0),
    fz = sample(0, -1) - sample(0, 1);
  const length = Math.hypot(fx, fz);
  if (length > 0.001) {
    fx /= length;
    fz /= length;
  }
  return [fx, fz];
}

// Match the top-face triangle split in mesh.js (00→11 diagonal), including
// the exact vertex wave phases. Bilinear interpolation makes a different surface.
export function waterWave(x, z, t) {
  return (
    Math.sin(x * 0.55 + t) * Math.cos(z * 0.61 + t * 0.7) * 0.018 +
    Math.sin(x * 1.3 + z * 0.8 - t * 1.1) * 0.007
  );
}
export function triangleWaterHeight(h, x, z) {
  return z >= x
    ? h[0] + x * (h[3] - h[2]) + z * (h[2] - h[0])
    : h[0] + x * (h[1] - h[0]) + z * (h[3] - h[1]);
}
