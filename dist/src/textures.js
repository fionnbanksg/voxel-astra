import { B, colors, foliage } from './blocks.js';
import { hash } from './noise.js';
// Original 16×16 pixel textures with small palettes and connected pixel clusters.
// Every tile is deterministic; no downloaded Minecraft assets are required.
export const LOG_END = 24;
export function leafPixelVisible(x, y, b) {
  return hash(Math.floor(x / 2), Math.floor(y / 2), b) < 0.68 || (x === 7 && y % 4 !== 0);
}
const palettes = {
  stone: ['#747474', '#808080', '#898989', '#939393', '#a0a0a0'],
  dirt: ['#69472d', '#795438', '#89613f', '#996d49', '#a47b56'],
  grass: ['#969696', '#a7a7a7', '#b6b6b6', '#c5c5c5', '#d0d0d0'],
  sand: ['#cbbb83', '#d5c791', '#ddd09f', '#e5d9aa', '#ebe0b5'],
  snow: ['#d3e0e8', '#dce8ee', '#e6eff3', '#f0f5f7', '#f7fafb'],
  bark: ['#493a23', '#59472b', '#695333', '#78603b', '#897046'],
  wood: ['#967044', '#a27d4d', '#b08a56', '#bd975f', '#c9a56b'],
  nether: ['#522829', '#653032', '#773b3b', '#864544', '#96504c'],
  obsidian: ['#191423', '#231c31', '#30273e', '#3d3150', '#4b3c60'],
  leaf: ['#777777', '#8a8a8a', '#a1a1a1', '#b5b5b5', '#c7c7c7'],
  crimson: ['#622737', '#7b3044', '#943b50', '#a94d60', '#bd6073'],
  warped: ['#215d56', '#286f65', '#358577', '#43998a', '#60aea0'],
};
const pick = (p, v) => p[Math.min(p.length - 1, Math.max(0, Math.floor(v * p.length)))];
function cluster(x, y, salt) {
  // Offset paired rows: broad clusters with a few restrained individual pixels.
  const coarse = hash(Math.floor((x + (Math.floor(y / 2) % 2)) / 2), Math.floor(y / 2), salt);
  return coarse * 0.82 + hash(x, y, salt + 81) * 0.18;
}
function stone(x, y) {
  return pick(palettes.stone, cluster(x, y, 3));
}
function dirt(x, y) {
  if (hash(Math.floor(x / 2), Math.floor(y / 2), 17) > 0.94)
    return ['#77776b', '#969486'][(x + y) % 2];
  return pick(palettes.dirt, cluster(x, y, 2));
}
export function tilePixel(tile, x, y) {
  const n = cluster(x, y, tile + 31);
  if (foliage(tile)) {
    if (!leafPixelVisible(x, y, tile)) return null;
    const p =
      tile === B.LEAVES ? palettes.leaf : tile === B.CRIMSON ? palettes.crimson : palettes.warped;
    const edge =
      !leafPixelVisible((x + 1) % 16, y, tile) || !leafPixelVisible(x, (y + 1) % 16, tile);
    return pick(p, edge ? 0.12 : n * 0.75 + 0.22);
  }
  if (tile === B.GRASS) return pick(palettes.grass, cluster(x, y, 11));
  if (tile === 19) {
    const rim = 3 + Math.floor(hash(Math.floor(x / 2), 4, 9) * 3);
    if (y < rim)
      return pick(['#4c7931', '#598638', '#659342', '#729e49', '#7ca653'], cluster(x, y, 11));
    if (y === rim) return '#5e492d';
    return dirt(x, y);
  }
  if (tile === B.DIRT) return dirt(x, y);
  if (tile === B.STONE) return stone(x, y);
  if (tile === B.SAND) return pick(palettes.sand, n * 0.8 + 0.1);
  if (tile === B.SNOW || tile === B.SNOW_LAYER) return pick(palettes.snow, n * 0.7 + 0.3);
  if (tile === B.WOOD) {
    const strand = (x + Math.floor(hash(Math.floor(y / 5), 2, 31) * 2)) % 5;
    return pick(palettes.bark, strand === 0 ? 0.08 : strand === 1 ? 0.28 : 0.4 + n * 0.6);
  }
  if (tile === LOG_END) {
    const r = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (r > 6.5) return palettes.bark[(x + y) % 3];
    if (Math.floor(r) % 2 === 0) return pick(palettes.wood, 0.1 + n * 0.35);
    return pick(palettes.wood, 0.55 + n * 0.4);
  }
  if (tile === B.PLANKS) {
    const row = Math.floor(y / 4),
      join = (x + (row % 2) * 8) % 16;
    if (y % 4 === 3 || join === 0) return '#79552f';
    if (y % 4 === 0) return '#c6a16a';
    return pick(palettes.wood, 0.25 + hash(Math.floor(x / 3), y, tile) * 0.65);
  }
  if (tile === B.BRICK) {
    const row = Math.floor(y / 4),
      bx = (x + (row % 2) * 4) % 8;
    if (y % 4 === 3 || bx === 0) return '#adaca1';
    if (y % 4 === 0) return '#b26b50';
    return pick(['#804536', '#8f4c39', '#9c543d', '#aa6046'], n);
  }
  if (tile === B.ORE) {
    // Four distinct copper flecks, each several pixels wide, on the stone tile.
    for (const [cx, cy] of [
      [3, 3],
      [11, 5],
      [6, 11],
      [13, 13],
    ]) {
      const dx = x - cx,
        dy = y - cy;
      if (Math.abs(dx) + Math.abs(dy) <= 2 && Math.abs(dx) <= 1)
        return dy < 0 ? '#d99555' : dx < 0 ? '#729986' : dy > 0 ? '#976043' : '#bf7d49';
    }
    return stone(x, y);
  }
  if (tile === B.NETHERRACK) return pick(palettes.nether, n);
  if (tile === B.OBSIDIAN) return pick(palettes.obsidian, cluster(x, y, 87));
  if (tile === B.BEDROCK)
    return pick(['#303030', '#414141', '#606060', '#818181'], cluster(x, y, 18));
  if (tile === B.TORCH)
    return y < 5
      ? ['#fff0b3', '#ffc65d', '#ef9234'][Math.floor(y / 2)]
      : x % 3 === 0
        ? '#604021'
        : '#966530';
  return colors[tile] || '#ffffff';
}
