// Stable byte IDs. Save data stores these values, never display names.
export const B = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  WOOD: 5,
  LEAVES: 6,
  WATER: 7,
  SNOW: 8,
  OBSIDIAN: 9,
  NETHERRACK: 10,
  LAVA: 11,
  CRIMSON: 12,
  WARPED: 13,
  ORE: 14,
  PLANKS: 15,
  BRICK: 16,
  PORTAL: 17,
  BEDROCK: 18,
  SNOW_LAYER: 20,
  TORCH: 21,
  TNT: 22,
  LAVA_FLOW_1: 40,
  LAVA_FLOW_7: 46,
  LAVA_FALLING: 47,
  // Flow metadata fits in existing byte storage: source=7, levels 1–7=32–38.
  WATER_FLOW_1: 32,
  WATER_FLOW_7: 38,
  WATER_FALLING: 39,
};
export const C = 16,
  H = 128,
  S = 16,
  SEA = 35;
export const names = [
  'Air',
  'Grass',
  'Dirt',
  'Stone',
  'Sand',
  'Oak log',
  'Leaves',
  'Water source',
  'Snow',
  'Obsidian',
  'Netherrack',
  'Lava',
  'Crimson leaves',
  'Warped leaves',
  'Copper ore',
  'Oak planks',
  'Brick',
  'Portal',
  'Bedrock',
];
export const colors = [
  '#ffffff',
  '#86ad50',
  '#93704d',
  '#92979a',
  '#dbc88c',
  '#886139',
  '#749644',
  '#498fb0',
  '#e7f2f4',
  '#332a49',
  '#a44b49',
  '#ff8536',
  '#c04961',
  '#41acac',
  '#a59076',
  '#bb9360',
  '#af7160',
  '#ae66ed',
  '#4d5059',
];
export const isWater = (id) => id === B.WATER || (id >= 32 && id <= 39);
export const waterLevel = (id) =>
  id === B.WATER ? 0 : id === B.WATER_FALLING ? 8 : isWater(id) ? id - 31 : -1;
export const flowingWater = (level) =>
  level >= 8 ? B.WATER_FALLING : level === 0 ? B.WATER : 31 + level;
export const waterHeight = (id) => (!isWater(id) ? 0 : (8 - (waterLevel(id) & 7)) / 9);
export const isLava = (id) => id === B.LAVA || (id >= 40 && id <= 47);
export const lavaLevel = (id) => (id === B.LAVA ? 0 : id === 47 ? 8 : isLava(id) ? id - 39 : -1);
export const flowingLava = (level) => (level === 8 ? 47 : level === 0 ? B.LAVA : 39 + level);
export const lavaHeight = (id) => (isLava(id) ? (8 - (lavaLevel(id) & 7)) / 9 : 0);
names[22] = 'TNT';
colors[22] = '#d44b32';
names[21] = 'Torch';
colors[21] = '#ffc067';
names[20] = 'Snow dusting';
colors[20] = '#eff6ff';
for (let id = 40; id <= 47; id++) names[id] = id === 47 ? 'Falling lava' : 'Flowing lava';
export const foliage = (id) => id === B.LEAVES || id === B.CRIMSON || id === B.WARPED;
export const solid = (id) =>
  id !== B.AIR &&
  !isWater(id) &&
  !isLava(id) &&
  id !== B.PORTAL &&
  id !== B.SNOW_LAYER &&
  id !== B.TORCH;
// Rendering occlusion is deliberately distinct from collision solidity.
export const occludes = (id) => solid(id) && !foliage(id);
export const liquid = (id) => isWater(id) || isLava(id);
for (let id = 32; id <= 39; id++) names[id] = id === 39 ? 'Falling water' : 'Flowing water';
export const hotbar = [
  B.GRASS,
  B.STONE,
  B.WOOD,
  B.PLANKS,
  B.BRICK,
  B.SAND,
  B.LEAVES,
  B.WATER,
  B.OBSIDIAN,
];
export const key = (x, z) => `${x},${z}`;
export const voxelKey = (x, y, z) => `${x},${y},${z}`;
export const idx = (x, y, z) => x + C * (z + C * y);
export const mod = (x, n) => ((x % n) + n) % n;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
