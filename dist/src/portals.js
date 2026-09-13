import { U } from './scale.js';
export const FRAME_W = 4,
  FRAME_H = 5;
import { B } from './blocks.js';
export function validFrame(get, x, y, z, axis = 'x') {
  const at = (u, v) => get(x + (axis === 'x' ? u : 0), y + v, z + (axis === 'z' ? u : 0));
  for (let v = 0; v < FRAME_H; v++)
    for (let u = 0; u < FRAME_W; u++) {
      if (u === 0 || u === FRAME_W - 1 || v === 0 || v === FRAME_H - 1) {
        if (at(u, v) !== B.OBSIDIAN) return false;
      } else if (at(u, v) !== B.AIR && at(u, v) !== B.PORTAL) return false;
    }
  return true;
}
export class Portals {
  constructor(world, player, travel, notify) {
    Object.assign(this, { world, player, travel, notify });
    this.cooldown = 0;
    this.charge = 0;
  }
  makeFrame(x, y, z, lit = false) {
    for (let v = 0; v < FRAME_H; v++)
      for (let u = 0; u < FRAME_W; u++)
        this.world.set(
          x + u,
          y + v,
          z,
          u === 0 || u === FRAME_W - 1 || v === 0 || v === FRAME_H - 1
            ? B.OBSIDIAN
            : lit
              ? B.PORTAL
              : B.AIR,
        );
  }
  ignite(target) {
    if (!target) return this.notify('Aim at an obsidian frame and press F.');
    for (const axis of ['x', 'z'])
      for (let v = 0; v < FRAME_H; v++)
        for (let u = 0; u < FRAME_W; u++) {
          const x = target.x - (axis === 'x' ? u : 0),
            y = target.y - v,
            z = target.z - (axis === 'z' ? u : 0);
          if (validFrame(this.world.get.bind(this.world), x, y, z, axis)) {
            for (let a = 1; a < FRAME_W - 1; a++)
              for (let b = 1; b < FRAME_H - 1; b++)
                this.world.set(
                  x + (axis === 'x' ? a : 0),
                  y + b,
                  z + (axis === 'z' ? a : 0),
                  B.PORTAL,
                );
            this.notify('Portal lit. Step through to travel.');
            return;
          }
        }
    this.notify('Build a complete 4-wide × 5-high obsidian frame, with a clear 2 × 3 opening.');
  }
  tick(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const p = this.player.position;
    if (this.world.get(p.x, p.y + 0.7 * U, p.z) === B.PORTAL && this.cooldown === 0) {
      let valid = false;
      const bx = Math.floor(p.x),
        by = Math.floor(p.y + 0.7 * U),
        bz = Math.floor(p.z);
      for (const axis of ['x', 'z'])
        for (let u = 1; u < FRAME_W - 1; u++)
          for (let v = 1; v < FRAME_H - 1; v++)
            if (
              validFrame(
                this.world.get.bind(this.world),
                bx - (axis === 'x' ? u : 0),
                by - v,
                bz - (axis === 'z' ? u : 0),
                axis,
              )
            )
              valid = true;
      if (!valid) {
        this.charge = 0;
        this.notify('This portal needs its obsidian frame repaired.');
        this.cooldown = 3;
        return;
      }
      this.charge += dt;
      if (this.charge > 1) {
        const d = this.world.dimension === 'overworld' ? 'nether' : 'overworld',
          scale = d === 'nether' ? 1 / 8 : 8;
        this.cooldown = 4;
        this.charge = 0;
        this.travel(d, Math.floor(p.x * scale), Math.floor(p.z * scale));
      }
    } else this.charge = 0;
  }
}
