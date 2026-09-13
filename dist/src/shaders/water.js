import { blockLightGLSL } from './block-light.js';
import { atmosphereGLSL } from './atmosphere.js';
export const waveGLSL = `
float waterWave(vec2 p,float t){return sin(p.x*.55+t)*cos(p.y*.61+t*.7)*.018+sin(dot(p,vec2(1.3,.8))-t*1.1)*.007;}
`;
export const reconstructGLSL = `
uniform mat4 uInvProjection,uCameraWorld;
vec3 worldAt(vec2 uv,float depth){vec4 p=uInvProjection*vec4(uv*2.-1.,depth*2.-1.,1.);return (uCameraWorld*vec4(p.xyz/p.w,1.)).xyz;}
`;
export const waterVertex = `
uniform float uTime;attribute vec2 flow;attribute float kind;
varying vec3 vWorld,vNormal,vTint;varying vec2 vFlow;
${waveGLSL}
void main(){vec3 p=position;vec3 world=(modelMatrix*vec4(p,1.)).xyz;
if(fract(p.y)>.001)p.y+=waterWave(world.xz,uTime);
vec4 wp=modelMatrix*vec4(p,1.);vWorld=wp.xyz;vNormal=normal;vFlow=flow;vTint=color;
gl_Position=projectionMatrix*viewMatrix*wp;}`;
export const waterFragment = `
${atmosphereGLSL}
${blockLightGLSL}
${reconstructGLSL}
uniform sampler2D uSceneColor,uSceneDepth;uniform vec2 uResolution;
varying vec3 vWorld,vNormal,vTint;varying vec2 vFlow;
void main(){
 vec3 viewDir=normalize(cameraPosition-vWorld);vec2 p=vWorld.xz-vFlow*uTime*.65;
 vec3 n=normalize(vNormal);
 if(abs(n.y)>.5)n=normalize(vec3(cos(p.x*2.1+p.y*.7+uTime*1.2)*.045+cos(p.y*4.2-uTime*.8)*.018,1.,sin(p.y*2.6+p.x*.3+uTime*.9)*.05));
 if(!gl_FrontFacing)n=-n;
 vec2 uv=gl_FragCoord.xy/uResolution;
 vec2 refractUV=clamp(uv+n.xz*.009,vec2(.001),vec2(.999));
 float surfaceDepth=gl_FragCoord.z;
 if(texture2D(uSceneDepth,refractUV).r<surfaceDepth)refractUV=uv;
 float depth=texture2D(uSceneDepth,refractUV).r;
 float thickness=min(24.,length(worldAt(refractUV,depth)-vWorld));
 vec3 transmitted=texture2D(uSceneColor,refractUV).rgb;
 vec3 absorption=exp(-vec3(.24,.075,.035)*thickness);
 vec3 scatter=vec3(.015,.16,.19)*(.3+.7*uDay)*vTint;
 vec3 base=transmitted*absorption+scatter*(1.-absorption);
 float fresnel=.02+.98*pow(1.-max(dot(viewDir,n),0.),5.);
 vec3 reflected=skyRadiance(reflect(-viewDir,n));
 float spec=pow(max(dot(reflect(-uSunDirection,n),viewDir),0.),220.)*uDay;
 vec3 rgb=mix(base,reflected,clamp(fresnel,.02,.94))+vec3(1.,.9,.7)*spec*2.;
 float foam=(1.-smoothstep(.03,.3,thickness))*smoothstep(.65,.95,sin(p.x*5.+sin(p.y*4.)+uTime)*.5+.5);
 rgb=mix(rgb,vec3(.65,.79,.76)*(.4+.6*uDay),foam*.22);
 rgb+=blockRadiance(vWorld+n*.55)*.25;
 gl_FragColor=vec4(atmosphereFog(rgb,length(cameraPosition-vWorld)),1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;
