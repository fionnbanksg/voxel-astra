// The sample is offset into the face's open voxel by callers. Interpolation
// softens the flood without introducing a full-screen lighting pass.
export const blockLightGLSL = `
uniform highp sampler3D uBlockLight;
uniform vec3 uLightOrigin;
uniform float uLightSize;
uniform vec4 uBlastLights[4];
vec3 blastRadiance(vec3 world){
 vec3 light=vec3(0.);
 for(int i=0;i<4;i++){
  if(uBlastLights[i].w<=0.)continue;
  float distance=length(world-uBlastLights[i].xyz);
  float falloff=pow(max(0.,1.-distance/10.),2.);
  light+=vec3(1.,.52,.16)*falloff*uBlastLights[i].w*3.;
 }
 return light;
}
vec3 blockRadiance(vec3 world){
 vec3 burst=blastRadiance(world);
 if(uLightSize<1.)return burst;
 vec3 uv=(world-uLightOrigin)/uLightSize;
 if(any(lessThan(uv,vec3(0.)))||any(greaterThan(uv,vec3(1.))))return burst;
 vec3 edge=min(uv,1.-uv)*uLightSize;
 float fade=smoothstep(0.,3.,min(edge.x,min(edge.y,edge.z)));
 return texture(uBlockLight,uv).rgb*fade*2.5+burst;
}
`;
