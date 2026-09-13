import { THREE } from './renderer.js';
import { B, H, solid, foliage, key } from './blocks.js';
import { snowVertex, snowFragment } from './shaders/snow.js';
export function snowAmount(mode, column, dimension) {
  if (dimension === 'nether' || mode === 'clear') return 0;
  if (mode === 'storm') return 1;
  if (mode === 'flurries') return 0.4;
  return column.frozen ? 0.65 : 0;
}
// A single thin dusting: passable and replaceable, never an endless snow pillar.
export function canSnowOn(b) {
  return (
    solid(b) &&
    b !== B.SNOW &&
    b !== B.OBSIDIAN &&
    b !== B.NETHERRACK &&
    b !== B.CRIMSON &&
    b !== B.WARPED
  );
}
export class Weather {
  constructor(renderer, world) {
    this.world = world;
    this.renderer = renderer;
    this.mode = 'auto';
    this.amount = 0;
    this.timer = 0;
    this.scan = 0;
    this.cache = new Map();
    this.goal = 0;
    this.count = 1600;
    this.positions = new Float32Array(this.count * 3);
    this.exposure = new Float32Array(this.count);
    this.sizes = new Float32Array(this.count);
    this.speeds = new Float32Array(this.count);
    this.initialized = false;
    for (let i = 0; i < this.count; i++) {
      this.sizes[i] = 0.5 + Math.random();
      this.speeds[i] = 1.8 + Math.random() * 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    g.setAttribute('exposure', new THREE.BufferAttribute(this.exposure, 1));
    g.setAttribute('flakeSize', new THREE.BufferAttribute(this.sizes, 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uAmount: { value: 0 }, uPixelRatio: { value: renderer.gl.getPixelRatio() } },
      vertexShader: snowVertex,
      fragmentShader: snowFragment,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    renderer.scene.add(this.points);
  }
  reset() {
    this.cache.clear();
    this.initialized = false;
    this.amount = 0;
    this.timer = 0;
    this.scan = 0;
  }
  roof(x, z) {
    x = Math.floor(x);
    z = Math.floor(z);
    const chunk = this.world.chunks.get(key(Math.floor(x / 16), Math.floor(z / 16)));
    if (!chunk?.data) return H;
    const k = `${x},${z}`,
      cached = this.cache.get(k);
    if (cached?.chunk === chunk && cached.revision === chunk.revision) return cached.y;
    let y = H - 1;
    for (; y > 0; y--) if (this.world.get(x, y, z) !== B.AIR) break;
    this.cache.set(k, { chunk, revision: chunk.revision, y });
    return y;
  }
  update(dt, time, position, active) {
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = 0.5;
      this.goal = snowAmount(
        this.mode,
        this.world.column(position.x, position.z),
        this.world.dimension,
      );
    }
    this.amount += (this.goal - this.amount) * Math.min(1, dt * 1.5);
    if (this.world.dimension === 'nether') this.amount = 0;
    this.renderer.snow = this.amount;
    this.points.visible = this.amount > 0.01;
    if (!this.points.visible) return;
    if (this.cache.size > 9000) this.cache.clear();
    const p = this.positions;
    for (let i = 0; i < this.count; i++) {
      const j = i * 3;
      if (!this.initialized) {
        p[j] = position.x + (Math.random() - 0.5) * 56;
        p[j + 1] = position.y - 6 + Math.random() * 30;
        p[j + 2] = position.z + (Math.random() - 0.5) * 56;
      }
      p[j] += dt * (0.6 + this.amount * 1.8 + Math.sin(time * 0.6 + i) * 0.4);
      p[j + 1] -= dt * this.speeds[i];
      p[j + 2] += dt * Math.sin(time * 0.2 + i) * 0.5;
      for (const axis of [0, 2]) {
        const center = axis === 0 ? position.x : position.z;
        while (p[j + axis] < center - 28) p[j + axis] += 56;
        while (p[j + axis] > center + 28) p[j + axis] -= 56;
      }
      while (p[j + 1] < position.y - 6) p[j + 1] += 30;
      while (p[j + 1] > position.y + 24) p[j + 1] -= 30;
      this.exposure[i] = p[j + 1] > this.roof(p[j], p[j + 2]) + 1 ? 1 : 0;
    }
    this.initialized = true;
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.exposure.needsUpdate = true;
    this.material.uniforms.uAmount.value = this.amount;
    if (active) {
      this.timer += dt;
      if (this.timer > 0.35) {
        this.timer = 0;
        const x = Math.floor(position.x + (Math.random() - 0.5) * 32),
          z = Math.floor(position.z + (Math.random() - 0.5) * 32),
          y = this.roof(x, z);
        if (
          y < H - 1 &&
          canSnowOn(this.world.get(x, y, z)) &&
          this.world.get(x, y + 1, z) === B.AIR
        )
          this.world.set(x, y + 1, z, B.SNOW_LAYER, false, true);
      }
    }
  }
}
