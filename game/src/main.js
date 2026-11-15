// EMBERLINE: a round-based tactical FPS in Ember Yard. Vanguard (you + two allies) attack;
// five Sentinels hold sites A and B. Plant the charge or eliminate the defence; first to
// three rounds takes the match. Fixed 60 Hz simulation, rendering reads state only.
//
// Boot and the one loop. ?shot=start|play|end|objective with &seed=N sets up a deterministic
// frame for a capture, renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createState, setBanner } from './state.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { buildViewmodel, WEAPONS, createWeaponState } from './weapons.js';
import { createSim, stepSim, startMatch, damageActor, buy } from './sim.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;

const S = createState(seed);
const audio = createAudio();
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(PALETTE.fog, 30, 72);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 140);
scene.add(camera);

// Lights: hemisphere wash, one shadowed sun, a warm pool over A and a cool one over B.
scene.add(new THREE.HemisphereLight(0xcfc4a8, 0x2b2723, 1.15));
const sun = new THREE.DirectionalLight(0xffe0b3, 1.7);
sun.position.set(20, 30, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -30;
sun.shadow.camera.right = 30;
sun.shadow.camera.top = 30;
sun.shadow.camera.bottom = -30;
sun.shadow.camera.far = 80;
scene.add(sun);
const lightA = new THREE.PointLight(0xe8862e, 14, 20, 2);
lightA.position.set(-16, 4, -12);
scene.add(lightA);
const lightB = new THREE.PointLight(0x3fa7a0, 14, 20, 2);
lightB.position.set(16, 4, -12);
scene.add(lightB);
// Muzzle light rides on the camera.
const muzzleLight = new THREE.PointLight(0xffc27a, 0, 9, 2);
muzzleLight.position.set(0.2, -0.15, -0.6);
camera.add(muzzleLight);

const world = createWorld(scene);
const viewmodel = buildViewmodel(camera);
const input = createInput(renderer.domElement, onLockChange);

// --- Transient effects, pooled so the hot loop allocates nothing ---------------
const tracerPool = [];
{
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9 });
  for (let i = 0; i < 24; i++) {
    const line = new THREE.Line(geo.clone(), mat.clone());
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracerPool.push(line);
  }
}
const flashTexture = (() => {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,220,140,1)');
  grad.addColorStop(0.4, 'rgba(255,150,50,0.7)');
  grad.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const flashPool = [];
for (let i = 0; i < 6; i++) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTexture, transparent: true, depthWrite: false }));
  sprite.visible = false;
  sprite.scale.setScalar(0.7);
  scene.add(sprite);
  flashPool.push({ sprite, t: -1 });
}
let flashI = 0;
function showFlash(pos, scale) {
  const f = flashPool[flashI];
  flashI = (flashI + 1) % flashPool.length;
  f.sprite.position.copy(pos);
  f.sprite.scale.setScalar(scale);
  f.sprite.visible = true;
  f.t = S.time;
}
// Explosion: one expanding sphere + light, reused.
const boom = new THREE.Mesh(
  new THREE.SphereGeometry(1, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0xff8c2e, transparent: true, opacity: 0 }),
);
boom.visible = false;
scene.add(boom);
const boomLight = new THREE.PointLight(0xff8c2e, 0, 26, 2);
scene.add(boomLight);
let boomT = -1;
let boomPos = new THREE.Vector3();
// Grenade meshes, pooled.
const grenadePool = [];
for (let i = 0; i < 4; i++) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x2b2b26, roughness: 0.4, metalness: 0.6 }),
  );
  mesh.visible = false;
  mesh.castShadow = true;
  scene.add(mesh);
  grenadePool.push(mesh);
}
// The planted charge: a dark box with a blinking beacon.
const chargeMesh = new THREE.Group();
{
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.35), new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.5 }));
  box.position.y = 0.15;
  const beacon = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.12, 0.12),
    new THREE.MeshBasicMaterial({ color: 0xd43d2a }),
  );
  beacon.position.y = 0.36;
  beacon.name = 'beacon';
  chargeMesh.add(box, beacon);
  chargeMesh.visible = false;
  scene.add(chargeMesh);
}

const fx = {
  tracer(from, to) {
    S.tracers.push({ from: from.clone(), to: to.clone(), t: S.time });
  },
  muzzleFlash(pos) {
    muzzleLight.intensity = 1.6;
    showFlash(pos, 0.32);
  },
  botMuzzle(bot, pos) {
    showFlash(pos, 0.5);
  },
  impact(point) {
    showFlash(point, 0.35);
  },
  explosion(pos) {
    boomPos.copy(pos);
    boom.position.copy(pos);
    boom.visible = true;
    boomT = S.time;
    boomLight.position.copy(pos);
    boomLight.intensity = 60;
  },
};

const sim = createSim(S, world, scene, audio, fx);
const hud = createHud(onPlay, (id) => buy(sim, id));

function onPlay() {
  audio.unlock();
  if (S.phase === 'menu' || S.phase === 'matchEnd') {
    startMatch(sim);
    input.requestLock();
  } else {
    hud.showPaused(false);
    input.requestLock();
  }
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    hud.showPaused(false);
  } else if ((S.phase === 'round' || S.phase === 'buy') && S.player.alive) {
    hud.showPaused(true);
  }
}

function syncCamera() {
  const p = S.player;
  camera.position.set(p.x, p.y + p.eye, p.z);
  camera.rotation.set(p.pitch + p.recoilPitch, p.yaw + p.recoilYaw, 0, 'YXZ');
  viewmodel.update(1 / 60, p.moveAmount, sim.bobPhase);
}

function syncFx(dt) {
  // Tracers fade with age.
  for (let i = 0; i < tracerPool.length; i++) {
    const line = tracerPool[i];
    const t = S.tracers[i];
    if (!t) {
      line.visible = false;
      continue;
    }
    const age = S.time - t.t;
    line.visible = age < 0.07;
    if (line.visible) {
      const pos = line.geometry.attributes.position;
      pos.setXYZ(0, t.from.x, t.from.y, t.from.z);
      pos.setXYZ(1, t.to.x, t.to.y, t.to.z);
      pos.needsUpdate = true;
      line.material.opacity = 0.9 * (1 - age / 0.07);
    }
  }
  for (const f of flashPool) {
    if (f.sprite.visible && S.time - f.t > 0.08) f.sprite.visible = false;
  }
  muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 60);
  if (boom.visible) {
    const age = S.time - boomT;
    if (age > 0.6) {
      boom.visible = false;
      boomLight.intensity = 0;
    } else {
      const r = 0.5 + age * 9;
      boom.scale.setScalar(r);
      boom.material.opacity = 0.85 * (1 - age / 0.6);
      boomLight.intensity = 60 * (1 - age / 0.6);
    }
  }
  for (let i = 0; i < grenadePool.length; i++) {
    const g = S.grenades[i];
    const mesh = grenadePool[i];
    if (!g) {
      mesh.visible = false;
      continue;
    }
    mesh.visible = true;
    mesh.position.set(g.x, g.y, g.z);
  }
  // Planted charge + blinking beacon.
  if (S.charge.state === 'planted') {
    chargeMesh.visible = true;
    chargeMesh.position.set(S.charge.x, 0, S.charge.z);
    const beacon = chargeMesh.getObjectByName('beacon');
    beacon.material.color.setHex(Math.floor(S.time * 3) % 2 === 0 ? 0xd43d2a : 0x57150e);
  } else {
    chargeMesh.visible = false;
  }
}

let accumulator = 0;
let lastTime = performance.now();
let frozen = false;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      stepSim(sim, FIXED_STEP, input);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    syncFx(dt);
  }
  hud.frame(S, spreadNow());
  renderer.render(scene, camera);
}

function spreadNow() {
  const p = S.player;
  const ws = p.current === 'primary' ? p.weapons.primary : p.weapons.pistol;
  if (!ws) return 0.02;
  const def = WEAPONS[ws.id];
  let s = def.spread;
  if (!p.onGround) s *= 2.5;
  else if (p.moveAmount > 0.05) s *= 1 + p.moveAmount * 0.9;
  if (p.crouch) s *= 0.7;
  return s + ws.bloom;
}

function settle(steps) {
  for (let i = 0; i < steps; i++) stepSim(sim, FIXED_STEP, input);
}

function runShot(name) {
  const p = S.player;
  if (name === 'start') {
    p.x = 0;
    p.z = 15;
    p.yaw = 0;
    p.pitch = 0;
  } else if (name === 'play') {
    startMatch(sim);
    S.banner = null;
    S.phase = 'round';
    S.phaseT = 0;
    p.weapons.primary = createWeaponState('rifle');
    p.current = 'primary';
    p.x = -6;
    p.z = 2;
    p.yaw = 0;
    p.pitch = 0;
    const foe = S.enemies[4];
    foe.x = -6;
    foe.z = -3;
    foe.yaw = Math.PI;
    foe.state = 'engage';
    foe.target = p;
    input.state.firing = true;
    settle(50);
    input.state.firing = false;
    settle(4);
    // A few more shots, aim reset, so a fresh tracer is in the frame when it freezes.
    p.recoilPitch = 0;
    p.recoilYaw = 0;
    input.state.firing = true;
    settle(4);
    input.state.firing = false;
  } else if (name === 'end') {
    startMatch(sim);
    S.phase = 'round';
    S.enemies[0].x = -7;
    S.enemies[0].z = -1;
    S.enemies[1].x = -5;
    S.enemies[1].z = -3;
    damageActor(sim, S.enemies[0], 999, p, false);
    damageActor(sim, S.enemies[1], 999, p, true);
    S.wins.V = 1;
    S.phase = 'roundEnd';
    S.phaseT = 0;
    S.roundWinner = 'V';
    setBanner(S, 'ROUND WON', 'All Sentinels eliminated.');
    p.x = -8;
    p.z = 4;
    p.yaw = 0.1;
    p.pitch = -0.02;
    settle(6);
  } else if (name === 'objective') {
    startMatch(sim);
    S.banner = null;
    S.phase = 'round';
    S.phaseT = 0;
    p.x = -16;
    p.z = -10;
    p.yaw = 0.5;
    p.pitch = -0.05;
    S.plantChannel = 0.9;
    const ally = S.allies[0];
    ally.x = -18;
    ally.z = -9;
    ally.yaw = -0.6;
    settle(4);
  }
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    syncFx(1 / 60);
    hud.frame(S, spreadNow());
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
