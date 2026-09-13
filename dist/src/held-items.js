import { THREE } from './renderer.js';
import { B, isWater, isLava } from './blocks.js';
import { LOG_END } from './textures.js';
import { actionPulse } from './character-motion.js';

// Share the world's pixel atlas, including grass sides, log ends and TNT caps.
export function itemGeometry(block) {
  const g = new THREE.BoxGeometry(1, 1, 1),
    uv = g.attributes.uv;
  const colors = new Float32Array(24 * 3);
  for (let face = 0; face < 6; face++) {
    const top = face === 2,
      bottom = face === 3;
    const tile = isWater(block)
      ? B.WATER
      : isLava(block)
        ? B.LAVA
        : block === B.GRASS
          ? top
            ? B.GRASS
            : bottom
              ? B.DIRT
              : 19
          : block === B.WOOD && (top || bottom)
            ? LOG_END
            : block === B.TNT && (top || bottom)
              ? 23
              : block;
    for (let j = 0; j < 4; j++) {
      const i = face * 4 + j;
      uv.setXY(
        i,
        ((tile % 8) + (uv.getX(i) * 15 + 0.5) / 16) / 8,
        1 - (Math.floor(tile / 8) + ((1 - uv.getY(i)) * 15) / 16 + 0.5 / 16) / 4,
      );
      const tint =
        block === B.LEAVES || (block === B.GRASS && top) ? [0.55, 0.82, 0.36] : [1, 1, 1];
      colors.set(tint, i * 3);
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (block === B.TORCH) g.scale(0.18, 0.85, 0.18);
  if (block === B.SNOW_LAYER) g.scale(1, 0.125, 1);
  return g;
}
export class HeldItems {
  constructor(renderer, count = 28) {
    this.renderer = renderer;
    this.geometries = new Map();
    this.material = renderer.lightMaterial(
      new THREE.MeshLambertMaterial({
        map: renderer.uniforms.uAtlas.value,
        vertexColors: true,
        alphaTest: 0.35,
      }),
    );
    this.pool = Array.from({ length: count }, () => {
      const m = new THREE.Mesh(undefined, this.material);
      m.visible = false;
      m.frustumCulled = false;
      renderer.scene.add(m);
      return m;
    });
  }
  geometry(block) {
    if (!this.geometries.has(block)) this.geometries.set(block, itemGeometry(block));
    return this.geometries.get(block);
  }
  hide() {
    for (const m of this.pool) m.visible = false;
  }
  set(index, block, matrix) {
    const m = this.pool[index];
    if (!m || !block) return;
    m.geometry = this.geometry(block);
    m.matrixAutoUpdate = false;
    m.matrix.copy(matrix);
    m.visible = true;
  }
}

/** A camera-relative arm, rendered after opaque terrain with its own layer.
 * It writes depth only where the arm/item is visible, preserving scene depth
 * for refraction and the existing per-pixel underwater mask. */
export class FirstPersonHand {
  constructor(renderer) {
    this.renderer = renderer;
    this.root = new THREE.Group();
    this.rig = new THREE.Group();
    this.root.add(this.rig);
    renderer.scene.add(this.root);
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.skin = new THREE.MeshLambertMaterial({
      color: '#b88061',
      depthTest: true,
      depthFunc: THREE.AlwaysDepth,
    });
    this.coat = new THREE.MeshLambertMaterial({
      color: '#70547f',
      depthTest: true,
      depthFunc: THREE.AlwaysDepth,
    });
    const arm = new THREE.Mesh(box, this.coat);
    arm.position.set(0, -0.14, 0.08);
    arm.scale.set(0.19, 0.34, 0.2);
    const hand = new THREE.Mesh(box, this.skin);
    hand.position.set(0, 0.035, -0.035);
    hand.scale.set(0.18, 0.16, 0.21);
    this.rig.add(arm, hand);
    this.items = new Map();
    this.material = new THREE.MeshLambertMaterial({
      map: renderer.uniforms.uAtlas.value,
      vertexColors: true,
      alphaTest: 0.35,
      depthTest: true,
      depthFunc: THREE.AlwaysDepth,
    });
    renderer.lightMaterial(this.skin);
    renderer.lightMaterial(this.coat);
    renderer.lightMaterial(this.material);
    this.item = new THREE.Mesh(box, this.material);
    this.item.position.set(0, 0.19, -0.13);
    this.item.rotation.set(0.12, -0.4, 0.08);
    this.item.scale.setScalar(0.28);
    this.rig.add(this.item);
    this.root.traverse((o) => {
      o.layers.set(2);
      o.frustumCulled = false;
    });
    renderer.scene.traverse((o) => {
      if (o.isLight) o.layers.enable(2);
    });
    this.lastYaw = 0;
    this.lastPitch = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.equip = 0;
  }
  update(dt, time, player, block, visible) {
    this.root.visible = visible;
    if (!visible) return;
    if (this.block !== block) {
      this.block = block;
      this.equip = 0.14;
      if (!this.items.has(block)) this.items.set(block, itemGeometry(block));
      this.item.geometry = this.items.get(block);
    }
    const skin = player.skinIndex || 0;
    this.skin.color.set(['#b88061', '#d7ac82', '#8e624d'][skin]);
    this.coat.color.set(['#70547f', '#526478', '#866144'][skin]);
    this.equip = Math.max(0, this.equip - dt);
    const dyaw = Math.atan2(
      Math.sin(player.yaw - this.lastYaw),
      Math.cos(player.yaw - this.lastYaw),
    );
    const dpitch = player.pitch - this.lastPitch;
    const smooth = 1 - Math.exp(-12 * dt);
    this.swayX += (Math.max(-0.06, Math.min(0.06, -dyaw * 0.25)) - this.swayX) * smooth;
    this.swayY += (Math.max(-0.05, Math.min(0.05, dpitch * 0.25)) - this.swayY) * smooth;
    this.lastYaw = player.yaw;
    this.lastPitch = player.pitch;
    const pulse = actionPulse(player),
      moving = Math.min(1, Math.hypot(player.velocity.x, player.velocity.z) / 6);
    const bob = Math.sin(time * 9) * 0.013 * moving;
    this.root.position.copy(this.renderer.camera.position);
    this.root.quaternion.copy(this.renderer.camera.quaternion);
    this.rig.position.set(
      0.4 * Math.min(1, this.renderer.camera.aspect * 0.75) + this.swayX - pulse * 0.14,
      -0.36 + bob + this.swayY - this.equip - pulse * 0.055,
      -0.68 - pulse * 0.22,
    );
    this.rig.rotation.set(-0.08 - pulse * 0.65, 0.08 - pulse * 0.4, 0.12 + pulse * 0.32);
  }
}
