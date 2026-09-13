import { atmosphereGLSL } from './atmosphere.js';
export const skyVertex = `
varying vec3 vRay;
void main(){vRay=position;vec4 clip=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_Position=clip.xyww;}
`;
export const skyFragment = `
${atmosphereGLSL}
varying vec3 vRay;
void main(){gl_FragColor=vec4(skyRadiance(normalize(vRay)),1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}
`;
