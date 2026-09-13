import { clamp } from './blocks.js';
export const PRESETS = {
  wilds: {
    name: 'Wilds',
    description: 'A mix of mountains, rivers, forests and coasts.',
    relief: 1,
    trees: 1,
    seaLevel: 35,
    caves: true,
  },
  alpine: {
    name: 'Alpine',
    description: 'Snow-covered ridges and tall conifer forests.',
    relief: 1.25,
    trees: 1.15,
    seaLevel: 30,
    caves: true,
  },
  islands: {
    name: 'Islands',
    description: 'Scattered green islands surrounded by open water.',
    relief: 0.8,
    trees: 0.8,
    seaLevel: 40,
    caves: true,
  },
  dunes: {
    name: 'Dunes',
    description: 'Rolling dunes, sandstone-colored shores and dry hills.',
    relief: 0.65,
    trees: 0,
    seaLevel: 24,
    caves: true,
  },
  volcanic: {
    name: 'Volcanic',
    description: 'Dark peaks, glowing lava basins and crimson groves.',
    relief: 1.15,
    trees: 0.45,
    seaLevel: 32,
    caves: true,
  },
  flat: {
    name: 'Flat',
    description: 'An open grass plain for building without limits.',
    relief: 0,
    trees: 0,
    seaLevel: 24,
    caves: false,
  },
};
export function normalizeOptions(raw = {}) {
  const preset = Object.hasOwn(PRESETS, raw.preset) ? raw.preset : 'wilds',
    base = PRESETS[preset];
  return {
    preset,
    relief: clamp(Number.isFinite(+raw.relief) ? +raw.relief : base.relief, 0, 1.6),
    trees: clamp(Number.isFinite(+raw.trees) ? +raw.trees : base.trees, 0, 2),
    seaLevel: Math.round(
      clamp(Number.isFinite(+raw.seaLevel) ? +raw.seaLevel : base.seaLevel, 12, 60),
    ),
    caves: typeof raw.caves === 'boolean' ? raw.caves : base.caves,
  };
}
export function seedNumber(value) {
  const text = String(value).trim();
  if (!text) return 73191;
  if (/^-?\d+$/.test(text)) return Number(BigInt.asIntN(32, BigInt(text)));
  let n = 2166136261;
  for (const c of text) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return n | 0;
}
