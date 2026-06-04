import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b7ff);

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  2000
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.getElementById('app').appendChild(renderer.domElement);

// Lights
const hemi = new THREE.HemisphereLight(0xffffff, 0x223344, 0.8);
scene.add(hemi);

const dir = new THREE.DirectionalLight(0xffffff, 0.9);
dir.position.set(50, 100, 50);
scene.add(dir);

// Controls (simple WASD + mouse look)
const keys = new Set();
window.addEventListener('keydown', (e) => keys.add(e.code));
window.addEventListener('keyup', (e) => keys.delete(e.code));

let yaw = 0;
let pitch = 0;
let isPointerLocked = false;

renderer.domElement.addEventListener('click', () => {
  renderer.domElement.requestPointerLock?.();
});

document.addEventListener('pointerlockchange', () => {
  isPointerLocked = document.pointerLockElement === renderer.domElement;
});

document.addEventListener('mousemove', (e) => {
  if (!isPointerLocked) return;
  yaw -= e.movementX * 0.002;
  pitch -= e.movementY * 0.002;
  pitch = Math.max(-1.2, Math.min(1.2, pitch));
});

// Player car
const player = {
  obj: null,
  speed: 0,
  steering: 0
};

const clock = new THREE.Clock();

function createCarFallback() {
  const geo = new THREE.BoxGeometry(1.6, 0.6, 3.2);
  const mat = new THREE.MeshStandardMaterial({ color: 0xff3333, metalness: 0.1, roughness: 0.6 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, 0.5, 0);
  scene.add(mesh);
  player.obj = mesh;
}

async function loadLevelOBJ() {
  // Assumes the user has copied extracted level assets into the 3d folder.
  // Specifically: 3d/level/level.obj and 3d/level/level.mtl should exist.
  // If your names differ, update here.
  const objUrl = '/level/level.obj';
  const mtlUrl = '/level/level.mtl';

  // Prefer MTL if present
  try {
    const mtlLoader = new MTLLoader();
    const materials = await new Promise((resolve, reject) => {
      mtlLoader.load(
        mtlUrl,
        (m) => resolve(m),
        undefined,
        (err) => reject(err)
      );
    });
    materials.preload();

    const objLoader = new OBJLoader();
    objLoader.setMaterials(materials);

    const obj = await new Promise((resolve, reject) => {
      objLoader.load(
        objUrl,
        (o) => resolve(o),
        undefined,
        (err) => reject(err)
      );
    });

    obj.position.set(0, 0, 0);
    obj.rotation.y = 0;
    obj.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = false;
        child.receiveShadow = true;
      }
    });

    scene.add(obj);
    return obj;
  } catch {
    // If no mtl exists, try plain obj
    const objLoader = new OBJLoader();
    const obj = await new Promise((resolve, reject) => {
      objLoader.load(
        objUrl,
        (o) => resolve(o),
        undefined,
        (err) => reject(err)
      );
    });
    scene.add(obj);
    return obj;
  }
}

async function loadCarsGLB() {
  // Recommended: user exports/places cars model as GLB.
  // Put it at 3d/cars/LowPolyCars.glb
  try {
    const gltfLoader = new GLTFLoader();
    const gltf = await new Promise((resolve, reject) => {
      gltfLoader.load(
        '/cars/LowPolyCars.glb',
        (g) => resolve(g),
        undefined,
        (err) => reject(err)
      );
    });

    const root = gltf.scene;
    // Scale to reasonable size (tweak if needed)
    root.scale.setScalar(1);
    root.position.set(0, 0.5, 0);
    scene.add(root);
    player.obj = root;

    // Also spawn a few AI/static cars around for visuals
    const clones = 10;
    for (let i = 0; i < clones; i++) {
      const c = root.clone(true);
      c.position.set((Math.random() - 0.5) * 60, 0.5, (Math.random() - 0.5) * 60);
      c.rotation.y = Math.random() * Math.PI * 2;
      scene.add(c);
    }
  } catch {
    createCarFallback();
  }
}

await loadLevelOBJ();
await loadCarsGLB();

// Camera follow (third-person)
function updateCamera() {
  const target = player.obj ? player.obj.position : new THREE.Vector3(0, 0, 0);

  // offset behind the car
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);

  const back = new THREE.Vector3(-sin, 0.2, -cos).multiplyScalar(7.0);
  const up = new THREE.Vector3(0, 3.0, 0);

  const camPos = target.clone().add(back).add(up);
  camera.position.lerp(camPos, 0.15);
  camera.lookAt(target.clone().add(new THREE.Vector3(0, 1.0, 0)));
}

function updatePlayer(dt) {
  if (!player.obj) return;

  const accel = 18;
  const maxSpeed = 16;
  const friction = 10;

  const forward = (keys.has('KeyW') || keys.has('ArrowUp'));
  const backward = (keys.has('KeyS') || keys.has('ArrowDown'));
  const left = keys.has('KeyA') || keys.has('ArrowLeft');
  const right = keys.has('KeyD') || keys.has('ArrowRight');

  if (forward) player.speed += accel * dt;
  if (backward) player.speed -= accel * dt;

  // steering affects yaw (simple)
  const steerStrength = 1.4;
  player.steering = 0;
  if (left) player.steering = 1;
  if (right) player.steering = -1;

  const steer = player.steering * steerStrength * dt * THREE.MathUtils.clamp(Math.abs(player.speed) / maxSpeed, 0.2, 1);
  yaw += steer;
  player.obj.rotation.y = yaw;

  // friction
  if (!forward && !backward) {
    const sign = Math.sign(player.speed);
    const next = Math.max(0, Math.abs(player.speed) - friction * dt);
    player.speed = next * sign;
  }

  player.speed = THREE.MathUtils.clamp(player.speed, -maxSpeed, maxSpeed);

  // move
  const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  player.obj.position.add(dir.multiplyScalar(player.speed * dt));

  // keep on some floor-ish plane
  player.obj.position.y = 0.5;
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  updatePlayer(dt);
  updateCamera();

  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();

