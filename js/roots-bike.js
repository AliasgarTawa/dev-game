import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

// Both GLBs come from the same Meshy geometry/UVs. Blend their PBR textures
// on one mesh so wheels, silhouette and the rider's contact points never jump.
export async function loadRootsBike(mount, initialNight = 0) {
  const loader = new GLTFLoader();
  const [day, night] = await Promise.all([
    loader.loadAsync('/dev-game/assets/models/roots-bike/bike.glb'),
    loader.loadAsync('/dev-game/assets/models/roots-bike-night/bike.glb'),
  ]);
  const meshes = root => { const out=[]; root.traverse(o=>{if(o.isMesh)out.push(o)}); return out; };
  const dm=meshes(day.scene), nm=meshes(night.scene);
  if(dm.length !== nm.length) throw new Error('Bike material variants have different mesh counts');
  const amount={value:initialNight};
  dm.forEach((mesh,i)=>{
    for(const key of ['position','uv']) {
      const a=mesh.geometry.getAttribute(key), b=nm[i].geometry.getAttribute(key);
      if(!a || !b || a.array.length!==b.array.length || a.array.some((v,j)=>Math.abs(v-b.array[j])>1e-5))
        throw new Error(`Night bike ${key} differs from day; cannot blend textures safely`);
    }
    const original=mesh.material, other=nm[i].material;
    if(Array.isArray(original)||Array.isArray(other)||!original.map||!other.map)
      throw new Error('Unsupported bike material layout');
    const material=original.clone();
    material.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms, {bikeNight:amount,
        bikeNightMap:{value:other.map},
        bikeNightNormal:{value:other.normalMap||original.normalMap},
        bikeNightRoughness:{value:other.roughnessMap||original.roughnessMap},
        bikeNightMetalness:{value:other.metalnessMap||original.metalnessMap}});
      shader.fragmentShader=`uniform float bikeNight;
        uniform sampler2D bikeNightMap;
        uniform sampler2D bikeNightNormal;
        uniform sampler2D bikeNightRoughness;
        uniform sampler2D bikeNightMetalness;
        ${shader.fragmentShader}`;
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',
        THREE.ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )',
          'mix(texture2D(map, vMapUv), texture2D(bikeNightMap, vMapUv), bikeNight)'));
      for(const [chunk,source,target,uv] of [
        ['roughnessmap_fragment','roughnessMap','bikeNightRoughness','vRoughnessMapUv'],
        ['metalnessmap_fragment','metalnessMap','bikeNightMetalness','vMetalnessMapUv'],
        ['normal_fragment_maps','normalMap','bikeNightNormal','vNormalMapUv'],
      ]) shader.fragmentShader=shader.fragmentShader.replace(`#include <${chunk}>`,
        THREE.ShaderChunk[chunk].replaceAll(`texture2D( ${source}, ${uv} )`,
          `mix(texture2D(${source}, ${uv}), texture2D(${target}, ${uv}), bikeNight)`));
      // Meshy 7 supplies no emissive map. Restrict the local glow to saturated
      // cyan pixels in the night texture; do not make the whole bike emissive.
      shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         vec3 runeColor=texture2D(bikeNightMap,vMapUv).rgb;
         float runeMask=smoothstep(.12,.42,min(runeColor.g,runeColor.b)-runeColor.r);
         totalEmissiveRadiance += runeColor * runeMask * bikeNight * .8;`);
    };
    material.customProgramCacheKey=()=> 'roots-bike-day-night-v1';
    mesh.material=material;
  });
  const bike=day.scene;
  let box=new THREE.Box3().setFromObject(bike), size=box.getSize(new THREE.Vector3());
  bike.scale.setScalar(1.8/Math.max(size.x,size.z));
  bike.rotation.y=-Math.PI/2;
  box=new THREE.Box3().setFromObject(bike);
  const center=box.getCenter(new THREE.Vector3());
  bike.position.set(-center.x,-box.min.y,-center.z);
  mount.add(bike);
  return {bike, setNight(value){amount.value=THREE.MathUtils.clamp(value,0,1)},
    get nightAmount(){return amount.value}};
}
