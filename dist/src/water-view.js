import * as THREE from '../vendor/three/three.module.js';
import { isWater } from './blocks.js';
import { waterCorner, waterWave } from './water-mesh.js';
import { waveGLSL, reconstructGLSL } from './shaders/water.js';
import { blockLightGLSL } from './shaders/block-light.js';
export const NEAR_SIZE = 4;
const CORNERS = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
];
// The near plane spans the waterline before the camera center crosses it.
// Four corner heights preserve the same sloping fluid surface used by meshing.
export function fillNearWater(data, get, origin, time = 0) {
  let i = 0;
  for (let z = 0; z < NEAR_SIZE; z++)
    for (let y = 0; y < NEAR_SIZE; y++)
      for (let x = 0; x < NEAR_SIZE; x++) {
        const wx = x + origin.x,
          wy = y + origin.y,
          wz = z + origin.z,
          wet = isWater(get(wx, wy, wz));
        for (const [cx, cz] of CORNERS) {
          let h = wet ? waterCorner(get, wx, wy, wz, cx, cz) : 0;
          if (h > 0 && h < 0.999) h += waterWave(wx + cx, wz + cz, time);
          data[i++] = Math.round(Math.max(0, Math.min(1, h)) * 255);
        }
      }
}
export const screenVertex = `varying vec2 vUV;void main(){vUV=uv;gl_Position=vec4(position.xy,0.,1.);}`;
export const copyFragment = `uniform sampler2D uSceneColor,uSceneDepth;varying vec2 vUV;void main(){gl_FragColor=texture2D(uSceneColor,vUV);gl_FragDepth=texture2D(uSceneDepth,vUV).r;}`;
export const submergedFragment = `
${waveGLSL}
${reconstructGLSL}
${blockLightGLSL}
uniform sampler2D uComposite,uSceneDepth;uniform highp sampler3D uNearWater;
uniform vec3 uNearOrigin;uniform float uTime,uDay;
varying vec2 vUV;
float wetAt(vec2 uv){
 vec3 p=worldAt(uv,0.),cell=floor(p)-uNearOrigin;
 if(any(lessThan(cell,vec3(0.)))||any(greaterThanEqual(cell,vec3(4.))))return 0.;
 vec4 h=texelFetch(uNearWater,ivec3(cell),0);if(dot(h,vec4(1.))<.001)return 0.;
 vec2 f=fract(p.xz);float surface=f.y>=f.x?h.x+f.x*(h.w-h.z)+f.y*(h.z-h.x):h.x+f.x*(h.y-h.x)+f.y*(h.w-h.y);
 return 1.-smoothstep(surface-.004,surface+.004,fract(p.y));
}
void main(){
 float wet=wetAt(vUV);vec3 rgb=texture2D(uComposite,vUV).rgb;
 if(wet>.001){
  vec3 start=worldAt(vUV,0.),end=worldAt(vUV,texture2D(uSceneDepth,vUV).r);
  vec3 ray=normalize(end-start);float limit=min(24.,length(end-start)),waterDistance=0.,previous=0.;
  // Local occupancy comes from the lighting worker; only the exact waterline
  // uses synchronous near-plane data, avoiding an expensive whole-world pass.
  for(int i=0;i<24;i++){
   float f=(float(i)+1.)/24.,d=limit*f*f,stepLength=d-previous;previous=d;
   vec3 p=start+ray*(d-stepLength*.5),cell=floor(p-uLightOrigin);
   if(uLightSize<1.||any(lessThan(cell,vec3(0.)))||any(greaterThanEqual(cell,vec3(uLightSize)))){waterDistance+=stepLength;continue;}
   float h=texelFetch(uBlockLight,ivec3(cell),0).a;
   if(h<.001||fract(p.y)>h+.025)break;
   waterDistance+=stepLength;
  }
  vec2 shifted=clamp(vUV+vec2(sin(vUV.y*38.+uTime*1.4),cos(vUV.x*34.+uTime))*.0008,vec2(.001),vec2(.999));
  if(wetAt(shifted)>.99)rgb=mix(rgb,texture2D(uComposite,shifted).rgb,wet);
  vec3 attenuation=exp(-vec3(.22,.055,.028)*waterDistance);
  vec3 underwater=rgb*attenuation+vec3(.012,.12,.18)*(.3+.7*uDay)*(1.-attenuation);
  rgb=mix(rgb,underwater,wet);
 }
 gl_FragColor=vec4(rgb,1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;
// Render opaque geometry once, copy its depth, then draw refractive water.
// The final pass applies absorption only to submerged near-plane pixels.
// Separate depth attachments avoid sampling a texture bound for rendering.
export class WaterView {
  constructor(renderer) {
    this.renderer = renderer;
    const gl = renderer.gl,
      u = renderer.uniforms;
    const type = gl.extensions.has('EXT_color_buffer_float')
      ? THREE.HalfFloatType
      : THREE.UnsignedByteType;
    this.opaque = new THREE.WebGLRenderTarget(1, 1, { type, depthBuffer: true });
    this.opaque.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    this.composite = new THREE.WebGLRenderTarget(1, 1, { type, depthBuffer: true });
    this.data = new Uint8Array(NEAR_SIZE ** 3 * 4);
    this.near = new THREE.Data3DTexture(this.data, 4, 4, 4);
    this.near.format = THREE.RGBAFormat;
    this.near.unpackAlignment = 1;
    this.near.needsUpdate = true;
    Object.assign(u, {
      uSceneColor: { value: this.opaque.texture },
      uSceneDepth: { value: this.opaque.depthTexture },
      uComposite: { value: this.composite.texture },
      uResolution: { value: new THREE.Vector2() },
      uInvProjection: { value: renderer.camera.projectionMatrixInverse },
      uCameraWorld: { value: renderer.camera.matrixWorld },
      uNearWater: { value: this.near },
      uNearOrigin: { value: new THREE.Vector3() },
    });
    this.screen = new THREE.Scene();
    this.camera = new THREE.Camera();
    this.copy = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: screenVertex,
      fragmentShader: copyFragment,
      depthTest: true,
      depthWrite: true,
      depthFunc: THREE.AlwaysDepth,
      toneMapped: false,
    });
    this.post = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: screenVertex,
      fragmentShader: submergedFragment,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.copy);
    this.quad.frustumCulled = false;
    this.screen.add(this.quad);
    gl.info.autoReset = false;
  }
  resize() {
    const gl = this.renderer.gl,
      s = gl.getDrawingBufferSize(this.renderer.uniforms.uResolution.value);
    this.opaque.setSize(s.x, s.y);
    this.composite.setSize(s.x, s.y);
  }
  draw(world) {
    const r = this.renderer,
      gl = r.gl,
      c = r.camera,
      u = r.uniforms;
    c.updateMatrixWorld();
    u.uNearOrigin.value.copy(c.position).floor().addScalar(-2);
    if (world) fillNearWater(this.data, world.get.bind(world), u.uNearOrigin.value, u.uTime.value);
    else this.data.fill(0);
    this.near.needsUpdate = true;
    gl.info.reset();
    gl.setRenderTarget(this.opaque);
    c.layers.set(0);
    gl.render(r.scene, c);
    // Viewmodel draws over terrain but writes its own depth, so more distant
    // water cannot paint over the hand. The final waterline pass still applies.
    const handBackground = r.scene.background;
    r.scene.background = null;
    gl.autoClear = false;
    c.layers.set(2);
    gl.render(r.scene, c);
    c.layers.set(0);
    gl.autoClear = true;
    r.scene.background = handBackground;
    gl.setRenderTarget(this.composite);
    this.quad.material = this.copy;
    gl.render(this.screen, this.camera);
    const background = r.scene.background;
    r.scene.background = null;
    gl.autoClear = false;
    c.layers.set(1);
    gl.render(r.scene, c);
    r.scene.background = background;
    c.layers.set(0);
    gl.autoClear = true;
    gl.setRenderTarget(null);
    this.quad.material = this.post;
    gl.render(this.screen, this.camera);
  }
}
