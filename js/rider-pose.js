import * as THREE from 'three';

// Pose the original, unrigged Meshy mascot in its native Y-up, +Z-forward space.
// Preserve its UVs/textures and leave the face, ears, feet and tail unchanged.
export function mountRider(rider, mount, options = {}) {
  const box = new THREE.Box3().setFromObject(rider);
  const size = box.getSize(new THREE.Vector3());
  const scale = .95 / size.y;
  rider.traverse(object => {
    if (!object.isMesh) return;
    object.geometry = object.geometry.clone();
    const p = object.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const side = THREE.MathUtils.smoothstep(Math.abs(x), .22, .39);
      const front = THREE.MathUtils.smoothstep(z, -.02, .18);
      const height = THREE.MathUtils.smoothstep(y, -.57, -.37) *
        (1 - THREE.MathUtils.smoothstep(y, -.03, .18));
      const weight = side * front * height;
      p.setXYZ(i, x * (1 - .57 * weight),
        y, z - .30 * weight);
    }
    p.needsUpdate = true;
    object.geometry.computeVertexNormals();
    object.geometry.computeBoundingBox();
    object.geometry.computeBoundingSphere();
  });
  rider.scale.setScalar(scale);
  rider.rotation.y = Math.PI;
  // Use the ORIGINAL bounds: arm extension must not recenter the rider off its seat.
  rider.position.set((box.min.x + box.max.x) * scale / 2,
    .48 - box.min.y * scale,
    .18 + (box.min.z + box.max.z) * scale / 2);
  mount.add(rider);
  // Rounded replacement riding arms, fitted to the generated bike's asymmetric grips.
  // The source paws are tucked into the torso above; no additional model/API call.
  const orange = new THREE.MeshStandardMaterial({color:0xf5770b, roughness:.42});
  const arms = new THREE.Group();
  arms.name = 'Mascot riding arms';
  for (const [side, grip] of (options.grips || [[-1, [-.464,.976,-.444]], [1, [.458,.951,-.162]]])) {
    const shoulder = new THREE.Vector3(side * .19,1.04,.17);
    const elbow = new THREE.Vector3(side * .34,.92,.10);
    const hand = new THREE.Vector3(...grip);
    const wrist = hand.clone().add(new THREE.Vector3(0,0,.055));
    const path = new THREE.CatmullRomCurve3([shoulder, elbow, wrist]);
    const arm = new THREE.Mesh(new THREE.TubeGeometry(path,32,.057,12,false), orange);
    arms.add(arm);
    for (const joint of [shoulder,elbow]) {
      const sphere=new THREE.Mesh(new THREE.SphereGeometry(.058,16,12),orange);
      sphere.position.copy(joint); arms.add(sphere);
    }
    // Cupped paw with fingers curling over each grip; the black grip remains visible at its end.
    const palm=new THREE.Mesh(new THREE.SphereGeometry(1,20,14),orange);
    palm.scale.set(.071,.049,.065); palm.position.copy(hand).add(new THREE.Vector3(0,.025,0));
    arms.add(palm);
    for (let finger=0;finger<3;finger++) {
      const digit=new THREE.Mesh(new THREE.SphereGeometry(1,12,10),orange);
      digit.scale.set(.018,.034,.032);
      digit.position.copy(hand).add(new THREE.Vector3((finger-1)*.035,-.002,-.037));
      arms.add(digit);
    }
    const thumb=new THREE.Mesh(new THREE.SphereGeometry(1,12,10),orange);
    thumb.scale.set(.025,.028,.044);
    thumb.position.copy(hand).add(new THREE.Vector3(-side*.052,.004,.027));
    arms.add(thumb);
  }
  mount.add(arms);
}
