import http from 'node:http';
import https from 'node:https';
import { readFileSync, createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import {
  GAME_VERSION,
  PROTOCOL,
  MAX_PLAYERS,
  MAX_EDITS,
  validEdit,
  editKey,
  cleanWorld,
  cleanPlayer,
  validRagdolls,
  point,
} from '../dist/src/network/protocol.js';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.zip': 'application/zip',
  '.png': 'image/png',
  '.json': 'application/json',
};
const actions = new Set([
  'edit',
  'attack',
  'ignite',
  'tnt-nearby',
  'tnt-defuse',
  'tnt-pattern',
  'companion',
]);
/** Relay authority: only the room host may publish world edits, simulation
 * snapshots and combat results. Guests submit intents and their own movement.
 * This is a trusted-friends listen server, not a competitive anti-cheat server. */
export function createGameServer({ root = ROOT, maxRooms = 8, allowedOrigins = [], tls } = {}) {
  const rooms = new Map();
  const serve = async (req, res) => {
    try {
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405);
        return res.end();
      }
      const url = new URL(req.url, 'http://local');
      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, version: GAME_VERSION }));
      }
      let path = decodeURIComponent(url.pathname);
      if (path === '/') path = '/index.html';
      if (
        path.split('/').some((p) => p.startsWith('.')) ||
        path.includes('\\') ||
        path.includes('\0')
      )
        throw Error();
      const file = resolve(root, '.' + path);
      if (!file.startsWith(resolve(root) + sep)) throw Error();
      const info = await stat(file);
      if (!info.isFile()) throw Error();
      res.writeHead(200, {
        'Content-Type': MIME[extname(file)] || 'application/octet-stream',
        'Content-Length': info.size,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      });
      if (req.method === 'HEAD') res.end();
      else
        createReadStream(file)
          .on('error', () => res.destroy())
          .pipe(res);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  };
  const server = tls ? https.createServer(tls, serve) : http.createServer(serve);
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 12 * 1024 * 1024,
    perMessageDeflate: false,
  });
  const send = (ws, m) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 16 * 1024 * 1024) {
      ws.close(1013, 'Connection too slow; rejoin the room.');
      return;
    }
    ws.send(JSON.stringify(m));
  };
  const broadcast = (room, m, except) => {
    for (const peer of room.peers.values()) if (peer !== except) send(peer.ws, m);
  };
  const roster = (room) =>
    [...room.peers.values()].map((p) => ({ id: p.id, name: p.name, state: p.state }));
  const welcome = (p, reset = false) =>
    send(p.ws, {
      type: reset ? 'reset' : 'welcome',
      id: p.id,
      room: p.room.id,
      role: p === p.room.host ? 'host' : 'guest',
      world: p.room.world,
      edits: [...p.room.edits.values()],
      seq: p.room.seq,
      players: roster(p.room),
      frame: p.room.frame,
    });
  function leave(p) {
    const r = p.room;
    if (!r) return;
    p.room = null;
    r.peers.delete(p.id);
    if (p === r.host) {
      rooms.delete(r.id);
      for (const guest of r.peers.values()) {
        guest.room = null;
        send(guest.ws, { type: 'closed', reason: 'Host left. The mirrored world is now solo.' });
      }
      r.peers.clear();
    } else broadcast(r, { type: 'players', players: roster(r) });
  }
  function snapshot(m) {
    const world = cleanWorld(m.world);
    if (!Array.isArray(m.edits) || m.edits.length > MAX_EDITS || !m.edits.every(validEdit))
      throw Error('World exceeds the room limit or contains invalid edits.');
    return { world, edits: new Map(m.edits.map((e) => [editKey(e), e])) };
  }
  server.on('upgrade', (req, socket, head) => {
    if (
      req.url !== '/multiplayer' ||
      wss.clients.size >= maxRooms * MAX_PLAYERS + 8 ||
      (allowedOrigins.length && !allowedOrigins.includes(req.headers.origin))
    ) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws) => {
    const p = {
      ws,
      id: randomBytes(8).toString('hex'),
      name: 'Player',
      room: null,
      state: null,
      count: 0,
      window: Date.now(),
      alive: true,
    };
    const handshake = setTimeout(() => {
      if (!p.room) ws.close(1008, 'Create or join a room.');
    }, 30000);
    handshake.unref();
    ws.on('pong', () => (p.alive = true));
    ws.on('error', () => {});
    ws.on('close', () => {
      clearTimeout(handshake);
      leave(p);
    });
    ws.on('message', (raw, binary) => {
      try {
        if (binary) throw Error('Text JSON messages required.');
        if (Date.now() - p.window > 1000) {
          p.window = Date.now();
          p.count = 0;
        }
        if (++p.count > 180) {
          ws.close(1008, 'Message rate exceeded');
          return;
        }
        const m = JSON.parse(raw.toString());
        if (!m || typeof m.type !== 'string') throw Error('Invalid message.');
        if (m.type === 'create' || m.type === 'join') {
          if (p.room) throw Error('Leave the current room first.');
          if (m.version !== GAME_VERSION || m.protocol !== PROTOCOL)
            throw Error('Game/server versions differ. Download the latest source and reload.');
          p.name =
            String(m.name || 'Player')
              .replace(/[\u0000-\u001f<>]/g, '')
              .trim()
              .slice(0, 20) || 'Player';
          if (m.type === 'create') {
            if (rooms.size >= maxRooms) throw Error('Server room limit reached.');
            const data = snapshot(m),
              id = randomBytes(12).toString('hex');
            p.room = { id, host: p, peers: new Map([[p.id, p]]), ...data, seq: 0, frame: null };
            rooms.set(id, p.room);
          } else {
            const r = rooms.get(m.room);
            if (!r) throw Error('Room not found. Ask your friend for a fresh invite.');
            if (r.peers.size >= MAX_PLAYERS) throw Error('Room is full (4 players).');
            p.room = r;
            r.peers.set(p.id, p);
          }
          clearTimeout(handshake);
          welcome(p);
          broadcast(p.room, { type: 'players', players: roster(p.room) }, p);
          return;
        }
        if (m.type === 'leave') {
          leave(p);
          return;
        }
        const r = p.room;
        if (!r) throw Error('Join a room first.');
        if (m.type === 'position') {
          p.state = cleanPlayer(m.state);
          broadcast(r, { type: 'position', id: p.id, state: p.state }, p);
          return;
        }
        if (m.type === 'ping') {
          send(ws, { type: 'pong', sent: m.sent });
          return;
        }
        if (m.type === 'action') {
          if (
            !actions.has(m.action) ||
            raw.length > 16384 ||
            (m.data !== undefined &&
              (!m.data || typeof m.data !== 'object' || Array.isArray(m.data)))
          )
            throw Error('Invalid action.');
          if (m.epoch !== r.world.epoch) return;
          // Use the click's pose, avoiding rejection while the player turns between
          // the regular 20 Hz movement packets. Position remains client-authoritative.
          if (m.state) {
            p.state = cleanPlayer(m.state);
            broadcast(r, { type: 'position', id: p.id, state: p.state }, p);
          }
          send(r.host.ws, {
            type: 'action',
            id: p.id,
            action: m.action,
            data: m.data,
            epoch: m.epoch,
          });
          return;
        }
        if (p !== r.host) throw Error('Only the host can publish world state.');
        if (m.type === 'reset') {
          const data = snapshot(m);
          Object.assign(r, data);
          r.seq = 0;
          r.frame = null;
          for (const peer of r.peers.values()) if (peer !== p) welcome(peer, true);
          return;
        }
        if (m.type === 'loading') {
          broadcast(r, { type: 'loading' }, p);
          return;
        }
        if (m.epoch !== r.world.epoch) return;
        if (m.type === 'edits') {
          if (!Array.isArray(m.edits) || m.edits.length > 2048 || !m.edits.every(validEdit))
            throw Error('Invalid edit batch.');
          const extra = new Set(m.edits.filter((e) => !r.edits.has(editKey(e))).map(editKey));
          if (r.edits.size + extra.size > MAX_EDITS) {
            send(ws, {
              type: 'error',
              fatal: true,
              message: 'Room edit limit reached. Continuing in solo.',
            });
            leave(p);
            return;
          }
          for (const e of m.edits) r.edits.set(editKey(e), e);
          broadcast(r, { type: 'edits', edits: m.edits, seq: ++r.seq, epoch: m.epoch }, p);
          return;
        }
        if (m.type === 'frame') {
          if (
            raw.length > 96000 ||
            !Array.isArray(m.mobs) ||
            m.mobs.length > 28 ||
            !Array.isArray(m.bombs) ||
            m.bombs.length > 64 ||
            !m.mobs.every((e) => point(e.position)) ||
            !m.bombs.every((e) => point(e.position)) ||
            !validRagdolls(m.ragdolls || [])
          )
            throw Error('Invalid simulation frame.');
          r.frame = {
            type: 'frame',
            epoch: m.epoch,
            mobs: m.mobs,
            bombs: m.bombs,
            ragdolls: m.ragdolls || [],
            paused: !!m.paused,
            time: Number(m.time) || 0,
            weather: ['auto', 'clear', 'flurries', 'storm'].includes(m.weather)
              ? m.weather
              : 'auto',
            pip: m.pip,
          };
          broadcast(r, r.frame, p);
          return;
        }
        if (m.type === 'blast') {
          if (!point(m.position) || !Number.isFinite(m.power) || m.power < 2 || m.power > 8)
            throw Error('Invalid blast.');
          broadcast(r, { type: 'blast', epoch: m.epoch, position: m.position, power: m.power }, p);
          return;
        }
        if (m.type === 'damage') {
          if (
            !Number.isFinite(m.amount) ||
            m.amount < 0 ||
            m.amount > 40 ||
            ![m.dx, m.dz].every(Number.isFinite)
          )
            throw Error('Invalid damage.');
          const victim = r.peers.get(m.id);
          if (victim)
            send(victim.ws, { type: 'damage', life: m.life, amount: m.amount, dx: m.dx, dz: m.dz });
          return;
        }
        if (m.type === 'notice') {
          const victim = r.peers.get(m.id);
          if (victim) send(victim.ws, { type: 'notice', message: String(m.message).slice(0, 180) });
          return;
        }
        throw Error('Unknown message.');
      } catch (e) {
        send(ws, { type: 'error', message: e.message || 'Invalid packet.' });
      }
    });
    ws._peer = p;
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const p = ws._peer;
      if (!p.alive) {
        ws.terminate();
        continue;
      }
      p.alive = false;
      ws.ping();
    }
  }, 30000);
  heartbeat.unref();
  return {
    server,
    rooms,
    wss,
    async close() {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      await new Promise((r) => wss.close(r));
      await new Promise((r) => server.close(r));
    },
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8080),
    host = process.env.HOST || '0.0.0.0';
  const tls =
    process.env.TLS_CERT && process.env.TLS_KEY
      ? { cert: readFileSync(process.env.TLS_CERT), key: readFileSync(process.env.TLS_KEY) }
      : undefined;
  const app = createGameServer({
    tls,
    allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean),
  });
  app.server.listen(port, host, () => {
    const scheme = tls ? 'https' : 'http';
    console.log(
      `Voxel Wilds ${GAME_VERSION} · solo + multiplayer\nLocal: ${scheme}://localhost:${port}`,
    );
    for (const nets of Object.values(networkInterfaces()))
      for (const n of nets || [])
        if (n.family === 'IPv4' && !n.internal)
          console.log(`LAN:   ${scheme}://${n.address}:${port}`);
    console.log('Open the game → Multiplayer → Host current world. Ctrl+C stops the server.');
  });
  app.server.on('error', (e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => app.close().then(() => process.exit(0)));
}
