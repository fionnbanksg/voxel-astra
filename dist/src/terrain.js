import { CaveField, insideCave } from './caves.js';
import { B, C, H, SEA, idx, clamp } from './blocks.js';
import { noise, fbm, hash } from './noise.js';
import { normalizeOptions } from './world-options.js';
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const BIOMES = {
  plains: { density: 0.007, tree: 'oak' },
  forest: { density: 0.022, tree: 'oak' },
  desert: { density: 0, tree: null },
  taiga: { density: 0.018, tree: 'spruce' },
  mountains: { density: 0.003, tree: 'spruce' },
  ocean: { density: 0, tree: null },
  swamp: { density: 0.014, tree: 'willow' },
  river: { density: 0.004, tree: 'oak' },
  beach: { density: 0, tree: null },
  volcanic: { density: 0.016, tree: 'fungus' },
};
export function column(x, z, dimension = 'overworld', seed = 73191, options = {}) {
  const opt = normalizeOptions(options),
    sea = opt.seaLevel;
  if (dimension === 'nether') {
    const warped = noise(x * 0.018, z * 0.018, 1, seed) > 0;
    return {
      height: Math.floor(32 + fbm(x * 0.019, z * 0.019, seed) * 24),
      biome: warped ? 'warped' : 'crimson',
      color: warped ? [0.3, 0.76, 0.74] : [0.8, 0.28, 0.39],
      density: 0.023,
      tree: 'fungus',
      waterTop: 24,
    };
  }
  // Domain warping breaks up parallel-looking hills. Climate regions are now
  // roughly 80–180 blocks wide, rather than barely changing within view distance.
  const wx = x + noise(x * 0.006, z * 0.006, 4, seed + 2) * 30,
    wz = z + noise(x * 0.006, z * 0.006, 8, seed + 5) * 30;
  const t = clamp(0.5 + fbm(wx * 0.009 + 40, wz * 0.009, seed + 6) * 1.85, 0, 1);
  const u = clamp(0.5 + fbm(wx * 0.008, wz * 0.008 - 20, seed + 12) * 1.8, 0, 1);
  const continent = fbm(wx * 0.005, wz * 0.005, seed + 17);
  const mountain = smooth(-0.04, 0.34, fbm(wx * 0.01 + 87, wz * 0.01, seed + 3));
  const ridge = 1 - Math.abs(noise(wx * 0.024, wz * 0.024, 3, seed + 44));
  const rolling = fbm(wx * 0.02, wz * 0.02, seed) * 15;
  const dunes =
    (Math.sin(wx * 0.085 + noise(wx * 0.017, wz * 0.017, 1, seed) * 3) * 2 +
      fbm(wx * 0.035, wz * 0.035, seed + 51) * 7) *
    smooth(0.55, 0.8, t) *
    (1 - u);
  let h = SEA + 7 + continent * 46 + rolling + mountain * mountain * (26 + ridge * 38) + dunes;
  const riverField = Math.abs(noise(wx * 0.0055 + 16, wz * 0.0055 - 32, 0.7, seed + 30));
  const river = (1 - smooth(0.016, 0.05, riverField)) * (1 - smooth(0.28, 0.65, mountain));
  const coast = smooth(-0.28, -0.02, continent);
  h = h * (1 - river * coast) + (SEA - 3) * river * coast;
  h = sea + (h - SEA) * opt.relief;
  if (opt.preset === 'alpine') h += 12;
  if (opt.preset === 'islands')
    h = sea - 10 + Math.max(0, fbm(wx * 0.012, wz * 0.012, seed + 89) + 0.18) * 82 * opt.relief;
  if (opt.preset === 'dunes')
    h =
      sea +
      10 +
      Math.sin(wx * 0.06 + noise(wx * 0.013, wz * 0.013, 1, seed) * 2) * 4 +
      fbm(wx * 0.025, wz * 0.025, seed + 51) * 22 * opt.relief;
  if (opt.preset === 'volcanic')
    h =
      sea -
      5 +
      (1 - Math.abs(noise(wx * 0.009, wz * 0.009, 4, seed + 92))) ** 4 * 65 * opt.relief +
      rolling;
  if (opt.preset === 'flat') h = sea + 4;
  const height = Math.floor(clamp(h, 8, H - 20));
  let biome =
    height < sea - 2
      ? 'ocean'
      : river > 0.6 && height <= sea + 2
        ? 'river'
        : height <= sea + 1
          ? 'beach'
          : mountain > 0.63 || height > 77
            ? 'mountains'
            : t > 0.64 && u < 0.53
              ? 'desert'
              : t < 0.31
                ? 'taiga'
                : u > 0.73 && height < sea + 11
                  ? 'swamp'
                  : u > 0.49
                    ? 'forest'
                    : 'plains';
  if (opt.preset === 'alpine' && height > sea) biome = 'taiga';
  if (opt.preset === 'dunes') biome = 'desert';
  if (opt.preset === 'flat') biome = 'plains';
  if (opt.preset === 'volcanic') biome = 'volcanic';
  // Continuous tint: leaf palettes remain coherent through climate transitions.
  const color = [0.42 + t * 0.32 - u * 0.12, 0.62 + t * 0.18, 0.28 + (1 - t) * 0.25];
  return {
    height,
    biome,
    color,
    density: BIOMES[biome].density * opt.trees,
    tree: BIOMES[biome].tree,
    waterTop: sea,
    frozen:
      opt.preset === 'alpine' ||
      (!['volcanic', 'dunes', 'flat'].includes(opt.preset) && (biome === 'taiga' || height > 84)),
    temperature: t,
    humidity: u,
    mountain,
  };
}
export function generateChunk(cx, cz, dimension, seed, options = {}) {
  const opt = normalizeOptions(options);
  const data = new Uint8Array(C * C * H),
    columns = [];
  // Cache the extended column halo once; neighboring tree crowns use the same
  // climate/height at world coordinates and therefore have no chunk seams.
  const halo = new Map();
  const col = (x, z) => {
    const k = `${x},${z}`;
    if (!halo.has(k)) halo.set(k, column(cx * C + x, cz * C + z, dimension, seed, opt));
    return halo.get(k);
  };
  const caves =
    opt.caves && dimension === 'overworld'
      ? new CaveField(cx, cz, seed, (x, z) => column(x, z, dimension, seed, opt))
      : null;
  for (let z = 0; z < C; z++)
    for (let x = 0; x < C; x++) {
      const wx = cx * C + x,
        wz = cz * C + z,
        c = col(x, z);
      columns[x + z * C] = c;
      const passages = caves?.forColumn(wx, wz) || [];
      const ceiling = 101 + Math.floor(noise(wx * 0.02, wz * 0.02, 3, seed) * 10);
      const sandy = ['desert', 'ocean', 'beach', 'river'].includes(c.biome),
        rocky = c.biome === 'mountains' && c.height > 62,
        volcanic = c.biome === 'volcanic',
        snow = c.frozen;
      for (let y = 0; y < H; y++) {
        let b = B.AIR;
        if (y === 0) b = B.BEDROCK;
        else if (dimension === 'nether') {
          if (y <= c.height || y >= ceiling) b = B.NETHERRACK;
          if (
            y > 3 &&
            y < c.height - 3 &&
            noise(wx * 0.065, y * 0.072, wz * 0.065, seed + 23) > 0.42
          )
            b = B.AIR;
          if (!b && y <= 24) b = B.LAVA;
        } else {
          if (y <= c.height) {
            b =
              y === c.height
                ? volcanic
                  ? B.NETHERRACK
                  : snow
                    ? B.SNOW
                    : sandy
                      ? B.SAND
                      : rocky
                        ? B.STONE
                        : B.GRASS
                : y > c.height - 4
                  ? sandy
                    ? B.SAND
                    : rocky
                      ? B.STONE
                      : B.DIRT
                  : B.STONE;
            // Retain the new connected tunnels and surface entrances at normal scale.
            if (opt.caves && insideCave(passages, wx, y, wz)) b = B.AIR;
            else if (b === B.STONE && hash(wx, y, wz, seed) > 0.985) b = B.ORE;
          }
          // A shared groundwater level fills carved cave space as well as open
          // ocean columns. Generate sources directly rather than waiting for
          // seven-block surface flows to try to fill deep or roofed cavities.
          if (!b && y <= c.waterTop && (y > c.height || !volcanic)) b = volcanic ? B.LAVA : B.WATER;
        }
        data[idx(x, y, z)] = b;
      }
    }
  const put = (x, y, z, b) => {
    if (x >= 0 && x < C && z >= 0 && z < C && y > 0 && y < H) {
      const i = idx(x, y, z);
      if (data[i] === 0 || [B.LEAVES, B.CRIMSON, B.WARPED].includes(data[i])) data[i] = b;
    }
  };
  for (let z = -4; z < C + 4; z++)
    for (let x = -4; x < C + 4; x++) {
      const wx = cx * C + x,
        wz = cz * C + z,
        c = col(x, z),
        chance = hash(wx, 77, wz, seed);
      if (c.height <= (dimension === 'nether' ? 25 : c.waterTop + 1) || chance >= c.density)
        continue;
      const h =
        c.tree === 'spruce'
          ? 7 + Math.floor(hash(wx, 19, wz, seed) * 4)
          : 4 + Math.floor(hash(wx, 19, wz, seed) * 3);
      const leaf =
        dimension === 'nether'
          ? c.biome === 'warped'
            ? B.WARPED
            : B.CRIMSON
          : c.biome === 'volcanic'
            ? B.CRIMSON
            : B.LEAVES;
      if (caves && insideCave(caves.forColumn(wx, wz), wx, c.height, wz)) continue;
      if (c.tree === 'spruce') {
        for (let dy = 2; dy <= h + 1; dy++) {
          const r = Math.max(0, Math.min(3, Math.floor((h + 1 - dy) / 2)));
          for (let dz = -r; dz <= r; dz++)
            for (let dx = -r; dx <= r; dx++)
              if (Math.abs(dx) + Math.abs(dz) <= r + 1) put(x + dx, c.height + dy, z + dz, leaf);
        }
      } else {
        const radius = c.tree === 'willow' ? 3 : 2;
        for (let dy = h - 2; dy <= h + 1; dy++)
          for (let dz = -radius; dz <= radius; dz++)
            for (let dx = -radius; dx <= radius; dx++)
              if (Math.abs(dx) + Math.abs(dz) + (dy === h + 1 ? 2 : 0) < radius * 2)
                put(x + dx, c.height + dy, z + dz, leaf);
        if (c.tree === 'willow')
          for (let dx = -3; dx <= 3; dx++)
            for (const dz of [-3, 3])
              for (let dy = h - 4; dy < h; dy++)
                if (hash(wx + dx, 8, wz + dz, seed) > 0.35)
                  put(x + dx, c.height + dy, z + dz, leaf);
      }
      for (let dy = 1; dy <= h; dy++) put(x, c.height + dy, z, B.WOOD);
    }
  if (dimension === 'overworld')
    for (let z = 0; z < C; z++)
      for (let x = 0; x < C; x++)
        if (columns[x + z * C].frozen) {
          for (let y = H - 2; y > 0; y--)
            if (data[idx(x, y, z)] !== B.AIR) {
              if (data[idx(x, y, z)] === B.LEAVES) data[idx(x, y + 1, z)] = B.SNOW_LAYER;
              break;
            }
        }
  return { data, columns };
}
