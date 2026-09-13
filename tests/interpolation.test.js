import test from 'node:test';
import assert from 'node:assert/strict';
import { RemotePoseBuffer } from '../dist/src/network/interpolation.js';
const pose = (yaw, pitch = 0, x = 0, life = 0) => ({
  yaw,
  pitch,
  position: { x, y: 2, z: 3 },
  life,
});
const near = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test('20 Hz snapshots render smooth position, yaw and pitch at 30/60/144 Hz', () => {
  for (const fps of [30, 60, 144]) {
    const buffer = new RemotePoseBuffer(),
      out = {};
    let nextPacket = 0;
    for (let now = 0; now < 1500; now += 1000 / fps) {
      while (nextPacket <= now) {
        const t = nextPacket / 1000;
        buffer.push(pose(t * 2, t * 0.3, t * 3), nextPacket);
        nextPacket += 50;
      }
      buffer.sample(now, out);
      const t = Math.max(0, now - 100) / 1000;
      near(out.yaw, t * 2);
      near(out.pitch, t * 0.3);
      near(out.x, t * 3);
      assert.ok(buffer.count <= 16);
    }
  }
});

test('yaw crosses the angle seam by the shortest arc and irregular packets do not restart interpolation', () => {
  const buffer = new RemotePoseBuffer(),
    out = {};
  buffer.push(pose((179 * Math.PI) / 180, -0.4), 0);
  buffer.push(pose((-179 * Math.PI) / 180, 0.4), 50);
  buffer.sample(125, out);
  near(out.yaw, Math.PI);
  near(out.pitch, 0);
  // A later packet must not move the already-rendered part of the timeline.
  buffer.push(pose((-175 * Math.PI) / 180, 0.5), 130);
  buffer.sample(125, out);
  near(out.yaw, Math.PI);
  buffer.sample(190, out);
  near(out.yaw, (183 * Math.PI) / 180);
  buffer.sample(600, out);
  near(out.yaw, (185 * Math.PI) / 180, 1e-7); // Holds newest; never extrapolates a spin.
});

test('teleports, respawns and long stalls reset history; coincident timestamps stay finite', () => {
  const buffer = new RemotePoseBuffer(),
    out = {};
  assert.equal(buffer.sample(0, out), false);
  buffer.push(pose(0), 0);
  buffer.push(pose(1), 0);
  assert.equal(buffer.count, 1);
  buffer.sample(0, out);
  near(out.yaw, 1);
  buffer.push(pose(2, 0.2, 50), 50);
  buffer.sample(50, out);
  near(out.x, 50);
  near(out.yaw, 2);
  buffer.push(pose(-2, -0.2, 51, 1), 100);
  buffer.sample(100, out);
  near(out.x, 51);
  near(out.yaw, -2);
  buffer.push(pose(0, 0, 52, 1), 1000);
  buffer.sample(1000, out);
  near(out.yaw, 0);
  near(out.x, 52);
  assert.equal(buffer.count, 1);
  buffer.reset();
  assert.equal(buffer.sample(1100, out), false);
});
