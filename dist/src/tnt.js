import { THREE } from './renderer.js';
import { B, C, H, colors, liquid, solid, voxelKey, idx } from './blocks.js';
import { moveBody, overlapsBlock } from './physics.js';
import { raycast } from './raycast.js';
import { blastCells, tntPattern } from './blast.js';
// Bounded pools keep fuse animation and debris independent of terrain remeshing.
// Unlit charges remain ordinary voxels; priming transfers one into the actor pool.
export class TNT {
  constructor(renderer, world, player, entities, notify) {
    Object.assign(this, { renderer, world, player, entities, notify });
    this.options = { fuse: 4, power: 4, chain: true, damage: true, shake: true, volume: 0.35 };
    this.epoch = world.epoch;
    this.blocks = new Map();
    this.queue = [];
    this.edits = [];
    this.editHead = 0;
    this.shake = 0;
    this.flash = 0;
    this.particleCursor = 0;
    this.bursts = Array.from({ length: 4 }, () => ({ x: 0, y: 0, z: 0, life: 0, strength: 0 }));
    this.pool = Array.from({ length: 64 }, () => ({
      active: false,
      position: { x: 0, y: 0, z: 0 },
      previous: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      width: 0.98,
      height: 0.98,
      grounded: false,
      fuse: 0,
      smoke: 0,
    }));
    this.particles = Array.from({ length: 640 }, () => ({
      life: 0,
      total: 1,
      x: 0,
      y: 0,
      z: 0,
      previousX: 0,
      previousY: 0,
      previousZ: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      size: 1,
      smoke: false,
      color: new THREE.Color(),
    }));
    this.dummy = new THREE.Object3D();
    const g = new THREE.BoxGeometry(0.98, 0.98, 0.98),
      uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      const face = Math.floor(i / 4),
        tile = face === 2 || face === 3 ? 23 : 22;
      uv.setXY(
        i,
        ((tile % 8) * 16 + 0.5 + uv.getX(i) * 15) / 128,
        1 - (Math.floor(tile / 8) * 16 + 0.5 + (1 - uv.getY(i)) * 15) / 64,
      );
    }
    this.flashValues = new Float32Array(64);
    g.setAttribute('flash', new THREE.InstancedBufferAttribute(this.flashValues, 1));
    const material = renderer.lightMaterial(
        new THREE.MeshLambertMaterial({ map: renderer.uniforms.uAtlas.value }),
      ),
      base = material.onBeforeCompile;
    material.onBeforeCompile = (s) => {
      base(s);
      s.vertexShader = 'attribute float flash;varying float vFlash;\n' + s.vertexShader;
      s.vertexShader = s.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvFlash=flash;',
      );
      s.fragmentShader = 'varying float vFlash;\n' + s.fragmentShader;
      s.fragmentShader = s.fragmentShader.replace(
        '#include <opaque_fragment>',
        'outgoingLight=mix(outgoingLight,vec3(1.8),vFlash*.9);\n#include <opaque_fragment>',
      );
    };
    material.customProgramCacheKey = () => 'primed-tnt-v1';
    this.mesh = new THREE.InstancedMesh(g, material, 64);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    renderer.scene.add(this.mesh);
    const pg = new THREE.BoxGeometry(1, 1, 1);
    this.lifeValues = new Float32Array(this.particles.length);
    pg.setAttribute('life', new THREE.InstancedBufferAttribute(this.lifeValues, 1));
    const pm = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    pm.onBeforeCompile = (s) => {
      s.vertexShader = 'attribute float life;varying float vLife;\n' + s.vertexShader;
      s.vertexShader = s.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvLife=life;',
      );
      s.fragmentShader = 'varying float vLife;\n' + s.fragmentShader;
      s.fragmentShader = s.fragmentShader.replace(
        '#include <opaque_fragment>',
        'diffuseColor.a*=vLife;\n#include <opaque_fragment>',
      );
    };
    pm.customProgramCacheKey = () => 'blast-particles-v1';
    this.particleMesh = new THREE.InstancedMesh(pg, pm, this.particles.length);
    this.particleMesh.frustumCulled = false;
    this.particleMesh.count = 0;
    this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    renderer.scene.add(this.particleMesh);
    const onEdit = world.onEdit,
      onChunkLoaded = world.onChunkLoaded;
    world.onEdit = (x, y, z, b, prev, record) => {
      onEdit(x, y, z, b, prev, record);
      const k = voxelKey(x, y, z);
      if (b === B.TNT) this.blocks.set(k, { x, y, z });
      else this.blocks.delete(k);
    };
    world.onChunkLoaded = (c) => {
      onChunkLoaded(c);
      for (let y = 1; y < H; y++)
        for (let z = 0; z < C; z++)
          for (let x = 0; x < C; x++)
            if (c.data[idx(x, y, z)] === B.TNT)
              this.blocks.set(voxelKey(c.cx * C + x, y, c.cz * C + z), {
                x: c.cx * C + x,
                y,
                z: c.cz * C + z,
              });
    };
  }
  unlockAudio() {
    if (!this.audio) {
      const A = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!A) return;
      this.audio = new A();
      this.noise = this.audio.createBuffer(1, this.audio.sampleRate, this.audio.sampleRate);
      const a = this.noise.getChannelData(0);
      for (let i = 0; i < a.length; i++)
        a[i] = (Math.random() * 2 - 1) * Math.exp((-i / a.length) * 6);
    }
    this.audio.resume().catch(() => {});
  }
  sound(distance = 0) {
    if (!this.audio || this.audio.state !== 'running' || !this.options.volume) return;
    const source = this.audio.createBufferSource(),
      gain = this.audio.createGain(),
      filter = this.audio.createBiquadFilter();
    source.buffer = this.noise;
    source.playbackRate.value = 0.65 + Math.random() * 0.25;
    filter.type = 'lowpass';
    filter.frequency.value = 1800 / (1 + distance * 0.03);
    gain.gain.value = (this.options.volume * 0.65) / (1 + distance * 0.08);
    source.connect(filter).connect(gain).connect(this.audio.destination);
    source.start();
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }
  reset() {
    this.blocks.clear();
    this.queue = [];
    this.edits = [];
    this.editHead = 0;
    for (const b of this.pool) b.active = false;
    for (const p of this.particles) p.life = 0;
    this.shake = this.flash = 0;
    for (const b of this.bursts) b.life = 0;
    for (const v of this.renderer.uniforms.uBlastLights?.value || []) v.w = 0;
    this.epoch = this.world.epoch;
  }
  prime(x, y, z, fuse = this.options.fuse) {
    const b = this.pool.find((b) => !b.active);
    if (!b || this.world.get(x, y, z) !== B.TNT) return false;
    this.world.set(x, y, z, B.AIR, false, true);
    b.active = true;
    b.fuse = fuse;
    b.power = this.options.power;
    b.chain = this.options.chain;
    b.damage = this.options.damage;
    b.smoke = 0;
    b.grounded = false;
    Object.assign(b.position, { x: x + 0.5, y: y + 0.03, z: z + 0.5 });
    Object.assign(b.previous, b.position);
    const a = Math.random() * Math.PI * 2;
    Object.assign(b.velocity, { x: Math.sin(a) * 0.5, y: 4, z: Math.cos(a) * 0.5 });
    return true;
  }
  ignite(target) {
    if (!target || target.block !== B.TNT)
      return this.notify('Aim at TNT and press F to light the fuse.');
    if (this.prime(target.x, target.y, target.z))
      this.notify('TNT primed · ' + this.options.fuse + ' second fuse');
    else this.notify('The active TNT limit is 64.');
  }
  detonateNearby() {
    let count = 0;
    for (const p of this.blocks.values())
      if (
        Math.hypot(
          p.x - this.player.position.x,
          p.y - this.player.position.y,
          p.z - this.player.position.z,
        ) < 32 &&
        this.prime(p.x, p.y, p.z)
      )
        count++;
    this.notify(count ? 'Lit ' + count + ' nearby TNT blocks.' : 'No unlit TNT within 32 blocks.');
  }
  defuse() {
    let count = 0;
    for (const b of this.pool)
      if (b.active) {
        b.active = false;
        count++;
      }
    this.queue = [];
    this.notify('Defused ' + count + ' active TNT.');
  }
  spawnPattern(center, kind, count, spacing) {
    let placed = 0;
    for (const p of tntPattern(center, kind, count, spacing)) {
      if (
        p.y <= 0 ||
        p.y >= H ||
        !this.world.loaded(p.x, p.z) ||
        this.world.get(p.x, p.y, p.z) !== B.AIR ||
        overlapsBlock(this.player.position, p.x, p.y, p.z) ||
        [...this.entities.pool, ...(this.extraActors?.() || [])].some(
          (e) => e.active && overlapsBlock(e.position, p.x, p.y, p.z, e.width, e.height),
        )
      )
        continue;
      if (this.world.set(p.x, p.y, p.z, B.TNT)) placed++;
    }
    this.notify(
      'Placed ' + placed + ' TNT blocks. F lights one; the TNT menu can light all nearby.',
    );
  }
  particle(x, y, z, smoke, color, size, speed = 1) {
    const p = this.particles[this.particleCursor++ % this.particles.length];
    p.x = x;
    p.y = y;
    p.z = z;
    p.previousX = x;
    p.previousY = y;
    p.previousZ = z;
    p.smoke = smoke;
    p.size = size;
    p.total = p.life = smoke ? 1.2 + Math.random() * 0.9 : 0.5 + Math.random() * 0.7;
    p.vx = (Math.random() - 0.5) * speed;
    p.vz = (Math.random() - 0.5) * speed;
    p.vy = smoke ? 1 + Math.random() * 1.5 : Math.random() * speed;
    p.color.set(color);
  }
  tick(dt) {
    if (this.epoch !== this.world.epoch) this.reset();
    this.shake *= Math.exp(-6 * dt);
    this.flash *= Math.exp(-18 * dt);
    for (const b of this.bursts) b.life = Math.max(0, b.life - dt);
    for (const b of this.pool) {
      if (!b.active) continue;
      Object.assign(b.previous, b.position);
      b.fuse -= dt;
      b.smoke -= dt;
      const oldY = b.velocity.y;
      b.velocity.y = Math.max(-30, b.velocity.y - 16 * dt);
      if (liquid(this.world.get(b.position.x, b.position.y + 0.4, b.position.z))) {
        b.velocity.x *= 0.96;
        b.velocity.z *= 0.96;
        b.velocity.y *= 0.92;
      }
      const landed = moveBody(b, this.world, dt, false);
      if (landed > 1) {
        b.velocity.y = Math.abs(oldY) * 0.35;
        b.grounded = false;
      }
      if (b.grounded) {
        b.velocity.x *= Math.exp(-5 * dt);
        b.velocity.z *= Math.exp(-5 * dt);
      }
      if (b.smoke <= 0) {
        b.smoke = 0.1;
        this.particle(b.position.x, b.position.y + 1, b.position.z, true, '#636164', 0.1, 0.2);
      }
      if (b.fuse <= 0) {
        b.active = false;
        this.queue.push({
          position: { x: b.position.x, y: b.position.y + 0.5, z: b.position.z },
          power: b.power,
          chain: b.chain,
          damage: b.damage,
        });
      }
    }
    this.tickParticles(dt);
  }
  tickParticles(dt) {
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.previousX = p.x;
      p.previousY = p.y;
      p.previousZ = p.z;
      p.life -= dt;
      p.vy += (p.smoke ? 0.6 : -13) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (!p.smoke && this.world.collides(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))) {
        p.life = Math.min(p.life, 0.15);
        p.vy = 0;
      }
      if (p.smoke) p.size += dt * 0.35;
    }
  }
  replicaTick(dt) {
    this.shake *= Math.exp(-6 * dt);
    this.flash *= Math.exp(-18 * dt);
    for (const b of this.bursts) b.life = Math.max(0, b.life - dt);
    // Cosmetic smoke only: the host owns fuses, blast damage and terrain edits.
    this.replicaSmoke = (this.replicaSmoke || 0) + dt;
    if (this.replicaSmoke >= 0.1) {
      this.replicaSmoke = 0;
      for (const b of this.pool)
        if (b.active)
          this.particle(b.position.x, b.position.y + 0.6, b.position.z, true, '#686567', 0.18, 0.3);
    }
    this.tickParticles(dt);
  }
  visualBlast(p, power, cells = []) {
    const d = Math.hypot(
        p.x - this.player.position.x,
        p.y - this.player.position.y,
        p.z - this.player.position.z,
      ),
      wet = liquid(this.world.get(p.x, p.y, p.z));
    if (this.options.shake) this.shake = Math.min(1, this.shake + Math.max(0, 1 - d / 30) * 0.7);
    this.flash = Math.max(this.flash, Math.max(0, 1 - d / 24) * 0.35);
    this.sound(d);
    // Reuse the oldest light when dense chains exceed the four-light budget.
    const burst = this.bursts.reduce((a, b) => (a.life < b.life ? a : b));
    Object.assign(burst, {
      x: p.x,
      y: p.y,
      z: p.z,
      life: 0.38,
      strength: ((wet ? 0.35 : 1) * power) / 4,
    });
    for (let i = 0; i < 100; i++) {
      const smoke = i < 45,
        color = wet
          ? '#86d4e2'
          : smoke
            ? i % 2
              ? '#b2aaa2'
              : '#686567'
            : i < 65
              ? '#ffd892'
              : colors[cells[i % Math.max(1, cells.length)]?.b] || '#968b7a';
      this.particle(
        p.x + (Math.random() - 0.5) * 1.3,
        p.y + (Math.random() - 0.5) * 1.3,
        p.z + (Math.random() - 0.5) * 1.3,
        smoke,
        color,
        smoke ? 0.45 : 0.13,
        power * 3,
      );
    }
  }
  // At most one blast and 120 voxel edits per rendered frame.
  flush() {
    if (this.queue.length && this.edits.length - this.editHead < 256) {
      const b = this.queue.shift(),
        p = b.position,
        cells = blastCells(this.world, p, b.power);
      for (const c of cells) this.edits.push({ ...c, chain: b.chain });
      this.visualBlast(p, b.power, cells);
      this.onBlast?.(p, b.power);
      if (b.damage)
        for (const e of this.targets?.() || [this.player, ...this.entities.pool]) {
          if (e !== this.player && !e.active) continue;
          const dx = e.position.x - p.x,
            dy = e.position.y + e.height * 0.5 - p.y,
            dz = e.position.z - p.z,
            dist = Math.hypot(dx, dy, dz),
            reach = b.power * 2;
          if (dist >= reach) continue;
          const blocked = raycast(
            this.world.get.bind(this.world),
            p,
            { x: dx / (dist || 1), y: dy / (dist || 1), z: dz / (dist || 1) },
            dist,
            solid,
          );
          if (!blocked) {
            const force = 1 - dist / reach;
            e.damage(
              Math.max(1, Math.round(force * force * 18)),
              (dx / (dist || 1)) * force * 2,
              (dz / (dist || 1)) * force * 2,
            );
          }
        }
    }
    let budget = 120;
    const deadline = performance.now() + 2.5;
    while (budget-- && this.editHead < this.edits.length && performance.now() < deadline) {
      const p = this.edits[this.editHead++];
      if (this.world.get(p.x, p.y, p.z) !== p.b) continue;
      if (p.b === B.TNT && p.chain) this.prime(p.x, p.y, p.z, 0.3 + Math.random() * 0.8);
      else this.world.set(p.x, p.y, p.z, B.AIR, false, true);
    }
    if (this.editHead === this.edits.length) {
      this.edits = [];
      this.editHead = 0;
    }
  }
  draw(alpha) {
    const lights = this.renderer.uniforms.uBlastLights?.value;
    if (lights)
      for (let i = 0; i < this.bursts.length; i++) {
        const b = this.bursts[i];
        lights[i].set(b.x, b.y, b.z, b.strength * Math.pow(b.life / 0.38, 2));
      }
    let n = 0;
    for (const b of this.pool) {
      if (!b.active) continue;
      const size = 1 + Math.pow(Math.max(0, 1 - b.fuse / 0.4), 4) * 0.22;
      this.dummy.position.set(
        THREE.MathUtils.lerp(b.previous.x, b.position.x, alpha),
        THREE.MathUtils.lerp(b.previous.y, b.position.y, alpha) + 0.5,
        THREE.MathUtils.lerp(b.previous.z, b.position.z, alpha),
      );
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.setScalar(size);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(n, this.dummy.matrix);
      this.flashValues[n++] = Math.floor(b.fuse * (b.fuse < 1 ? 10 : 2.5)) % 2;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.geometry.attributes.flash.needsUpdate = true;
    n = 0;
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      this.dummy.position.set(
        THREE.MathUtils.lerp(p.previousX, p.x, alpha),
        THREE.MathUtils.lerp(p.previousY, p.y, alpha),
        THREE.MathUtils.lerp(p.previousZ, p.z, alpha),
      );
      this.dummy.scale.setScalar(p.size);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.particleMesh.setMatrixAt(n, this.dummy.matrix);
      this.particleMesh.setColorAt(n, p.color);
      this.lifeValues[n++] = Math.min(1, (p.life / p.total) * 2) * (p.smoke ? 0.5 : 1);
    }
    this.particleMesh.count = n;
    this.particleMesh.instanceMatrix.needsUpdate = true;
    this.particleMesh.geometry.attributes.life.needsUpdate = true;
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
  }
}
