import { WaterView } from './water-view.js';
import { LIGHT_SIZE } from './block-light.js';
import { blockLightGLSL } from './shaders/block-light.js';
import * as THREE from '../vendor/three/three.module.js';
import { tilePixel } from './textures.js';
export { leafPixelVisible } from './textures.js';
import { skyVertex, skyFragment } from './shaders/sky.js';
import { terrainVertex, terrainFragment } from './shaders/terrain.js';
import { waterVertex, waterFragment } from './shaders/water.js';
import { effectsVertex, effectsFragment } from './shaders/effects.js';
export { THREE };
export function makeAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  for (let b = 0; b < 32; b++)
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const color = tilePixel(b, x, y);
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect((b % 8) * 16 + x, Math.floor(b / 8) * 16 + y, 1, 1);
      }
  // Original pixel art: striped red charges, a white label and a dark fuse.
  const tx = 6 * 16,
    ty = 2 * 16;
  ctx.fillStyle = '#bb3026';
  ctx.fillRect(tx, ty, 16, 16);
  ctx.fillStyle = '#f36541';
  for (let x = 1; x < 16; x += 4) ctx.fillRect(tx + x, ty, 2, 16);
  ctx.fillStyle = '#f5e9cc';
  ctx.fillRect(tx, ty + 5, 16, 7);
  ctx.fillStyle = '#34291e';
  ctx.font = 'bold 6px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('TNT', tx + 8, ty + 11);
  ctx.fillStyle = '#d65335';
  ctx.fillRect(112, 32, 16, 16);
  ctx.fillStyle = '#982b24';
  for (let i = 1; i < 16; i += 4) {
    ctx.fillRect(112 + i, 32, 1, 16);
    ctx.fillRect(112, 32 + i, 16, 1);
  }
  ctx.fillStyle = '#40362b';
  ctx.fillRect(119, 38, 2, 5);
  ctx.fillRect(117, 39, 6, 2);
  const atlas = new THREE.CanvasTexture(canvas);
  atlas.magFilter = THREE.NearestFilter;
  atlas.minFilter = THREE.NearestFilter;
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.generateMipmaps = false;
  // Grass/leaf tiles are neutral for biome tinting in the world. Give the
  // inventory its own tinted copy so their icons remain recognizably green.
  const icons = document.createElement('canvas');
  icons.width = 128;
  icons.height = 64;
  const iconContext = icons.getContext('2d');
  iconContext.drawImage(canvas, 0, 0);
  for (const tile of [1, 6]) {
    const x = (tile % 8) * 16,
      y = Math.floor(tile / 8) * 16,
      pixels = iconContext.getImageData(x, y, 16, 16);
    for (let i = 0; i < pixels.data.length; i += 4) {
      pixels.data[i] *= 0.65;
      pixels.data[i + 1] *= 0.9;
      pixels.data[i + 2] *= 0.43;
    }
    iconContext.putImageData(pixels, x, y);
  }
  return { atlas, canvas: icons };
}
export class Renderer {
  constructor(canvas) {
    const context = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      powerPreference: 'high-performance',
    });
    if (!context)
      throw Error(
        'WebGL2 is required. Enable hardware acceleration and reload in a desktop browser.',
      );
    this.gl = new THREE.WebGLRenderer({ canvas, context });
    this.gl.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.18;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xabcdd9);
    this.scene.fog = new THREE.Fog(0xabcdd9, 70, 155);
    this.camera = new THREE.PerspectiveCamera(73, 1, 0.08, 300);
    this.camera.rotation.order = 'YXZ';
    const { atlas, canvas: atlasCanvas } = makeAtlas();
    this.atlasCanvas = atlasCanvas;
    const lightTexture = new THREE.Data3DTexture(
      new Uint8Array(LIGHT_SIZE ** 3 * 4),
      LIGHT_SIZE,
      LIGHT_SIZE,
      LIGHT_SIZE,
    );
    lightTexture.format = THREE.RGBAFormat;
    lightTexture.type = THREE.UnsignedByteType;
    lightTexture.minFilter = lightTexture.magFilter = THREE.LinearFilter;
    lightTexture.unpackAlignment = 1;
    lightTexture.needsUpdate = true;
    this.uniforms = {
      uBlockLight: { value: lightTexture },
      uBlastLights: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) },
      uLightOrigin: { value: new THREE.Vector3() },
      uLightSize: { value: 0 },
      uSnow: { value: 0 },
      uTime: { value: 0 },
      uDay: { value: 1 },
      uNether: { value: 0 },
      uSunDirection: { value: new THREE.Vector3(0.6, 0.7, -0.3).normalize() },
      uFogColor: { value: new THREE.Color(0.6, 0.75, 0.84) },
      uFogNear: { value: 70 },
      uFogFar: { value: 155 },
      uAtlas: { value: atlas },
    };
    const terrain = (leaves) =>
      new THREE.ShaderMaterial({
        uniforms: { ...this.uniforms, uFoliage: { value: leaves ? 1 : 0 } },
        vertexShader: terrainVertex,
        fragmentShader: terrainFragment,
        vertexColors: true,
        side: leaves ? THREE.DoubleSide : THREE.FrontSide,
      });
    this.opaque = terrain(false);
    this.cutout = terrain(true);
    // Refraction already composites the opaque scene; depth-writing chooses
    // the nearest water surface without section-level alpha sorting artifacts.
    this.water = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: waterVertex,
      fragmentShader: waterFragment,
      vertexColors: true,
      transparent: false,
      depthWrite: true,
      side: THREE.DoubleSide,
    });
    this.effects = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: effectsVertex,
      fragmentShader: effectsFragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 12),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.scene.add(this.sky);
    // Standard lights keep the instanced creature models consistent with terrain.
    this.hemisphere = new THREE.HemisphereLight(0xb5d9ff, 0x4d5031, 1.2);
    this.scene.add(this.hemisphere);
    this.sunLight = new THREE.DirectionalLight(0xffe2b0, 2);
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);
    this.target = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.006, 1.006, 1.006)),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }),
    );
    this.target.visible = false;
    this.scene.add(this.target);
    this.dimension = 'overworld';
    this.light = 1;
    this.snowFog = new THREE.Color();
    this.waterView = new WaterView(this);
    this.setDimension('overworld');
    addEventListener('resize', () => this.resize());
    this.resize();
  }
  lightMaterial(material) {
    material.onBeforeCompile = (shader) => {
      for (const name of ['uBlockLight', 'uLightOrigin', 'uLightSize', 'uBlastLights'])
        shader.uniforms[name] = this.uniforms[name];
      shader.vertexShader = 'varying vec3 vBlockWorld;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 lightVertex=vec4(transformed,1.);
        #ifdef USE_INSTANCING
        lightVertex=instanceMatrix*lightVertex;
        #endif
        vBlockWorld=(modelMatrix*lightVertex).xyz;`,
      );
      shader.fragmentShader =
        'varying vec3 vBlockWorld;\n' + blockLightGLSL + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        'outgoingLight += diffuseColor.rgb * blockRadiance(vBlockWorld);\n#include <opaque_fragment>',
      );
    };
    material.customProgramCacheKey = () => 'voxel-block-light-v2';
    return material;
  }
  resize() {
    this.gl.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.waterView?.resize();
  }
  setDimension(d) {
    this.dimension = d;
    this.uniforms.uNether.value = d === 'nether' ? 1 : 0;
    this.sky.visible = d !== 'nether';
  }
  setLight(light) {
    this.light = light;
  }
  draw(t, world) {
    const u = this.uniforms,
      nether = this.dimension === 'nether',
      phase = t / 120 + 0.9;
    u.uTime.value = t;
    u.uSnow.value = nether ? 0 : this.snow || 0;
    u.uDay.value = Math.max(0, Math.min(1, (this.light - 0.25) / 0.75));
    u.uSunDirection.value.set(Math.cos(phase), Math.sin(phase), -0.35).normalize();
    this.sky.position.copy(this.camera.position);
    const day = u.uDay.value;
    if (nether) u.uFogColor.value.setRGB(0.1, 0.033, 0.07);
    else u.uFogColor.value.setRGB(0.035 + day * 0.57, 0.052 + day * 0.67, 0.1 + day * 0.69);
    u.uFogNear.value = nether ? 22 : 70;
    u.uFogFar.value = nether ? 110 : 155;
    if (!nether && u.uSnow.value > 0) {
      u.uFogColor.value.lerp(
        this.snowFog.setRGB(0.1 + day * 0.4, 0.12 + day * 0.45, 0.17 + day * 0.48),
        u.uSnow.value * 0.8,
      );
      u.uFogNear.value = 70 - u.uSnow.value * 50;
      u.uFogFar.value = 155 - u.uSnow.value * 85;
    }
    this.scene.background.copy(u.uFogColor.value);
    this.scene.fog.color.copy(u.uFogColor.value);
    this.scene.fog.near = u.uFogNear.value;
    this.scene.fog.far = u.uFogFar.value;
    this.hemisphere.intensity = nether ? 0.55 : 0.28 + day * 0.85;
    this.sunLight.intensity = nether ? 0.5 : day * 2 * (1 - u.uSnow.value * 0.65);
    this.sunLight.position.copy(this.camera.position).addScaledVector(u.uSunDirection.value, 100);
    this.sunLight.target.position.copy(this.camera.position);
    this.waterView.draw(world);
  }
}
