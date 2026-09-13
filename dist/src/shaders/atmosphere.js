// Shared sky model: the dome, water reflection and fog use the same sun/day state.
export const atmosphereGLSL = `
uniform float uTime;
uniform float uDay;
uniform float uNether;
uniform float uSnow;
uniform vec3 uSunDirection;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
float hash21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
float cloudNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x),f.y);}
float cloudField(vec2 p){return cloudNoise(p)*.57+cloudNoise(p*2.03)*.28+cloudNoise(p*4.01)*.15;}
vec3 skyRadiance(vec3 ray){
 float altitude=max(ray.y,0.);
 vec3 zenith=mix(vec3(.008,.016,.042),vec3(.10,.32,.62),uDay);
 vec3 horizon=mix(vec3(.035,.052,.10),vec3(.65,.78,.84),uDay);
 vec3 sky=mix(horizon,zenith,pow(altitude,.48));
 float towardSun=max(dot(ray,uSunDirection),0.);
 float sunset=pow(1.-abs(uSunDirection.y),5.)*smoothstep(-.2,.15,uSunDirection.y);
 sky+=vec3(.55,.16,.025)*sunset*pow(towardSun,5.)*pow(1.-altitude,3.);
 sky+=vec3(1.,.69,.32)*pow(towardSun,32.)*.18*uDay;
 sky+=vec3(2.5,2.0,1.2)*smoothstep(.99955,.9998,towardSun)*smoothstep(-.06,.06,uSunDirection.y);
 float moon=max(dot(ray,-uSunDirection),0.);
 sky+=vec3(.40,.51,.72)*smoothstep(.99935,.9997,moon)*(1.-uDay);
 vec2 starUV=vec2(atan(ray.z,ray.x),asin(clamp(ray.y,-1.,1.)))*250.;
 float stars=step(.9977,hash21(floor(starUV)))*pow(max(0.,1.-length(fract(starUV)-.5)*2.),5.);
 sky+=vec3(stars*(1.-uDay)*smoothstep(.03,.3,ray.y)*1.4);
 if(ray.y>.015){
  vec2 cloudUV=ray.xz/max(ray.y,.07)*2.0+vec2(uTime*.009,0.);
  float density=smoothstep(.53,.73,cloudField(cloudUV));
  float feather=smoothstep(.015,.12,ray.y);
  vec3 cloudColor=mix(vec3(.055,.075,.13),vec3(.90,.91,.86),uDay);
  cloudColor*=.86+.14*cloudField(cloudUV+vec2(.2));
  sky=mix(sky,cloudColor,density*feather*.92);
 }
 return mix(sky,mix(vec3(.06,.08,.12),vec3(.49,.57,.64),uDay),uSnow*.86);
}
vec3 atmosphereFog(vec3 color,float distanceToEye){
 float fog=smoothstep(uFogNear,uFogFar,distanceToEye);
 return mix(color,uFogColor,fog);
}
`;
