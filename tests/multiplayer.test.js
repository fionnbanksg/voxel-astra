import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createGameServer } from '../server/index.js';
import {
  GAME_VERSION,
  PROTOCOL,
  endpoint,
  inviteURL,
  cleanPlayer,
  validEdit,
} from '../dist/src/network/protocol.js';
import { Multiplayer, applyEdits, worldEdits } from '../dist/src/network/multiplayer.js';
import { THREE } from '../dist/src/renderer.js';
import { Entities } from '../dist/src/entities.js';
import { Player } from '../dist/src/physics.js';
import { TNT } from '../dist/src/tnt.js';
import { Fluids } from '../dist/src/fluids.js';
import { Lava } from '../dist/src/lava.js';
import { B, idx, mod, solid } from '../dist/src/blocks.js';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, tick = () => {}) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw Error('Multiplayer integration timed out');
    tick();
    await delay(5);
  }
}
async function server(t, options = {}) {
  const app = createGameServer(options);
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(() => app.close());
  return { ...app, url: `http://127.0.0.1:${app.server.address().port}` };
}
async function client(app) {
  const ws = new WebSocket(endpoint(app.url)),
    messages = [];
  ws.on('message', (raw) => messages.push(JSON.parse(raw)));
  await once(ws, 'open');
  return {
    ws,
    messages,
    send: (m) => ws.send(JSON.stringify(m)),
    async next(type) {
      await until(() => messages.some((m) => m.type === type));
      return messages.splice(
        messages.findIndex((m) => m.type === type),
        1,
      )[0];
    },
  };
}
const world = {
  seed: 441,
  options: { preset: 'flat' },
  dimension: 'overworld',
  epoch: 1,
  spawn: { x: 0.5, y: 1, z: 3.5 },
};
const state = {
  position: world.spawn,
  velocity: { x: 0, y: 0, z: 0 },
  yaw: 0,
  pitch: 0,
  health: 20,
  mode: 'survival',
  flying: false,
};
const hello = { protocol: PROTOCOL, version: GAME_VERSION, name: 'Friend' };
async function create(c, edits = []) {
  c.send({ ...hello, type: 'create', world, edits });
  return c.next('welcome');
}
async function join(c, room) {
  c.send({ ...hello, type: 'join', room });
  return c.next('welcome');
}

test('room server serves the same local game and isolates rooms, roles and late-join history', async (t) => {
  const app = await server(t),
    host = await client(app),
    guest = await client(app),
    other = await client(app);
  const health = await fetch(app.url + '/health').then((r) => r.json());
  assert.equal(health.version, GAME_VERSION);
  assert.match(await fetch(app.url).then((r) => r.text()), /net-menu/);
  assert.equal((await fetch(app.url + '/server/index.js')).status, 404);
  assert.equal((await fetch(app.url + '/%2e%2e%2fpackage.json')).status, 404);
  assert.equal((await fetch(app.url + '/.openai/hosting.json')).status, 404);
  const h = await create(host, [
      [0, -17, 3, 2, B.BRICK],
      [1, 4, 8, 5, B.LAVA],
    ]),
    o = await create(other);
  const g = await join(guest, h.room);
  assert.equal(h.role, 'host');
  assert.equal(g.role, 'guest');
  assert.equal(g.world.seed, 441);
  assert.equal(g.edits.length, 2);
  assert.equal(g.players.length, 2);
  assert.notEqual(h.room, o.room);
  guest.send({ type: 'position', id: h.id, state });
  assert.equal((await host.next('position')).id, g.id);
  guest.send({ type: 'edits', epoch: 1, edits: [[0, 1, 2, 3, B.TNT]] });
  assert.match((await guest.next('error')).message, /Only the host/);
  guest.send({ type: 'action', epoch: 1, action: 'attack', data: {} });
  assert.equal((await host.next('action')).id, g.id);
  host.send({
    type: 'edits',
    epoch: 1,
    edits: [
      [0, -17, 3, 2, B.AIR],
      [0, 5, 1, 6, B.TNT],
    ],
  });
  assert.equal((await guest.next('edits')).seq, 1);
  const late = await client(app),
    l = await join(late, h.room);
  assert.equal(l.seq, 1);
  assert.deepEqual(l.edits, [
    [0, -17, 3, 2, B.AIR],
    [1, 4, 8, 5, B.LAVA],
    [0, 5, 1, 6, B.TNT],
  ]);
  assert.equal(
    other.messages.some((m) => ['position', 'action', 'edits'].includes(m.type)),
    false,
  );
  host.send({ type: 'leave' });
  assert.match((await guest.next('closed')).reason, /Host left/);
  await late.next('closed');
  assert.equal(app.rooms.has(h.room), false);
  assert.equal(app.rooms.has(o.room), true);
});

test('host simulation, damage and dimension resets relay with epoch boundaries', async (t) => {
  const app = await server(t),
    host = await client(app),
    guest = await client(app);
  const h = await create(host),
    g = await join(guest, h.room);
  host.send({
    type: 'frame',
    epoch: 1,
    time: 42,
    weather: 'storm',
    paused: false,
    pip: { mode: 'stay' },
    mobs: [{ id: 0, kind: 'companion', position: world.spawn }],
    bombs: [{ id: 2, position: world.spawn, fuse: 2 }],
  });
  assert.equal((await guest.next('frame')).bombs[0].fuse, 2);
  host.send({ type: 'blast', epoch: 1, position: world.spawn, power: 4 });
  assert.equal((await guest.next('blast')).power, 4);
  host.send({ type: 'damage', epoch: 1, id: g.id, amount: 4, dx: 1, dz: 0 });
  assert.equal((await guest.next('damage')).amount, 4);
  host.send({ type: 'loading' });
  await guest.next('loading');
  host.send({
    type: 'reset',
    world: { ...world, dimension: 'nether', epoch: 2 },
    edits: [[1, 1, 2, 3, B.NETHERRACK]],
  });
  const reset = await guest.next('reset');
  assert.equal(reset.world.dimension, 'nether');
  assert.equal(reset.seq, 0);
  assert.equal(reset.frame, null);
  guest.send({ type: 'action', epoch: 1, action: 'attack' });
  host.send({ type: 'edits', epoch: 1, edits: [[0, 1, 2, 3, B.AIR]] });
  host.send({ type: 'edits', epoch: 2, edits: [[1, 1, 2, 3, B.AIR]] });
  const edit = await guest.next('edits');
  assert.equal(edit.epoch, 2);
  assert.equal(edit.seq, 1);
  assert.equal(
    host.messages.some((m) => m.type === 'action'),
    false,
  );
});

test('bad versions, excess players, malformed edits and non-allowlisted origins are rejected', async (t) => {
  const app = await server(t),
    host = await client(app),
    bad = await client(app),
    h = await create(host);
  bad.send({ ...hello, type: 'join', version: 'old', room: h.room });
  assert.match((await bad.next('error')).message, /versions differ/);
  for (let i = 0; i < 3; i++) await join(await client(app), h.room);
  bad.send({ ...hello, type: 'join', room: h.room });
  assert.match((await bad.next('error')).message, /full/);
  host.send({ type: 'edits', epoch: 1, edits: [[0, 0, -1, 0, B.TNT]] });
  assert.match((await host.next('error')).message, /Invalid edit/);
  const secure = await server(t, { allowedOrigins: ['https://allowed.example'] });
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(endpoint(secure.url), { origin: 'https://other.example' });
    ws.on('open', () => reject(Error('Origin was accepted')));
    ws.on('error', (e) => {
      assert.match(e.message, /403/);
      resolve();
    });
  });
});

function rig() {
  const cells = new Map(),
    w = {
      cells,
      edits: new Map(),
      epoch: 1,
      dimension: 'overworld',
      seed: 441,
      options: { preset: 'flat' },
      loaded: () => true,
      onEdit() {},
      onChunkLoaded() {},
      get(x, y, z) {
        x = Math.floor(x);
        y = Math.floor(y);
        z = Math.floor(z);
        return cells.get(`${this.dimension}:${x},${y},${z}`) ?? (y <= 0 ? B.BEDROCK : B.AIR);
      },
      set(x, y, z, b, record = true, persist = record) {
        const old = this.get(x, y, z);
        if (old === b) return false;
        cells.set(`${this.dimension}:${x},${y},${z}`, b);
        if (persist) {
          const k = `${this.dimension}:${Math.floor(x / 16)},${Math.floor(z / 16)}`;
          if (!this.edits.has(k)) this.edits.set(k, new Map());
          this.edits.get(k).set(idx(mod(x, 16), y, mod(z, 16)), b);
        }
        this.onEdit(x, y, z, b, old, record);
        return true;
      },
      collides(x, y, z) {
        return solid(this.get(x, y, z));
      },
    };
  const renderer = {
    scene: new THREE.Scene(),
    uniforms: { uAtlas: { value: new THREE.Texture() } },
    lightMaterial: (m) => m,
  };
  const player = new Player();
  player.teleport(0.5, 1, 3.5);
  player.yaw = 0;
  player.pitch = 0;
  const fluids = new Fluids(w),
    lava = new Lava(w);
  const entities = new Entities(renderer, w),
    notices = [],
    tnt = new TNT(renderer, w, player, entities, (m) => notices.push(m));
  const companion = { player, mode: 'follow' },
    weather = { mode: 'auto' };
  const net = new Multiplayer({
    renderer,
    world: w,
    player,
    entities,
    tnt,
    companion,
    weather,
    portals: { ignite() {} },
    notify: (m) => notices.push(m),
    onLoad(snapshot, edits) {
      w.cells.clear();
      w.edits.clear();
      Object.assign(w, snapshot);
      applyEdits(w, edits);
      player.teleport(snapshot.spawn.x, snapshot.spawn.y, snapshot.spawn.z);
    },
  });
  return { w, player, entities, tnt, fluids, lava, net, notices };
}

test('real game clients keep solo edits, share guest mining/placing and reject impossible reach', async (t) => {
  const app = await server(t);
  globalThis.location = { href: app.url, protocol: 'http:' };
  globalThis.WebSocket = WebSocket;
  const host = rig(),
    guest = rig();
  t.after(() => {
    host.net.disconnect();
    guest.net.disconnect();
  });
  host.w.set(0, 2, 0, B.STONE);
  host.w.set(-17, 4, 2, B.BRICK);
  host.net.connect(app.url, 'Host');
  await until(() => host.net.host);
  guest.net.connect(app.url, 'Guest', host.net.room);
  await until(() => guest.net.guest);
  assert.equal(guest.w.get(-17, 4, 2), B.BRICK);
  const tick = () => {
    for (const r of [host, guest]) r.net.update(0.06, { ready: true, paused: false, time: 10 });
  };
  host.player.teleport(10, 1, 3.5);
  tick();
  await until(() => host.net.actors().length === 1 && guest.net.actors().length === 1);
  assert.equal(guest.w.set(0, 2, 0, B.AIR), false); // Intent waits for host commitment.
  await until(() => host.w.get(0, 2, 0) === B.AIR);
  await until(() => guest.w.get(0, 2, 0) === B.AIR, tick);
  host.w.set(0, 2, 0, B.STONE);
  await until(() => guest.w.get(0, 2, 0) === B.STONE, tick);
  guest.w.set(0, 2, 1, B.PLANKS);
  await until(() => host.w.get(0, 2, 1) === B.PLANKS);
  await until(() => guest.w.get(0, 2, 1) === B.PLANKS, tick);
  guest.w.set(100, 2, 0, B.TNT);
  await delay(25);
  assert.equal(host.w.get(100, 2, 0), B.AIR);
  // Simulation edits are host-only; replicas cannot independently spread water.
  guest.w.set(2, 1, 2, B.WATER, false, true);
  assert.equal(guest.w.get(2, 1, 2), B.AIR);
  host.w.set(2, 1, 2, B.WATER, false, true);
  await until(() => guest.w.get(2, 1, 2) === B.WATER, tick);
  host.fluids.tick(0.25);
  await until(() => guest.w.get(3, 1, 2) === host.w.get(3, 1, 2), tick);
  assert.notEqual(guest.w.get(3, 1, 2), B.AIR);
  const serial = worldEdits(guest.w);
  assert.ok(serial.some((e) => e[1] === -17 && e[4] === B.BRICK));
  host.net.disconnect();
  await until(() => !guest.net.connected);
  assert.equal(guest.w.get(0, 2, 1), B.PLANKS);
  assert.equal(guest.w.set(2, 1, 2, B.DIRT), true);
});

test('game client mirrors mob/TNT animation once, validates melee and retains local creative immunity', async (t) => {
  const app = await server(t);
  globalThis.location = { href: app.url, protocol: 'http:' };
  globalThis.WebSocket = WebSocket;
  const host = rig(),
    guest = rig();
  t.after(() => {
    host.net.disconnect();
    guest.net.disconnect();
  });
  host.net.connect(app.url, 'Host');
  await until(() => host.net.host);
  guest.net.connect(app.url, 'Guest', host.net.room);
  await until(() => guest.net.guest);
  const tick = () => {
    for (const r of [host, guest]) r.net.update(0.1, { ready: true, paused: false, time: 20 });
  };
  host.player.teleport(0.5, 1, 0.5);
  tick();
  await until(() => host.net.actors().length === 1);
  guest.net.request('attack');
  await until(() => host.player.health === 16);
  assert.ok(host.player.knock.z < 0);
  host.player.setMode('creative');
  host.player.hurtTime = 0;
  host.net.players.get(guest.net.id).actor.attackAt = -1000;
  guest.net.request('attack');
  await delay(25);
  assert.equal(host.player.health, 20);
  const sheep = host.entities.spawn('sheep', 5, 1, 5);
  host.w.set(0, 1, 0, B.TNT);
  host.tnt.prime(0, 1, 0, 1);
  await until(() => guest.tnt.pool[0].active, tick);
  assert.equal(guest.entities.pool[sheep.id].kind, 'sheep');
  guest.tnt.replicaTick(2);
  assert.equal(guest.tnt.queue.length, 0);
  assert.equal(guest.tnt.pool[0].active, true);
  for (let i = 0; i < 61; i++) host.tnt.tick(1 / 60);
  host.tnt.flush();
  await until(() => guest.tnt.bursts.some((b) => b.life > 0), tick);
  assert.equal(guest.tnt.queue.length, 0);
  assert.ok(guest.tnt.particles.some((p) => p.life > 0));
  // Reset replaces the guest world, including edits from the other dimension.
  host.w.dimension = 'nether';
  host.w.epoch++;
  host.w.set(3, 1, 3, B.NETHERRACK);
  await until(() => guest.w.dimension === 'nether', tick);
  assert.equal(guest.w.get(3, 1, 3), B.NETHERRACK);
});

test('protocol keeps invitation secrets in fragments and rejects invalid state', () => {
  const address = endpoint('https://game.example/?anything#old');
  assert.equal(address, 'wss://game.example/multiplayer');
  assert.equal(inviteURL(address, 'abc'), 'https://game.example/#room=abc');
  assert.throws(() => endpoint('ftp://game.example'));
  assert.throws(() => endpoint('https://user:pass@game.example'));
  assert.throws(() => cleanPlayer({ ...state, position: { x: NaN, y: 0, z: 0 } }));
  assert.equal(validEdit([0, -1, 4, -17, 39]), true);
  assert.equal(validEdit([0, 1, 128, 1, B.STONE]), false);
});

test('multiplayer sends held items and swings, deduplicates deaths, and restores the respawned model', async (t) => {
  const app = await server(t);
  globalThis.location = { href: app.url, protocol: 'http:' };
  globalThis.WebSocket = WebSocket;
  const host = rig(),
    guest = rig();
  t.after(() => {
    host.net.disconnect();
    guest.net.disconnect();
  });
  host.net.connect(app.url, 'Host');
  await until(() => host.net.host);
  guest.net.connect(app.url, 'Guest', host.net.room);
  await until(() => guest.net.guest);
  const tick = () => {
    for (const r of [host, guest]) r.net.update(0.1, { ready: true, paused: false, time: 20 });
  };
  guest.player.heldBlock = B.TNT;
  guest.player.health = 4;
  guest.net.animate('attack');
  tick();
  await until(() => host.net.actors().length === 1);
  const remote = host.net.players.get(guest.net.id).actor;
  assert.equal(remote.heldBlock, B.TNT);
  assert.equal(remote.actionSeq, guest.player.actionSeq);
  assert.equal(remote.actionKind, 'attack');
  remote.damage(4, 1, 0);
  await until(() => guest.player.health === 0);
  assert.equal(remote.active, false);
  assert.equal(host.net.ragdolls.pool.filter((r) => r.active).length, 1);
  await until(() => guest.net.ragdolls.pool.some((r) => r.active), tick);
  const corpse = guest.net.ragdolls.pool.find((r) => r.active);
  assert.equal(corpse.source, `player:${guest.net.id}:0`);
  assert.equal(
    host.net.ragdolls.pool.filter((r) => r.active).length,
    1,
    'the echoed dead pose does not spawn a duplicate',
  );
  host.net.playerPose(guest.net.id, { ...state, life: 0, health: 20 });
  assert.equal(remote.active, false, 'a delayed healthy pose cannot revive the old life');
  const late = await client(app),
    welcome = await join(late, host.net.room);
  assert.equal(welcome.frame.ragdolls.length, 1);
  guest.player.life++;
  guest.player.health = 20;
  guest.player.hurtTime = 0;
  tick();
  await until(() => remote.active && remote.life === 1);
  guest.net.receive({ type: 'damage', life: 0, amount: 20, dx: 0, dz: 0 });
  assert.equal(guest.player.health, 20, 'old-life damage is ignored');
  // NPC death uses the same pool and is not merely removed from the mob snapshot.
  const mob = host.entities.spawn('rival', 2, 1, 2);
  mob.damage(40, 0, 1);
  await until(() => guest.net.ragdolls.pool.filter((r) => r.active).length === 2, tick);
  assert.ok(guest.net.ragdolls.pool.some((r) => r.active && r.kind === 'rival'));
});

test('heartbeat accepts active clients without control pongs and reports genuinely idle clients', async (t) => {
  const logs = [];
  const app = await server(t, {
    heartbeatMs: 40,
    idleTimeoutMs: 220,
    logger: { warn: (m) => logs.push(m) },
  });
  const active = new WebSocket(endpoint(app.url), { autoPong: false });
  const idle = new WebSocket(endpoint(app.url), { autoPong: false });
  await Promise.all([once(active, 'open'), once(idle, 'open')]);
  const messages = [];
  active.on('message', (raw) => messages.push(JSON.parse(raw)));
  active.send(JSON.stringify({ ...hello, type: 'create', world, edits: [] }));
  await until(() => messages.some((m) => m.type === 'welcome'));
  const pump = setInterval(() => active.send(JSON.stringify({ type: 'ping', sent: 1 })), 40);
  t.after(() => clearInterval(pump));
  const [code, reason] = await once(idle, 'close');
  assert.equal(code, 4000);
  assert.match(reason.toString(), /Heartbeat timed out/);
  await delay(300);
  assert.equal(active.readyState, WebSocket.OPEN);
  assert.ok(messages.filter((m) => m.type === 'pong').length > 5);
  assert.ok(logs.some((m) => /Heartbeat timed out/.test(m)));
  clearInterval(pump);
});

test('congested uploads retain terrain and explosions, then drain in bounded batches', () => {
  globalThis.WebSocket = WebSocket;
  const host = rig();
  host.net.role = 'host';
  const sent = [];
  host.net.socket = {
    readyState: WebSocket.OPEN,
    bufferedAmount: 300000,
    send: (raw) => sent.push(JSON.parse(raw)),
    close() {},
  };
  for (let x = 0; x < 5000; x++) host.w.set(x, 1, 0, B.STONE, false, true);
  host.net.effects.push({ type: 'blast', position: world.spawn, power: 4 });
  host.net.update(0.06, { ready: true, paused: false, time: 1 });
  assert.equal(host.net.pending.size, 5000);
  assert.equal(host.net.effects.length, 1);
  assert.equal(host.net.host, true);
  host.net.socket.bufferedAmount = 0;
  for (let i = 0; i < 3; i++) host.net.update(0.06, { ready: true, paused: false, time: 1 });
  assert.deepEqual(
    sent.filter((m) => m.type === 'edits').map((m) => m.edits.length),
    [2048, 2048, 904],
  );
  assert.equal(sent.filter((m) => m.type === 'blast').length, 1);
  assert.equal(host.net.pending.size, 0);
  assert.equal(host.net.effects.length, 0);
  host.net.disconnect();
  assert.equal(host.net.simulates(true, true), false, 'solo menus still pause');
});

test(
  '65-second session survives heartbeat boundaries, TNT chains, host menus and host death',
  { timeout: 75000 },
  async (t) => {
    const app = await server(t, { logger: { warn() {} } });
    globalThis.location = { href: app.url, protocol: 'http:' };
    globalThis.WebSocket = WebSocket;
    const host = rig(),
      guest = rig();
    t.after(() => {
      host.net.disconnect();
      guest.net.disconnect();
    });
    host.net.connect(app.url, 'Host');
    await until(() => host.net.host);
    guest.net.connect(app.url, 'Guest', host.net.room);
    await until(() => guest.net.guest);
    host.player.setMode('creative');
    guest.player.setMode('creative');
    let observedBlasts = 0,
      pausedFrame = false;
    const visual = guest.tnt.visualBlast.bind(guest.tnt);
    guest.tnt.visualBlast = (...args) => {
      observedBlasts++;
      return visual(...args);
    };
    const receive = guest.net.receive.bind(guest.net);
    guest.net.receive = (m) => {
      if (m.type === 'frame' && m.paused) pausedFrame = true;
      receive(m);
    };
    const start = Date.now();
    let planted = false,
      killed = false;
    while (Date.now() - start < 65000) {
      const elapsed = (Date.now() - start) / 1000;
      const paused = elapsed > 20;
      if (!planted && elapsed > 24) {
        planted = true;
        // Dense terrain, 32 TNT charges and flowing water produce real edit bursts.
        for (let x = 0; x < 20; x++)
          for (let z = 0; z < 20; z++)
            for (let y = 1; y < 4; y++) host.w.set(x, y, z, B.STONE, false, true);
        host.w.set(22, 4, 0, B.WATER, false, true);
        for (let i = 0; i < 32; i++) {
          const x = (i % 8) * 2,
            z = Math.floor(i / 8) * 3;
          host.w.set(x, 4, z, B.TNT, false, true);
          host.tnt.prime(x, 4, z, 1 + i * 0.02);
        }
      }
      if (!killed && elapsed > 40) {
        killed = true;
        host.player.health = 0;
        host.player.onDeath(host.player, 1, 0);
        host.w.set(25, 1, 0, B.TNT, false, true);
        host.tnt.prime(25, 1, 0, 1);
      }
      assert.equal(host.net.host, true, host.notices.join('\n'));
      assert.equal(guest.net.guest, true, guest.notices.join('\n'));
      if (host.net.simulates(true, paused)) {
        host.tnt.tick(0.05);
        host.fluids.tick(0.05);
        host.tnt.flush();
      }
      host.net.update(0.05, { ready: true, paused, time: elapsed });
      guest.net.update(0.05, { ready: true, paused: false, time: elapsed });
      await delay(50);
    }
    await until(
      () => !host.net.pending.size,
      () => host.net.update(0.05, { ready: true, paused: true, time: 65 }),
    );
    await delay(100);
    assert.ok(observedBlasts >= 33, `Guest observed ${observedBlasts} blasts`);
    assert.equal(pausedFrame, false, 'host menus and death did not freeze shared simulation');
    assert.equal(
      guest.tnt.pool.some((b) => b.active),
      false,
    );
    const sortEdits = (w) =>
      worldEdits(w).sort((a, b) => a.join(',').localeCompare(b.join(',')));
    assert.deepEqual(sortEdits(guest.w), sortEdits(host.w));
    assert.equal(
      host.notices.some((m) => /disconnect|failed|limit|Invalid/i.test(m)),
      false,
      host.notices.join('\n'),
    );
  },
);

test('disconnect reason stays visible after the connection closes', async (t) => {
  const logs = [];
  const app = await server(t, { logger: { warn: (m) => logs.push(m) } });
  globalThis.location = { href: app.url, protocol: 'http:' };
  globalThis.WebSocket = WebSocket;
  const host = rig();
  t.after(() => host.net.disconnect());
  host.net.connect(app.url, 'Host');
  await until(() => host.net.host);
  [...app.wss.clients][0].close(1008, 'Message rate exceeded');
  await until(() => !host.net.connected);
  assert.match(host.net.lastError, /1008.*Message rate exceeded/);
  assert.ok(host.notices.some((m) => /Message rate exceeded/.test(m)));
});

test('render interpolation moves body/head/items together and restores the latest combat pose', () => {
  const host = rig();
  host.net.role = 'host';
  host.net.id = 'host';
  const first = { ...state, heldBlock: B.TNT, life: 0 };
  const latest = {
    ...first,
    position: { ...state.position, x: 2.5 },
    yaw: Math.PI / 2,
    pitch: 0.8,
  };
  host.net.roster([{ id: 'friend', name: 'Friend', state: first }]);
  host.net.playerPose('friend', latest);
  const p = host.net.players.get('friend'),
    e = p.actor;
  p.motion.reset();
  p.motion.push(first, 0);
  p.motion.push(latest, 50);
  const render = host.net.remote.draw.bind(host.net.remote);
  let sampled;
  host.net.remote.draw = (...args) => {
    sampled = { x: e.position.x, yaw: e.yaw, heading: e.heading, pitch: e.pitch };
    render(...args);
  };
  host.net.drawPlayers(1, 125);
  assert.equal(sampled.x, 1.5);
  assert.equal(sampled.yaw, Math.PI / 4);
  assert.equal(sampled.heading, Math.PI * 1.25);
  assert.equal(sampled.pitch, 0.4);
  assert.equal(e.yaw, latest.yaw);
  assert.equal(e.heading, latest.yaw + Math.PI);
  assert.equal(e.pitch, latest.pitch);
  assert.deepEqual(e.position, latest.position);
  assert.ok(host.net.remote.heldItems.pool.some((m) => m.visible));
  // The restore also runs if the renderer fails.
  host.net.remote.draw = () => {
    throw Error('render failed');
  };
  assert.throws(() => host.net.drawPlayers(1, 125), /render failed/);
  assert.deepEqual(e.position, latest.position);
  assert.equal(e.yaw, latest.yaw);
  host.net.disconnect();
});
