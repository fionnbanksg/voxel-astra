import {
  B,
  C,
  H,
  S,
  solid,
  liquid,
  isWater,
  isLava,
  lavaHeight,
  foliage,
  occludes,
} from './blocks.js';
import { LOG_END } from './textures.js';
import { waterCorner, flowVector } from './water-mesh.js';
// Counter-clockwise face bases: cross(u,v)=normal. AO samples the two side
// neighbors plus their shared diagonal in the outside plane of each corner.
const faces = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] },
];
export function cornerAO(a, b, c) {
  return a && b ? 0 : 3 - Number(a) - Number(b) - Number(c);
}
export function meshSection(get, sy, columns) {
  const empty = () => ({ p: [], n: [], c: [], uv: [], i: [], flow: [], kind: [], sky: [] });
  const opaque = empty(),
    water = empty(),
    cutout = empty(),
    effects = empty();
  // Vertical skylight supplies cave/canopy occlusion independently of local AO.
  const P = C + 2,
    sunlight = new Float32Array(P * P * H);
  for (let z = -1; z <= C; z++)
    for (let x = -1; x <= C; x++) {
      let light = 1;
      for (let y = H - 1; y >= 0; y--) {
        sunlight[x + 1 + P * (z + 1 + P * y)] = light;
        const b = get(x, y, z);
        if (occludes(b)) light = 0.08;
        else if (foliage(b)) light = Math.max(0.18, light * 0.87);
      }
    }
  for (let y = sy * S; y < Math.min((sy + 1) * S, H); y++)
    for (let z = 0; z < C; z++)
      for (let x = 0; x < C; x++) {
        const b = get(x, y, z);
        if (!b) continue;
        for (const f of faces) {
          const [nx, ny, nz] = f.n,
            adj = get(x + nx, y + ny, z + nz);
          if (
            isWater(b)
              ? isWater(adj) || occludes(adj)
              : b === B.PORTAL
                ? adj === b || occludes(adj)
                : isLava(b)
                  ? isLava(adj) || occludes(adj)
                  : occludes(adj)
          )
            continue;
          if (foliage(b) && foliage(adj) && nx + ny + nz < 0) continue; // One double-sided internal leaf plane, no coplanar duplicate.
          const out = isWater(b)
            ? water
            : foliage(b)
              ? cutout
              : liquid(b) || b === B.PORTAL || b === B.TORCH
                ? effects
                : opaque;
          const base = out.p.length / 3,
            ao = [];
          const current = isWater(b) ? flowVector(get, x, y, z) : [0, 0];
          let depth = 0;
          if (isWater(b)) while (depth < 8 && isWater(get(x, y - depth, z))) depth++;
          const col = columns[x + z * C]?.color || [0.6, 0.8, 0.4];
          const tint =
            (b === B.GRASS && ny === 1) || b === B.LEAVES
              ? col
              : isWater(b)
                ? [0.78 + col[0] * 0.2, 0.87 + col[1] * 0.1, 1]
                : [1, 1, 1];
          const shade = 1; // Sun direction is evaluated dynamically in the terrain shader.
          for (const [a, d] of [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ]) {
            const su = a ? 1 : -1,
              sv = d ? 1 : -1;
            const side1 = occludes(
                get(x + nx + f.u[0] * su, y + ny + f.u[1] * su, z + nz + f.u[2] * su),
              ),
              side2 = occludes(
                get(x + nx + f.v[0] * sv, y + ny + f.v[1] * sv, z + nz + f.v[2] * sv),
              );
            const corner = occludes(
              get(
                x + nx + f.u[0] * su + f.v[0] * sv,
                y + ny + f.u[1] * su + f.v[1] * sv,
                z + nz + f.u[2] * su + f.v[2] * sv,
              ),
            );
            const oc = solid(b) ? cornerAO(side1, side2, corner) : 3;
            ao.push(oc);
            const light = shade * (0.48 + oc * 0.1733);
            let px = x + 0.5 + nx * 0.5 + f.u[0] * (a - 0.5) + f.v[0] * (d - 0.5),
              py = y + 0.5 + ny * 0.5 + f.u[1] * (a - 0.5) + f.v[1] * (d - 0.5),
              pz = z + 0.5 + nz * 0.5 + f.u[2] * (a - 0.5) + f.v[2] * (d - 0.5);
            if (isWater(b) && py > y + 0.5)
              py = y + waterCorner(get, x, y, z, Math.round(px - x), Math.round(pz - z));
            else if (isLava(b) && !isLava(get(x, y + 1, z)) && py > y + 0.5) py = y + lavaHeight(b);
            else if (b === B.SNOW_LAYER && py > y + 0.5) py = y + 0.125;
            if (b === B.TORCH) {
              px = x + 0.5 + (px - x - 0.5) * 0.18;
              pz = z + 0.5 + (pz - z - 0.5) * 0.18;
              py = y + (py - y) * 0.85;
            }
            out.flow.push(current[0], current[1]);
            out.kind.push(isWater(b) ? depth : isLava(b) ? B.LAVA : b);
            const lightIndex =
              x + nx + 1 + P * (z + nz + 1 + P * Math.max(0, Math.min(H - 1, y + ny)));
            out.sky.push(sunlight[lightIndex]);
            out.p.push(px, py, pz);
            out.n.push(nx, ny, nz);
            out.c.push(tint[0] * light, tint[1] * light, tint[2] * light);
            // Grass sides have their own tile; 8×4 tiles with half-pixel inset.
            const tile = isWater(b)
              ? B.WATER
              : b === B.GRASS && ny !== 1
                ? ny === -1
                  ? B.DIRT
                  : 19
                : isLava(b)
                  ? B.LAVA
                  : b === B.WOOD && ny !== 0
                    ? LOG_END
                    : b === B.TNT && ny !== 0
                      ? 23
                      : b;
            // +X/-Z face bases use their U axis vertically. Swap UV axes so
            // bark, plank courses and grass rims stay upright on every wall.
            const swap = ny === 0 && f.u[1] !== 0,
              texU = swap ? d : a,
              texV = swap ? a : d;
            out.uv.push(
              ((tile % 8) * 16 + 0.5 + texU * 15) / 128,
              1 - (Math.floor(tile / 8) * 16 + 0.5 + (1 - texV) * 15) / 64,
            );
          }
          if (ao[0] + ao[2] > ao[1] + ao[3])
            out.i.push(base, base + 1, base + 3, base + 1, base + 2, base + 3);
          else out.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
  const finish = (o) => ({
    position: new Float32Array(o.p),
    normal: new Float32Array(o.n),
    color: new Float32Array(o.c),
    uv: new Float32Array(o.uv),
    index: new Uint32Array(o.i),
    flow: new Float32Array(o.flow),
    kind: new Float32Array(o.kind),
    sky: new Float32Array(o.sky),
  });
  return {
    sy,
    opaque: finish(opaque),
    water: finish(water),
    cutout: finish(cutout),
    effects: finish(effects),
  };
}
