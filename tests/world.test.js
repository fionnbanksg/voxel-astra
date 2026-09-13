import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import { World } from '../dist/src/world.js';
import { THREE } from '../dist/src/renderer.js';
import { B, idx, flowingWater } from '../dist/src/blocks.js';
import { applyEdits } from '../dist/src/network/multiplayer.js';
class WorkerAdapter {
  constructor() {
    this.worker = new NodeWorker(new URL('./worker-adapter.js', import.meta.url));
    this.worker.on('message', (data) => this.onmessage?.({ data }));
    this.worker.on('error', (e) => this.onerror?.(e));
  }
  postMessage(data) {
    this.worker.postMessage(data);
  }
  terminate() {
    return this.worker.terminate();
  }
}
globalThis.Worker = WorkerAdapter;
const until = async (predicate, tick) => {
  const end = Date.now() + 15000;
  while (!predicate()) {
    if (Date.now() > end) throw Error('Worker integration timed out');
    tick();
    await new Promise((r) => setTimeout(r, 8));
  }
};
test('real workers stream, mesh, propagate boundary AO edits, and switch dimensions', async () => {
  const renderer = {
    scene: new THREE.Scene(),
    opaque: new THREE.MeshBasicMaterial(),
    water: new THREE.MeshBasicMaterial(),
    setDimension() {},
  };
  const errors = [];
  const w = new World(renderer, (e) => errors.push(e));
  w.radius = 2;
  try {
    await until(
      () => w.readyCount === 13 && !w.workers.some((s) => s.busy) && !w.uploads.length,
      () => w.update(8, 8),
    );
    assert.deepEqual(errors, []);
    assert.ok(renderer.scene.children.length > 0);
    w.set(15, 47, 15, B.OBSIDIAN);
    assert.equal(w.get(15, 47, 15), B.OBSIDIAN);
    // Corner edit dirties a diagonal chunk and vertical sections on either side.
    assert.ok(w.chunks.get('1,1').dirty.has(2));
    assert.ok(w.chunks.get('1,1').dirty.has(3));
    await until(
      () => !w.chunks.get('0,0').dirty.size && !w.workers.some((s) => s.busy) && !w.uploads.length,
      () => w.update(8, 8),
    );
    w.set(14, 90, 14, flowingWater(4), false, true);
    w.switchDimension('nether');
    await until(
      () => w.readyCount >= 5,
      () => w.update(8, 8),
    );
    assert.equal(w.get(8, 120, 8), B.NETHERRACK);
    // Switch while other chunks are still in flight: stale results must not leak.
    w.switchDimension('overworld');
    await until(
      () => w.chunks.get('0,0')?.ready,
      () => w.update(8, 8),
    );
    assert.equal(w.get(15, 47, 15), B.OBSIDIAN);
    assert.notEqual(w.get(8, 120, 8), B.NETHERRACK);
    assert.equal(w.get(14, 90, 14), flowingWater(4));
    // Regeneration discards edits in both dimensions and ignores in-flight meshes.
    const epoch = w.epoch;
    w.regenerate('new snow world', { preset: 'flat', seaLevel: 28 });
    assert.equal(w.epoch, epoch + 1);
    assert.equal(w.edits.size, 0);
    assert.equal(w.dimension, 'overworld');
    // A network delta can land after dispatch but before the worker returns.
    w.update(8, 8);
    assert.equal(w.loaded(8, 8), false);
    applyEdits(w, [[0, 8, 80, 8, B.TNT]]);
    await until(
      () => w.chunks.get('0,0')?.ready,
      () => w.update(8, 8),
    );
    assert.equal(w.column(8, 8).height, 32);
    assert.equal(w.get(8, 32, 8), B.GRASS);
    assert.equal(w.get(8, 33, 8), B.AIR);
    assert.equal(w.get(8, 80, 8), B.TNT);
    assert.equal(w.get(15, 47, 15), B.AIR);
    assert.equal(w.get(14, 90, 14), B.AIR);
    assert.deepEqual(errors, []);
  } finally {
    await Promise.all(w.workers.map((s) => s.worker.terminate()));
    for (const c of w.chunks.values()) c.dispose(renderer);
  }
});
