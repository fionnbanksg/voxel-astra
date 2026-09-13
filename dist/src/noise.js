// Seeded gradient noise (Perlin family, the "or similar" terrain-noise option).
export function hash(x, y = 0, z = 0, seed = 73191) {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ seed;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10),
  lerp = (a, b, t) => a + (b - a) * t;
export function noise(x, y, z = 0, seed = 73191) {
  const X = Math.floor(x),
    Y = Math.floor(y),
    Z = Math.floor(z);
  x -= X;
  y -= Y;
  z -= Z;
  const grad = (dx, dy, dz) => {
    const h = Math.floor(hash(X + dx, Y + dy, Z + dz, seed) * 16);
    const a = x - dx,
      b = y - dy,
      c = z - dz,
      u = h < 8 ? a : b,
      v = h < 4 ? b : h === 12 || h === 14 ? a : c;
    return (h & 1 ? -u : u) + (h & 2 ? -v : v);
  };
  const u = fade(x),
    v = fade(y),
    w = fade(z);
  return lerp(
    lerp(lerp(grad(0, 0, 0), grad(1, 0, 0), u), lerp(grad(0, 1, 0), grad(1, 1, 0), u), v),
    lerp(lerp(grad(0, 0, 1), grad(1, 0, 1), u), lerp(grad(0, 1, 1), grad(1, 1, 1), u), v),
    w,
  );
}
export function fbm(x, z, seed = 73191) {
  return (
    noise(x, z, 0.37, seed) * 0.6 +
    noise(x * 2, z * 2, 2.9, seed + 1) * 0.28 +
    noise(x * 4, z * 4, 7.1, seed + 2) * 0.12
  );
}
