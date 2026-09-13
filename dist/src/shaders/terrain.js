import { blockLightGLSL } from './block-light.js';
import { atmosphereGLSL } from './atmosphere.js';
export const terrainVertex = `
uniform float uTime;
uniform float uFoliage;
attribute float sky;
varying vec2 vUV;
varying vec3 vTint;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vSky;
void main(){
 vec3 p=position;
 vec3 world=(modelMatrix*vec4(p,1.)).xyz;
 // Only leaves sway; trunks and collidable terrain keep exact voxel positions.
 p.x+=sin(world.x*.7+world.z*.3+uTime*1.6)*.023*uFoliage;
 p.z+=cos(world.z*.6+uTime*1.2)*.017*uFoliage;
 vec4 wp=modelMatrix*vec4(p,1.);
 vWorld=wp.xyz;vNormal=normalize(mat3(modelMatrix)*normal);vUV=uv;vTint=color;vSky=sky;
 gl_Position=projectionMatrix*viewMatrix*wp;
}
`;
export const terrainFragment = `
${atmosphereGLSL}
${blockLightGLSL}
uniform sampler2D uAtlas;
varying vec2 vUV;
varying vec3 vTint;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vSky;
void main(){
 vec4 tex=texture2D(uAtlas,vUV);
 if(tex.a<.5)discard;
 vec3 n=normalize(vNormal)*(gl_FrontFacing?1.:-1.);
 float hemi=n.y*.5+.5;
 vec3 ambient=mix(vec3(.065,.073,.082),vec3(.28,.35,.43),hemi)*(.3+.7*uDay);
 float sun=max(dot(n,uSunDirection),0.)*uDay;
 // Moving cloud shade is projected over the landscape, while baked skylight
 // suppresses direct light under terrain and gently attenuates tree canopies.
 vec2 projection=vWorld.xz-uSunDirection.xz*(110.-vWorld.y)/max(.2,uSunDirection.y);
 float cloudShade=1.-smoothstep(.55,.75,cloudField(projection*.017+vec2(uTime*.009,0.)))*.24;
 vec3 lighting=ambient*(.35+.65*vSky)+vec3(1.05,.94,.75)*sun*cloudShade*vSky;
 lighting+=vec3(.025,.04,.075)*(1.-uDay)*max(dot(n,-uSunDirection),0.)*vSky;
 lighting=mix(lighting,vec3(.52,.29,.30)*(.65+.35*hemi),uNether);
 lighting+=blockRadiance(vWorld+n*.55)*( .97+.03*sin(uTime*7.+vWorld.x*.3));
 vec3 rgb=tex.rgb*vTint*lighting;
 gl_FragColor=vec4(atmosphereFog(rgb,length(cameraPosition-vWorld)),1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}
`;
