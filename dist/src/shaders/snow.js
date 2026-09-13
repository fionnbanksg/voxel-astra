export const snowVertex = `
attribute float flakeSize;
attribute float exposure;
varying float vAlpha;
uniform float uAmount;
uniform float uPixelRatio;
void main(){
 vec4 mv=modelViewMatrix*vec4(position,1.);
 gl_Position=projectionMatrix*mv;
 gl_PointSize=clamp(flakeSize*uPixelRatio*170./max(1.,-mv.z),1.,9.);
 vAlpha=exposure*uAmount*smoothstep(38.,12.,-mv.z)*smoothstep(.2,2.,-mv.z);
}`;
export const snowFragment = `
varying float vAlpha;
void main(){
 vec2 p=gl_PointCoord-.5;
 float soft=1.-smoothstep(.18,.5,length(p));
 if(soft*vAlpha<.025)discard;
 gl_FragColor=vec4(.88,.94,1.,soft*vAlpha*.85);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;
