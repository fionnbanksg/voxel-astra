import test from 'node:test';
import assert from 'node:assert/strict';
import { Companion } from '../dist/src/companion.js';
import { Entity } from '../dist/src/entities.js';
import { Player, intersects, overlapsBlock } from '../dist/src/physics.js';
import { B, C, H, idx, mod, solid } from '../dist/src/blocks.js';
import { U, BLOCK_SIZE, PLAYER_HEIGHT, REACH } from '../dist/src/scale.js';
import { generateChunk, column } from '../dist/src/terrain.js';
import { FRAME_H, FRAME_W, validFrame } from '../dist/src/portals.js';
import { characterParts } from '../dist/src/character-models.js';
function guard(wall = false) {
  const player = new Player();
  player.teleport(0, 1, 0);
  const dog = new Entity(0).spawn('companion', 0, 1, 0.5),
    enemy = new Entity(1).spawn('rival', 0, 1, 1.5);
  const world = {
    get: (x, y, z) => (y < 1 || (wall && Math.floor(z) === 1) ? B.STONE : B.AIR),
    loaded: () => true,
    ground: () => 1,
  };
  world.collides = (x, y, z) => solid(world.get(x, y, z));
  const entities = { pool: [dog, enemy], spawn: () => dog };
  const pip = new Companion(entities, world, player, () => {});
  pip.entity = dog;
  return { pip, dog, enemy, world, player };
}
test('Pip selects a nearby hostile, bites with cooldown, and enemies retaliate', () => {
  const { pip, dog, enemy } = guard();
  pip.tick(0.1);
  assert.equal(pip.guardTarget, enemy);
  assert.equal(enemy.health, 11);
  assert.equal(enemy.combatTarget, dog);
  assert.equal(dog.destination, enemy.position);
  pip.tick(0.1);
  assert.equal(enemy.health, 11);
  pip.tick(0.6);
  assert.equal(enemy.health, 6);
  pip.tick(0.7);
  pip.tick(0.7);
  assert.equal(enemy.active, false);
  pip.tick(0.1);
  assert.equal(pip.guardTarget, null);
  assert.equal(dog.destination, pip.player.position);
});
test('Pip cannot bite through walls, and resumes a queued task after defending', () => {
  const a = guard(true);
  a.pip.tick(0.1);
  assert.equal(a.enemy.health, 16);
  assert.equal(a.pip.guardTarget, null);
  const b = guard();
  b.pip.mode = 'mine';
  b.pip.jobs = [{ x: 80, y: 1, z: 0, b: B.AIR }];
  b.pip.tick(0.1);
  assert.equal(b.pip.jobs.length, 1);
  assert.equal(b.dog.destination, b.enemy.position);
  b.enemy.active = false;
  b.pip.tick(0.1);
  assert.equal(b.dog.destination.x, 80.5);
  const friendly = new Entity(2).spawn('sheep', 0, 1, 4);
  b.pip.entities.pool.push(friendly);
  b.pip.tick(0.1);
  assert.equal(friendly.health, 8);
});
test('normal-size voxels preserve actor scale and require physically roomy portals', () => {
  const p = new Player();
  assert.equal(BLOCK_SIZE, 1);
  assert.equal(p.height * BLOCK_SIZE, 1.8);
  assert.equal(p.width * BLOCK_SIZE, 0.6);
  assert.equal(REACH * BLOCK_SIZE, 7);
  assert.ok(PLAYER_HEIGHT === 1.8);
  const get = (x, y, z) =>
    z === 0 &&
    x >= 0 &&
    x < FRAME_W &&
    y >= 0 &&
    y < FRAME_H &&
    (x === 0 || x === FRAME_W - 1 || y === 0 || y === FRAME_H - 1)
      ? B.OBSIDIAN
      : B.AIR;
  assert.ok(validFrame(get, 0, 0, 0));
  assert.equal(
    intersects(
      { collides: (x, y, z) => solid(get(x, y, z)) },
      { x: 2, y: 1.01, z: 0.5 },
      p.width,
      p.height,
    ),
    false,
  );
  assert.ok(overlapsBlock({ x: 0, y: 1, z: 0 }, 0, 2, 0, p.width, p.height));
  const model = characterParts('companion');
  assert.ok(model.some((p) => p[7] === 'tail'));
  assert.equal(model.filter((p) => p[7]?.startsWith('leg')).length, 8);
});
test('cave near spawn opens at the surface and has player-sized connected clearance', () => {
  const chunks = new Map(),
    get = (x, y, z) => {
      x = Math.floor(x);
      y = Math.floor(y);
      z = Math.floor(z);
      if (y < 0) return B.BEDROCK;
      if (y >= H) return 0;
      const cx = Math.floor(x / C),
        cz = Math.floor(z / C),
        k = `${cx},${cz}`;
      if (!chunks.has(k)) chunks.set(k, generateChunk(cx, cz, 'overworld', 73191, { trees: 0 }));
      return chunks.get(k).data[idx(mod(x, C), y, mod(z, C))];
    };
  const c = column(43, -32);
  assert.ok(c.height > c.waterTop + 4);
  assert.equal(get(43, c.height, -32), B.AIR);
  const world = { collides: (x, y, z) => solid(get(x, y, z)) };
  for (let i = 0; i <= 24; i++) {
    const t = i / 24,
      x = 43 - 24 * t,
      centerY = c.height + 2 - 18 * t;
    assert.equal(
      intersects(world, { x, y: centerY - 0.8, z: -32 }, 0.6 * U, 1.8 * U),
      false,
      `tunnel sample ${i}`,
    );
  }
  const sealed = generateChunk(2, -2, 'overworld', 73191, { trees: 0, caves: false });
  assert.notEqual(sealed.data[idx(11, c.height, 0)], B.AIR);
});
