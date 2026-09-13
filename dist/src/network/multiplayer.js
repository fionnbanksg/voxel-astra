import { Ragdolls } from '../ragdolls.js';
import { startAction, playerSkin } from '../character-motion.js';
import { characterParts } from '../character-models.js';
import { THREE } from '../renderer.js';
import { Entities } from '../entities.js';
import { B, C, H, idx, mod, solid, key, clamp } from '../blocks.js';
import { overlapsBlock } from '../physics.js';
import { raycast } from '../raycast.js';
import { attack, rayBox } from '../combat.js';
import {
  GAME_VERSION,
  PROTOCOL,
  MAX_EDITS,
  dimensionId,
  dimensionName,
  validEdit,
  editKey,
  endpoint,
  inviteURL,
} from './protocol.js';
export function worldEdits(world) {
  const out = [];
  for (const [k, entries] of world.edits) {
    const [d, c] = k.split(':'),
      [cx, cz] = c.split(',').map(Number);
    for (const [i, b] of entries) {
      const y = Math.floor(i / (C * C)),
        z = Math.floor(i / C) % C,
        x = i % C;
      out.push([dimensionId(d), cx * C + x, y, cz * C + z, b]);
    }
  }
  return out;
}
export function applyEdits(world, rows) {
  for (const e of rows) {
    if (!validEdit(e)) continue;
    const [d, x, y, z, b] = e,
      dimension = dimensionName(d),
      k = `${dimension}:${key(Math.floor(x / C), Math.floor(z / C))}`;
    if (!world.edits.has(k)) world.edits.set(k, new Map());
    world.edits.get(k).set(idx(mod(x, C), y, mod(z, C)), b);
    if (dimension === world.dimension && world.loaded(x, z)) world.set(x, y, z, b, false, true);
  }
}
const pose = (e) => ({
  position: { ...e.position },
  velocity: { ...e.velocity },
  yaw: e.yaw,
  pitch: e.pitch,
  mode: e.mode,
  health: e.health,
  flying: e.flying,
  life: e.life || 0,
  heldBlock: e.heldBlock || B.GRASS,
  actionSeq: e.actionSeq || 0,
  actionKind: e.actionKind || 'mine',
  actionAge: Math.min(1, Math.max(0, performance.now() / 1000 - (e.actionAt ?? -100))),
});
const mobState = (e) => ({
  id: e.id,
  kind: e.kind,
  position: { ...e.position },
  velocity: { ...e.velocity },
  heading: e.heading,
  health: e.health,
  hurt: e.hurt,
  attackTimer: e.attackTimer,
});
const bombState = (b) => ({
  id: b.netSlot,
  position: { ...b.position },
  velocity: { ...b.velocity },
  fuse: b.fuse,
  power: b.power,
  chain: b.chain,
  damage: b.damage,
});
const tntOptions = (o) => ({
  fuse: clamp(+o?.fuse || 4, 1, 10),
  power: clamp(+o?.power || 4, 2, 8),
  chain: o?.chain !== false,
  damage: o?.damage !== false,
});
/** Optional listen-server extension. Solo methods are untouched unless connected.
 * Host runs the existing world systems. Guests receive committed edits and
 * snapshots, and submit intents instead of simulating a second shared world. */
export class Multiplayer {
  constructor({
    renderer,
    world,
    player,
    entities,
    tnt,
    companion,
    portals,
    weather,
    notify,
    onLoad,
    onStatus,
  }) {
    Object.assign(this, {
      renderer,
      world,
      player,
      entities,
      tnt,
      companion,
      portals,
      weather,
      notify,
      onLoad,
      onStatus,
    });
    this.role = 'solo';
    this.room = '';
    this.id = '';
    this.pending = new Map();
    this.effects = [];
    this.players = new Map();
    this.remote = new Entities(renderer, world);
    this.ragdolls = new Ragdolls(renderer, world);
    player.kind = 'player';
    player.onDeath = (actor, dx, dz) => {
      if (!this.guest)
        this.ragdolls.spawn(actor, `player:${this.id || 'local'}:${player.life}`, dx, dz);
      if (this.connected) this.send({ type: 'position', state: pose(player) });
    };
    for (const e of entities.pool)
      e.onDeath = (actor, dx, dz) => {
        if (!this.guest) this.ragdolls.spawn(actor, `mob:${actor.id}`, dx, dz);
      };
    this.timer = 0;
    this.frameTimer = 0;
    this.pingTimer = 0;
    this.applying = false;
    this.waiting = false;
    this.frameAt = 0;
    this.epoch = world.epoch;
    this.seq = 0;
    this.netTime = null;
    this.labels = typeof document !== 'undefined' ? document.getElementById('remote-labels') : null;
    const originalSet = world.set.bind(world);
    this.originalSet = originalSet;
    world.set = (x, y, z, b, record = true, persist = record) => {
      if (this.guest && !this.applying) {
        if (record)
          this.request('edit', { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z), b });
        return false;
      }
      const changed = originalSet(x, y, z, b, record, persist);
      if (changed && this.host && !this.applying) {
        const row = [
          dimensionId(world.dimension),
          Math.floor(x),
          Math.floor(y),
          Math.floor(z),
          world.get(x, y, z),
        ];
        this.pending.set(editKey(row), row);
      }
      return changed;
    };
    const names = ['ignite', 'detonateNearby', 'defuse', 'spawnPattern'];
    this.tntMethods = Object.fromEntries(names.map((n) => [n, tnt[n].bind(tnt)]));
    for (const name of names)
      tnt[name] = (...args) => {
        if (!this.guest) return this.tntMethods[name](...args);
        const action = {
          ignite: 'ignite',
          detonateNearby: 'tnt-nearby',
          defuse: 'tnt-defuse',
          spawnPattern: 'tnt-pattern',
        }[name];
        this.request(action, {
          options: tntOptions(tnt.options),
          kind: args[1],
          count: args[2],
          spacing: args[3],
        });
      };
    tnt.targets = () => [player, ...entities.pool, ...this.actors()];
    tnt.extraActors = () => [Object.assign(player, { active: true }), ...this.actors()];
    tnt.onBlast = (position, power) => {
      if (!this.guest) this.ragdolls.impulse(position, power);
      if (this.host) this.effects.push({ type: 'blast', position: { ...position }, power });
    };
    tnt.pool.forEach((b, i) => (b.netSlot = i));
  }
  animate(kind) {
    startAction(this.player, kind);
  }
  ownCorpse() {
    return this.ragdolls.pool.find(
      (r) => r.active && r.source === `player:${this.id || 'local'}:${this.player.life}`,
    );
  }
  killRemote(actor, dx = 0, dz = 0) {
    if (actor.deadLife === actor.life) return;
    actor.deadLife = actor.life;
    actor.active = false;
    if (this.host) this.ragdolls.spawn(actor, `player:${actor.netId}:${actor.life}`, dx, dz);
  }
  get host() {
    return this.role === 'host';
  }
  get guest() {
    return this.role === 'guest';
  }
  get connected() {
    return this.role !== 'solo';
  }
  actors() {
    return [...this.players.values()].map((p) => p.actor).filter((a) => a?.active && a.health > 0);
  }
  allTargets(actor) {
    return {
      pool: [
        ...this.entities.pool,
        ...this.actors(),
        Object.assign(this.player, { active: this.player.health > 0, kind: 'player' }),
      ].filter((e) => e !== actor),
    };
  }
  overlaps(x, y, z) {
    return this.actors().some((p) => overlapsBlock(p.position, x, y, z, p.width, p.height));
  }
  exportWorld() {
    return {
      seed: this.world.seed,
      options: this.world.options,
      dimension: this.world.dimension,
      epoch: this.world.epoch,
      spawn: { ...this.player.position },
    };
  }
  status(message) {
    this.onStatus?.(message || '');
  }
  connect(address, name, room) {
    if (this.connected || this.socket) throw Error('Leave the current connection first.');
    const url = endpoint(address, location.href);
    if (location.protocol === 'https:' && url.startsWith('ws:'))
      throw Error(
        'An HTTPS game needs a WSS server. Open the game from your local server for LAN play.',
      );
    const edits = room ? null : worldEdits(this.world);
    if (edits?.length > MAX_EDITS)
      throw Error('This world has too many edits for a room. Start a smaller world first.');
    this.address = url;
    this.intent = room ? 'join' : 'create';
    this.waiting = !!room;
    const ws = (this.socket = new WebSocket(url));
    this.status('Connecting…');
    const timeout = setTimeout(() => {
      if (this.socket === ws && this.role === 'solo') {
        this.notify('Server did not respond. Start npm run server, then check the server address.');
        this.disconnect();
      }
    }, 12000);
    ws.onopen = () =>
      this.send({
        type: room ? 'join' : 'create',
        protocol: PROTOCOL,
        version: GAME_VERSION,
        name,
        room,
        world: this.exportWorld(),
        edits,
      });
    ws.onmessage = (event) => {
      if (this.socket !== ws) return;
      try {
        this.receive(JSON.parse(event.data));
      } catch (e) {
        this.notify('Multiplayer sync failed: ' + e.message);
        this.disconnect();
      }
    };
    ws.onerror = () => {
      if (this.socket === ws)
        this.status('Cannot reach server. Check its address and that it is running.');
    };
    ws.onclose = () => {
      clearTimeout(timeout);
      if (this.socket === ws) {
        this.socket = null;
        this.disconnect(false);
        this.notify('Disconnected. You can continue this world in solo.');
      }
    };
    this.connectTimer = timeout;
  }
  send(m) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    if (this.socket.bufferedAmount > 4 * 1024 * 1024) {
      this.notify('Connection is too slow. Continuing in solo.');
      this.disconnect();
      return false;
    }
    this.socket.send(JSON.stringify(m));
    return true;
  }
  request(action, data = {}) {
    if (this.waiting) return this.notify('Wait for the host to finish loading.');
    this.send({ type: 'action', epoch: this.epoch, action, data, state: pose(this.player) });
  }
  disconnect(close = true) {
    clearTimeout(this.connectTimer);
    const ws = this.socket;
    this.socket = null;
    if (close && ws) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'leave' }));
      ws.close();
    }
    this.role = 'solo';
    this.room = '';
    this.waiting = false;
    this.pending.clear();
    this.effects = [];
    this.netTime = null;
    this.world.networkFocus = [];
    this.remote.clear();
    for (const e of this.remote.pool) e.netId = null;
    for (const p of this.players.values()) p.label?.remove();
    this.players.clear();
    this.companion.player = this.player;
    this.status('Solo · current world retained');
  }
  receive(m) {
    if (m.type === 'error') {
      this.notify(m.message);
      this.status(m.message);
      if (m.fatal || !this.connected) this.disconnect();
      return;
    }
    if (m.type === 'closed') {
      this.notify(m.reason);
      this.disconnect();
      return;
    }
    if (m.type === 'welcome' || m.type === 'reset') {
      clearTimeout(this.connectTimer);
      this.id = m.id;
      this.player.skinIndex = playerSkin(m.id);
      this.room = m.room;
      this.role = m.role;
      this.epoch = m.world.epoch;
      this.seq = m.seq;
      this.waiting = false;
      if (this.guest) {
        this.applying = true;
        try {
          this.onLoad(m.world, m.edits);
        } finally {
          this.applying = false;
        }
        this.entities.clear();
        this.tnt.reset();
        this.ragdolls.reset();
        this.companion.entity = null;
      }
      this.pending.clear();
      this.roster(m.players);
      if (m.frame) this.receive(m.frame);
      this.status(`${this.host ? 'Hosting' : 'Joined'} · ${m.players.length}/4 players`);
      return;
    }
    if (m.type === 'players') {
      this.roster(m.players);
      this.status();
      return;
    }
    if (m.type === 'position') {
      this.playerPose(m.id, m.state);
      return;
    }
    if (m.type === 'loading') {
      this.waiting = true;
      this.status('Host is moving the party / generating terrain…');
      return;
    }
    if (m.type === 'notice') {
      this.notify(m.message);
      return;
    }
    if (m.type === 'pong') {
      this.ping = Math.round(performance.now() - m.sent);
      this.status();
      return;
    }
    if (m.type === 'damage') {
      if (m.life === undefined || m.life === this.player.life)
        this.player.damage(m.amount, m.dx, m.dz);
      return;
    }
    if (m.type === 'action' && this.host) {
      if (m.epoch === this.world.epoch) this.execute(m.id, m.action, m.data);
      return;
    }
    if (m.epoch !== this.epoch) return;
    if (m.type === 'edits' && this.guest) {
      if (m.seq !== this.seq + 1)
        throw Error('Edit sequence interrupted; rejoin for a fresh snapshot.');
      this.seq = m.seq;
      this.applying = true;
      try {
        applyEdits(this.world, m.edits);
      } finally {
        this.applying = false;
      }
      return;
    }
    if (m.type === 'frame' && this.guest) {
      this.ragdolls.receive(m.ragdolls || []);
      for (const r of m.ragdolls || []) {
        const [type, id, life] = r.source.split(':');
        const actor = this.players.get(id)?.actor;
        if (type === 'player' && actor && actor.life === Number(life)) this.killRemote(actor);
      }
      this.frameAt = performance.now();
      this.netTime = { time: m.time, at: this.frameAt };
      const pausedChanged = this.hostPaused !== m.paused;
      this.hostPaused = m.paused;
      this.weather.mode = m.weather;
      if (pausedChanged) this.status();
      const seen = new Set();
      for (const s of m.mobs) {
        if (
          !Number.isInteger(s.id) ||
          s.id < 0 ||
          s.id >= this.entities.pool.length ||
          !['sheep', 'rival', 'ember', 'companion'].includes(s.kind)
        )
          continue;
        const e = this.entities.pool[s.id];
        if (!e.active || e.kind !== s.kind)
          e.spawn(s.kind, s.position.x, s.position.y, s.position.z);
        Object.assign(e.previous, e.position);
        Object.assign(e.position, s.position);
        Object.assign(e.velocity, s.velocity);
        e.heading = s.heading;
        e.health = s.health;
        e.hurt = s.hurt;
        e.attackTimer = s.attackTimer;
        seen.add(s.id);
      }
      for (const e of this.entities.pool) if (!seen.has(e.id)) e.active = false;
      this.companion.entity =
        this.entities.pool.find((e) => e.active && e.kind === 'companion') || null;
      this.companion.mode = m.pip?.mode || 'follow';
      const bombIds = new Set();
      for (const s of m.bombs) {
        const b = this.tnt.pool[s.id];
        if (!b) continue;
        if (!b.active) Object.assign(b.position, s.position);
        Object.assign(b.previous, b.position);
        Object.assign(b.position, s.position);
        Object.assign(b.velocity, s.velocity);
        Object.assign(b, {
          active: true,
          fuse: s.fuse,
          power: s.power,
          chain: s.chain,
          damage: s.damage,
        });
        bombIds.add(s.id);
      }
      this.tnt.pool.forEach((b, i) => {
        if (!bombIds.has(i)) b.active = false;
      });
      return;
    }
    if (m.type === 'blast' && this.guest) this.tnt.visualBlast(m.position, m.power, []);
  }
  roster(list) {
    const keep = new Set();
    for (const p of list) {
      if (p.id === this.id) continue;
      keep.add(p.id);
      if (!this.players.has(p.id)) {
        const actor = this.remote.pool.find((e) => !e.netId);
        if (!actor) continue;
        actor.netId = p.id;
        actor.skinIndex = playerSkin(p.id);
        actor.life = -1;
        actor.deadLife = null;
        actor.active = false;
        const entry = { name: p.name, actor, target: null, label: null };
        if (this.labels) {
          entry.label = document.createElement('span');
          entry.label.className = 'remote-name';
          entry.label.textContent = p.name;
          this.labels.append(entry.label);
        }
        actor.damage = (amount, dx, dz) => {
          if (!this.host || actor.mode === 'creative' || actor.hurtTime > 0 || actor.health <= 0)
            return;
          actor.health = Math.max(0, actor.health - amount);
          actor.hurtTime = 0.7;
          actor.hurt = 1.2;
          if (actor.health <= 0) this.killRemote(actor, dx, dz);
          this.send({
            type: 'damage',
            epoch: this.epoch,
            id: p.id,
            life: actor.life,
            amount,
            dx,
            dz,
          });
        };
        this.players.set(p.id, entry);
      }
      if (p.state) this.playerPose(p.id, p.state);
    }
    for (const [id, p] of this.players)
      if (!keep.has(id)) {
        p.actor.active = false;
        p.actor.netId = null;
        p.label?.remove();
        this.players.delete(id);
      }
    if (this.companion.player.netId && !this.companion.player.active)
      this.companion.player = this.player;
  }
  playerPose(id, s) {
    const p = this.players.get(id);
    if (!p) return;
    const actor = p.actor,
      life = s.life || 0;
    if (actor.life !== life) {
      actor.deadLife = null;
      actor.life = life;
      actor.hurtTime = 0;
      actor.active = false;
    }
    if (!actor.active && actor.deadLife !== life) {
      actor.spawn('player', s.position.x, s.position.y, s.position.z);
      actor.parts = characterParts('player', actor.skinIndex);
    }
    p.target = s;
    actor.mode = s.mode;
    if (s.health < actor.health) actor.hurt = 1.2;
    actor.health = actor.deadLife === life ? 0 : s.health;
    actor.yaw = s.yaw;
    actor.pitch = s.pitch;
    actor.heldBlock = s.heldBlock || B.GRASS;
    if (actor.actionSeq !== s.actionSeq) {
      actor.actionSeq = s.actionSeq;
      actor.actionKind = s.actionKind;
      actor.actionAt = performance.now() / 1000 - (s.actionAge || 0);
    }
    Object.assign(actor.velocity, s.velocity);
    Object.assign(actor.previous, actor.position);
    Object.assign(actor.position, s.position);
    p.at = performance.now();
    actor.heading = s.yaw + Math.PI;
    if (actor.health <= 0) this.killRemote(actor);
  }

  sharedTime(local) {
    return this.guest && this.netTime
      ? this.netTime.time + (performance.now() - this.netTime.at) / 1000
      : local;
  }
  replicaAlpha() {
    return Math.min(1, (performance.now() - this.frameAt) / 100);
  }
  update(dt, { ready, paused, time }) {
    this.ragdollsPaused = paused && this.player.health > 0;
    this.ragdolls.update(dt, ready && !this.guest && !this.ragdollsPaused);
    for (const p of this.players.values()) {
      p.actor.hurtTime = Math.max(0, (p.actor.hurtTime || 0) - dt);
      p.actor.hurt = Math.max(0, (p.actor.hurt || 0) - dt);
    }
    if (!this.connected) return;
    this.world.networkFocus = this.host ? this.actors().map((p) => p.position) : [];
    if (this.host && ready && this.world.epoch !== this.epoch) {
      this.epoch = this.world.epoch;
      this.pending.clear();
      this.effects = [];
      this.send({ type: 'reset', world: this.exportWorld(), edits: worldEdits(this.world) });
    }
    this.timer += dt;
    this.frameTimer += dt;
    this.pingTimer += dt;
    if (this.timer >= 0.05) {
      this.timer = 0;
      if (ready && !this.waiting) this.send({ type: 'position', state: pose(this.player) });
      if (this.host && this.world.epoch === this.epoch) {
        const rows = [...this.pending.values()];
        for (let i = 0; i < rows.length; i += 2048)
          this.send({ type: 'edits', epoch: this.epoch, edits: rows.slice(i, i + 2048) });
        this.pending.clear();
        for (const e of this.effects) this.send({ ...e, epoch: this.epoch });
        this.effects = [];
      }
    }
    if (this.host && ready && this.frameTimer >= 0.1) {
      this.frameTimer = 0;
      this.send({
        type: 'frame',
        epoch: this.epoch,
        mobs: this.entities.pool.filter((e) => e.active).map(mobState),
        bombs: this.tnt.pool.filter((b) => b.active).map(bombState),
        ragdolls: this.ragdolls.snapshot(),
        paused,
        time,
        weather: this.weather.mode,
        pip: { mode: this.companion.mode },
      });
    }
    if (this.pingTimer >= 2) {
      this.pingTimer = 0;
      this.send({ type: 'ping', sent: performance.now() });
    }
  }
  drawPlayers(time) {
    this.ragdolls.draw(this.guest, this.ragdollsPaused);
    const saved = [];
    const now = performance.now();
    for (const p of this.players.values()) {
      const e = p.actor;
      if (!e.active) {
        if (p.label) p.label.hidden = true;
        continue;
      }
      const alpha = Math.min(1, (now - p.at) / 50);
      saved.push([e, { ...e.position }]);
      for (const a of ['x', 'y', 'z'])
        e.position[a] = THREE.MathUtils.lerp(e.previous[a], e.position[a], alpha);
      if (p.label) {
        const pos = new THREE.Vector3(e.position.x, e.position.y + 2.15, e.position.z),
          dist = pos.distanceTo(this.renderer.camera.position);
        pos.project(this.renderer.camera);
        const show =
          dist < 60 && pos.z > -1 && pos.z < 1 && Math.abs(pos.x) < 1.1 && Math.abs(pos.y) < 1.1;
        p.label.hidden = !show;
        if (show)
          p.label.style.transform = `translate(${(pos.x * 0.5 + 0.5) * innerWidth}px,${(-pos.y * 0.5 + 0.5) * innerHeight}px) translate(-50%,-100%)`;
      }
    }
    this.remote.draw(time, null, 1);
    for (const [e, pos] of saved) Object.assign(e.position, pos);
  }
  beginTransition() {
    if (this.host) this.send({ type: 'loading' });
  }
  aim(actor) {
    const c = Math.cos(actor.pitch),
      dir = { x: -Math.sin(actor.yaw) * c, y: Math.sin(actor.pitch), z: -Math.cos(actor.yaw) * c };
    // Three's positive camera X rotation looks upwards.
    const origin = { x: actor.position.x, y: actor.position.y + 1.62, z: actor.position.z };
    return {
      dir,
      origin,
      target: raycast(
        this.world.get.bind(this.world),
        origin,
        dir,
        7,
        (b) => b !== B.AIR && b !== B.PORTAL,
      ),
    };
  }
  performAttack(origin, dir, wallDistance) {
    if (this.guest) {
      for (const e of this.allTargets(this.player).pool) {
        if (!e.active || e.kind === 'companion') continue;
        const p = e.position,
          r = e.width / 2;
        if (
          rayBox(
            origin,
            dir,
            { x: p.x - r, y: p.y, z: p.z - r },
            { x: p.x + r, y: p.y + e.height, z: p.z + r },
          ) < Math.min(4, wallDistance)
        ) {
          this.animate('attack');
          this.request('attack');
          return true;
        }
      }
      return false;
    }
    const hit = attack(this.allTargets(this.player), this.player, origin, dir, wallDistance);
    if (hit) this.animate('attack');
    return hit;
  }
  execute(id, action, data = {}) {
    const actor = this.players.get(id)?.actor;
    if (!actor?.active || actor.health <= 0 || this.waiting) return;
    const { origin, dir, target } = this.aim(actor),
      world = this.world;
    const reply = (message) => this.send({ type: 'notice', epoch: this.epoch, id, message });
    if (action === 'edit') {
      const { x, y, z, b } = data;
      if (!validEdit([dimensionId(world.dimension), x, y, z, b]) || !target || !world.loaded(x, z))
        return;
      if (b === B.AIR) {
        if (target.x !== x || target.y !== y || target.z !== z || target.block === B.BEDROCK)
          return;
      } else if (
        x !== target.x + target.normal.x ||
        y !== target.y + target.normal.y ||
        z !== target.z + target.normal.z ||
        solid(world.get(x, y, z)) ||
        [this.player, ...this.actors(), ...this.entities.pool.filter((e) => e.active)].some((e) =>
          overlapsBlock(e.position, x, y, z, e.width, e.height),
        )
      )
        return;
      world.set(x, y, z, b);
      return;
    }
    if (action === 'attack') {
      const now = performance.now();
      if (now - (actor.attackAt || 0) < 350) return;
      actor.attackAt = now;
      const wall = raycast(world.get.bind(world), origin, dir, 4, solid);
      attack(this.allTargets(actor), actor, origin, dir, wall?.distance ?? 4);
      return;
    }
    if (action === 'companion') {
      if (!['follow', 'stay', 'mine', 'build'].includes(data.command)) return;
      this.companion.player = actor;
      this.companion.command(
        data.command,
        target,
        validEdit([0, 0, 1, 0, data.block]) ? data.block : B.PLANKS,
      );
      return;
    }
    const oldPlayer = this.tnt.player,
      oldOptions = { ...this.tnt.options };
    this.tnt.player = actor;
    Object.assign(this.tnt.options, tntOptions(data.options));
    try {
      if (action === 'ignite') {
        if (target?.block === B.TNT) this.tntMethods.ignite(target);
        else this.portals.ignite(target);
      }
      if (action === 'tnt-nearby') this.tntMethods.detonateNearby();
      if (action === 'tnt-defuse') this.tntMethods.defuse();
      if (action === 'tnt-pattern') {
        const center = target
          ? {
              x: target.x + target.normal.x,
              y: target.y + target.normal.y,
              z: target.z + target.normal.z,
            }
          : {
              x: actor.position.x - Math.sin(actor.yaw) * 8,
              y: actor.position.y,
              z: actor.position.z - Math.cos(actor.yaw) * 8,
            };
        this.tntMethods.spawnPattern(
          center,
          ['line', 'ring', 'cube', 'stack'].includes(data.kind) ? data.kind : 'line',
          clamp(+data.count || 1, 1, 64),
          clamp(+data.spacing || 1, 1, 4),
        );
      }
    } catch {
      reply('That action could not be completed.');
    } finally {
      this.tnt.player = oldPlayer;
      Object.assign(this.tnt.options, oldOptions);
    }
  }
  invite() {
    return inviteURL(this.address, this.room);
  }
}
