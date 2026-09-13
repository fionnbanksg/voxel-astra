import { atmosphereGLSL } from './atmosphere.js';
export const effectsVertex = `
attribute float kind;
varying vec2 vUV;
varying vec3 vWorld;
varying float vKind;
void main(){vec4 wp=modelMatrix*vec4(position,1.);vWorld=wp.xyz;vUV=uv;vKind=kind;gl_Position=projectionMatrix*viewMatrix*wp;}
`;
export const effectsFragment = `
${atmosphereGLSL}
uniform sampler2D uAtlas;
varying vec2 vUV;
varying vec3 vWorld;
varying float vKind;
void main(){
 float wave=sin(vWorld.x*3.+vWorld.y*4.+vWorld.z*2.-uTime*2.)*.5+.5;
 vec3 col=vKind<12.?mix(vec3(1.2,.20,.012),vec3(1.7,.65,.04),wave):mix(vec3(.24,.015,.6),vec3(.69,.19,1.2),wave);
 col*=.8+texture2D(uAtlas,vUV).r*.3;
 if(vKind>20.){vec3 tex=texture2D(uAtlas,vUV).rgb;float flame=smoothstep(.40,.44,vUV.y);col=mix(tex*.4,tex*vec3(2.,1.2,.55)*( .92+.08*sin(uTime*11.)),flame); }
 gl_FragColor=vec4(atmosphereFog(col,length(cameraPosition-vWorld)),vKind>20.?1.:vKind<12.?.96:.65);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}
`;
