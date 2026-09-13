import { B, H } from '../blocks.js';
import { normalizeOptions, seedNumber } from '../world-options.js';
export const GAME_VERSION = '1.8.2',
  PROTOCOL = 2,
  MAX_PLAYERS = 4,
  MAX_EDITS = 200000;
const blocks = new Set([...Object.values(B), ...Array.from({ length: 16 }, (_, i) => 32 + i)]);
export const dimensionId = (d) => (d === 'nether' ? 1 : 0);
export const dimensionName = (d) => (d === 1 ? 'nether' : 'overworld');
const xyz = (p) => ({ x: p.x, y: p.y, z: p.z });
export function point(p) {
  return p && ['x', 'y', 'z'].every((k) => Number.isFinite(p[k]) && Math.abs(p[k]) <= 1000000);
}
export function validEdit(e) {
  return (
    Array.isArray(e) &&
    e.length === 5 &&
    (e[0] === 0 || e[0] === 1) &&
    e.slice(1).every(Number.isInteger) &&
    Math.abs(e[1]) <= 1000000 &&
    e[2] > 0 &&
    e[2] < H &&
    Math.abs(e[3]) <= 1000000 &&
    blocks.has(e[4])
  );
}
export const editKey = (e) => e.slice(0, 4).join(',');
export function cleanWorld(w) {
  if (
    !w ||
    !point(w.spawn) ||
    !['overworld', 'nether'].includes(w.dimension) ||
    !Number.isSafeInteger(w.epoch)
  )
    throw Error('Invalid world snapshot.');
  return {
    seed: seedNumber(w.seed),
    options: normalizeOptions(w.options),
    dimension: w.dimension,
    epoch: w.epoch,
    spawn: xyz(w.spawn),
  };
}
export function cleanPlayer(p) {
  if (
    !p ||
    !point(p.position) ||
    !point(p.velocity) ||
    !Number.isFinite(p.yaw) ||
    !Number.isFinite(p.pitch) ||
    !['survival', 'creative'].includes(p.mode)
  )
    throw Error('Invalid player state.');
  return {
    position: xyz(p.position),
    velocity: xyz(p.velocity),
    yaw: p.yaw,
    pitch: Math.max(-1.54, Math.min(1.54, p.pitch)),
    mode: p.mode,
    health: Math.max(0, Math.min(20, Number(p.health) || 0)),
    flying: !!p.flying,
    life: Number.isSafeInteger(p.life) && p.life >= 0 ? p.life : 0,
    heldBlock: blocks.has(p.heldBlock) ? p.heldBlock : B.GRASS,
    actionSeq: Number.isInteger(p.actionSeq) ? p.actionSeq >>> 0 : 0,
    actionKind: ['attack', 'mine', 'place', 'use'].includes(p.actionKind) ? p.actionKind : 'mine',
    actionAge: Math.max(0, Math.min(1, Number(p.actionAge) || 0)),
  };
}
export function endpoint(value, base) {
  const url = new URL(value || base, base);
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || url.username || url.password)
    throw Error('Use an HTTP(S) or WS(S) server address.');
  url.protocol = ['https:', 'wss:'].includes(url.protocol) ? 'wss:' : 'ws:';
  url.pathname = '/multiplayer';
  url.search = '';
  url.hash = '';
  return url.href;
}
export function inviteURL(address, room) {
  const u = new URL(address);
  u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
  u.pathname = '/';
  u.search = '';
  u.hash = new URLSearchParams({ room }).toString();
  return u.href;
}

export function validRagdolls(rows) {
  return (
    Array.isArray(rows) &&
    rows.length <= 16 &&
    rows.every(
      (r) =>
        Number.isSafeInteger(r.id) &&
        r.id > 0 &&
        ['player', 'rival', 'ember', 'sheep', 'companion'].includes(r.kind) &&
        Number.isInteger(r.skin) &&
        r.skin >= 0 &&
        r.skin <= 28 &&
        typeof r.source === 'string' &&
        r.source.length <= 80 &&
        Number.isFinite(r.age) &&
        r.age >= 0 &&
        r.age <= 9 &&
        Array.isArray(r.points) &&
        r.points.length === 33 &&
        r.points.every((n) => Number.isFinite(n) && Math.abs(n) <= 1000010),
    )
  );
}
